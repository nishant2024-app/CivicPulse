import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { complaints, deadLetterEvents } from "@civicpulse/db";
import {
  ALL_HANDLERS,
  createMemoryBroker,
  createRelay,
  loadComplaintDocument,
} from "@civicpulse/events";
import { createOpenSearchIndex, type SearchIndex } from "@civicpulse/platform";
import { createTestContext, resetDatabase, registerUser, type TestContext } from "../helpers";
import {
  api,
  eventually,
  fileComplaint,
  integration,
  quietLogger,
  setUpOrganization,
  URLS,
} from "./support";

const index = `it-complaints-${Date.now().toString(36)}`;
let search: SearchIndex;
let ctx: TestContext;

beforeAll(async () => {
  search = createOpenSearchIndex(URLS.opensearch, index);
  await search.ensureIndex();
  await search.ensureIndex(); // idempotent
  ctx = await createTestContext({}, { search });
});
afterAll(async () => {
  await ctx?.close();
  await search?.close();
});
beforeEach(async () => {
  await resetDatabase(ctx.db);
});

/** Run the real consumers over everything pending, then make the index searchable. */
async function indexPending() {
  const relay = createRelay(
    ctx.db,
    createMemoryBroker({ ...ctx.app.eventDeps, logger: quietLogger }, ALL_HANDLERS, {
      backoffMs: 1,
    }),
    quietLogger,
  );
  await relay.drain();
  await search.refresh();
}

async function catalogue() {
  const { admin, citizen, category } = await setUpOrganization(ctx, "search-org");
  const pothole = await fileComplaint(citizen.client, category("roads"), {
    title: "Deep pothole at the main gate",
    description: "A pothole about half a metre wide damages cars entering the campus.",
    locationText: "Main gate, north side",
    latitude: 12.9716,
    longitude: 77.5946,
  });
  const light = await fileComplaint(citizen.client, category("streetlights"), {
    title: "Streetlight out near library",
    description: "The lamp has been dark for a week.",
    locationText: "Library walkway",
    latitude: 12.9816,
    longitude: 77.6046,
  });
  const garbage = await fileComplaint(citizen.client, category("garbage"), {
    title: "Overflowing bins behind the canteen",
    description: "Garbage has not been collected since Monday.",
    locationText: "Canteen back lane",
    latitude: 13.5,
    longitude: 77.9,
  });
  await indexPending();
  return { admin, citizen, category, pothole, light, garbage };
}

/* eslint-disable @typescript-eslint/no-explicit-any -- test helper over untyped JSON */
const find = async (
  client: { get(url: string): Promise<{ statusCode: number; json(): Record<string, any> }> },
  query: string,
) => {
  const response = await client.get(`${api}/search/complaints?${query}`);
  expect(response.statusCode).toBe(200);
  return response.json();
};
/* eslint-enable @typescript-eslint/no-explicit-any */

integration("OpenSearch (real cluster)", () => {
  it("indexes complaint events and finds them with highlighted matches", async () => {
    const { admin, pothole } = await catalogue();
    const result = await find(admin.client, "q=pothole");
    expect(result.meta).toMatchObject({ engine: "opensearch", degraded: false });
    expect(result.data.map((r: { id: string }) => r.id)).toEqual([pothole.id]);
    const title = result.data[0].highlights.title as Array<{ text: string; match: boolean }>;
    expect(title.filter((s) => s.match).map((s) => s.text.toLowerCase())).toContain("pothole");
    // Highlights are plain segments, never markup.
    const markup = JSON.stringify(result.data[0].highlights);
    expect(markup).not.toContain("<em>");
    expect(markup.includes("\u27e6") || markup.includes("\u27e7")).toBe(false);
  });

  it("matches by tracking ID, tolerates typos and searches the description", async () => {
    const { admin, pothole, garbage } = await catalogue();
    expect(
      (await find(admin.client, `q=${pothole.trackingId.toLowerCase()}`)).data.map(
        (r: { id: string }) => r.id,
      ),
    ).toEqual([pothole.id]);
    expect((await find(admin.client, "q=potholle")).data.map((r: { id: string }) => r.id)).toEqual([
      pothole.id,
    ]); // one extra letter
    expect(
      (await find(admin.client, "q=collected+monday")).data.map((r: { id: string }) => r.id),
    ).toEqual([garbage.id]);
    expect((await find(admin.client, "q=zebra")).data).toEqual([]);
  });

  it("filters by category, status and distance, and sorts and pages the results", async () => {
    const { admin, category, light } = await catalogue();
    expect(
      (await find(admin.client, `categoryId=${category("streetlights")}`)).data.map(
        (r: { id: string }) => r.id,
      ),
    ).toEqual([light.id]);
    expect((await find(admin.client, "status=VERIFIED")).data).toEqual([]);
    expect((await find(admin.client, "status=REPORTED")).pagination.total).toBe(3);

    const near = await find(
      admin.client,
      "near=12.9716,77.5946&radiusKm=3&sort=createdAt&order=asc",
    );
    expect(near.data).toHaveLength(2); // the garbage report is ~60 km away
    const paged = await find(admin.client, "sort=createdAt&order=desc&page=2&pageSize=2");
    expect(paged.data).toHaveLength(1);
    expect(paged.pagination).toMatchObject({ total: 3, totalPages: 2, page: 2 });
  });

  it("applies status changes to the index through events", async () => {
    const { admin, pothole } = await catalogue();
    await admin.client.post(`${api}/complaints/${pothole.id}/status`, { status: "VERIFIED" });
    await indexPending();
    const verified = await find(admin.client, "status=VERIFIED");
    expect(verified.data.map((r: { id: string }) => r.id)).toEqual([pothole.id]);
  });

  it("shows each person only what they are allowed to see", async () => {
    const { admin, citizen, pothole, light } = await catalogue();
    // Citizens cannot use the admin search at all.
    expect((await citizen.client.get(`${api}/search/complaints?q=pothole`)).statusCode).toBe(403);

    // A field worker sees only complaints assigned to them.
    const dept = (await admin.client.post(`${api}/departments`, { name: "Works" })).json();
    const worker = await registerUser(ctx, { organizationSlug: "search-org", fullName: "Worker" });
    const members = (
      await admin.client.get(`${api}/organizations/current/members?pageSize=50`)
    ).json().data;
    await admin.client.patch(
      `${api}/organizations/current/members/${members.find((m: { userId: string }) => m.userId === worker.userId).id}`,
      {
        role: "FIELD_WORKER",
        departmentId: dept.id,
      },
    );
    await admin.client.post(`${api}/complaints/${pothole.id}/status`, { status: "VERIFIED" });
    await admin.client.post(`${api}/complaints/${pothole.id}/assign`, {
      departmentId: dept.id,
      workerId: worker.userId,
    });
    await indexPending();
    const mine = await find(worker.client, "sort=createdAt");
    expect(mine.data.map((r: { id: string }) => r.id)).toEqual([pothole.id]);
    expect(mine.pagination.total).toBe(1);
    expect((await find(worker.client, "q=streetlight")).data).toEqual([]);
    void light;
  });

  it("never returns another organization's complaints, even for identical words", async () => {
    const { admin } = await catalogue();
    const other = await setUpOrganization(ctx, "other-org");
    await fileComplaint(other.citizen.client, other.category("roads"), {
      title: "Deep pothole at the main gate",
    });
    await indexPending();
    const mine = await find(admin.client, "q=pothole");
    expect(mine.pagination.total).toBe(1);
    const theirs = await find(other.admin.client, "q=pothole");
    expect(theirs.pagination.total).toBe(1);
    expect(theirs.data[0].id).not.toBe(mine.data[0].id);
  });

  it("drops index entries the database no longer backs or the caller may not see", async () => {
    const { admin } = await catalogue();
    // A stale document: indexed for this organization, but the complaint does not exist.
    const [real] = await ctx.db.withSystem((tx) => tx.select().from(complaints).limit(1));
    const doc = await ctx.db.withSystem((tx) => loadComplaintDocument(tx, real!.id));
    await search.upsert({
      ...doc!,
      id: "00000000-0000-4000-8000-00000000dead",
      title: "Ghost pothole",
    });
    await search.refresh();
    const result = await find(admin.client, "q=ghost");
    expect(result.data).toEqual([]);
  });

  it("falls back to PostgreSQL when OpenSearch is unreachable", async () => {
    const { admin, pothole } = await catalogue();
    const broken = createOpenSearchIndex("http://127.0.0.1:9", index);
    const degraded = await createTestContext({}, { search: broken });
    try {
      const client = admin.client;
      client.cookie = admin.client.cookie;
      const response = await degraded.app.inject({
        method: "GET",
        url: `${api}/search/complaints?q=pothole`,
        headers: { cookie: client.cookie! },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.meta).toMatchObject({ engine: "postgres", degraded: true });
      expect(body.data.map((r: { id: string }) => r.id)).toEqual([pothole.id]);
    } finally {
      await degraded.close();
      await broken.close();
    }
  }, 30_000);

  it("retries then dead-letters an event when indexing keeps failing, without losing the others", async () => {
    const { citizen, category } = await setUpOrganization(ctx, "index-fail");
    const broken = createOpenSearchIndex("http://127.0.0.1:9", index);
    const deps = { ...ctx.app.eventDeps, search: broken, logger: quietLogger };
    await fileComplaint(citizen.client, category("roads"));
    const relay = createRelay(
      ctx.db,
      createMemoryBroker(deps, ALL_HANDLERS, { backoffMs: 1 }),
      quietLogger,
    );
    await relay.drain();
    await broken.close();
    const dead = await ctx.db.withSystem((tx) =>
      tx.select().from(deadLetterEvents).where(eq(deadLetterEvents.consumerGroup, "search-index")),
    );
    expect(dead).toHaveLength(1);
    // Notifications (another consumer group) were still produced.
    const { notifications } = await import("@civicpulse/db");
    expect(
      (await ctx.db.withSystem((tx) => tx.select().from(notifications))).length,
    ).toBeGreaterThan(0);
    // The index is derived data: a reindex from PostgreSQL repairs it.
    const [row] = await ctx.db.withSystem((tx) => tx.select().from(complaints));
    await search.upsert((await ctx.db.withSystem((tx) => loadComplaintDocument(tx, row!.id)))!);
    await search.refresh();
    await eventually(async () => (await search.count()) >= 1);
  }, 60_000);
});
