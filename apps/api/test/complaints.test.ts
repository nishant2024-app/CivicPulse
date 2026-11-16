import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  complaints,
  deadLetterEvents,
  notifications,
  organizationMembers,
  outboxEvents,
  users,
} from "@civicpulse/db";
import { notificationConsumer } from "../src/events/notification-consumer";
import { createEventPump } from "../src/events/pump";
import {
  Client,
  createOrganizationWithAdmin,
  createTestContext,
  registerUser,
  resetDatabase,
  type TestContext,
} from "./helpers";

let ctx: TestContext;
type Org = Awaited<ReturnType<typeof createOrganizationWithAdmin>>;
type Person = Awaited<ReturnType<typeof registerUser>>;
let org: Org;
let citizen: Person;
let worker: Person;
let manager: Person;
let departmentId: string;
let roadsId: string;

const api = "/api/v1";

async function memberIdOf(admin: Client, userId: string): Promise<string> {
  const members = (await admin.get(`${api}/organizations/current/members?pageSize=100`)).json()
    .data;
  return members.find((m: { userId: string }) => m.userId === userId).id;
}

async function setUp() {
  org = await createOrganizationWithAdmin(ctx, "alpha-college");
  const department = await org.client.post(`${api}/departments`, { name: "Roads and Works" });
  expect(department.statusCode).toBe(201);
  departmentId = department.json().id;

  citizen = await registerUser(ctx, { organizationSlug: org.slug, fullName: "Priya Citizen" });
  worker = await registerUser(ctx, { organizationSlug: org.slug, fullName: "Imran Worker" });
  manager = await registerUser(ctx, { organizationSlug: org.slug, fullName: "Rohan Manager" });
  for (const [person, role] of [
    [worker, "FIELD_WORKER"],
    [manager, "DEPARTMENT_MANAGER"],
  ] as const) {
    const response = await org.client.patch(
      `${api}/organizations/current/members/${await memberIdOf(org.client, person.userId)}`,
      { role, departmentId },
    );
    expect(response.statusCode).toBe(200);
  }
  const categories = (await citizen.client.get(`${api}/organizations/current/categories`)).json()
    .data;
  roadsId = categories.find((c: { slug: string }) => c.slug === "roads").id;
}

async function report(client: Client = citizen.client, overrides: Record<string, unknown> = {}) {
  const response = await client.post(`${api}/complaints`, {
    categoryId: roadsId,
    title: "Deep pothole at the main gate",
    description: "A pothole about half a metre wide has opened right at the main gate.",
    locationText: "Main gate, north side",
    latitude: 12.9716,
    longitude: 77.5946,
    ...overrides,
  });
  expect(response.statusCode).toBe(201);
  return response.json();
}

const status = (client: Client, id: string, to: string, note?: string) =>
  client.post(`${api}/complaints/${id}/status`, { status: to, ...(note ? { note } : {}) });

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDatabase(ctx.db);
  await setUp();
});

describe("complaint lifecycle", () => {
  it("runs from report to resolution with history, events and notifications", async () => {
    // 1–2. Citizen submits; it is stored with a tracking ID.
    const created = await report();
    expect(created.trackingId).toMatch(/^CP-[0-9A-Z]{10}$/);
    expect(created).toMatchObject({ status: "REPORTED", priority: "MEDIUM", isReporter: true });
    expect(created.actions.transitions).toEqual([]);
    const id = created.id;

    // 3–4. The event is in the outbox and becomes notifications when processed.
    const pending = await ctx.db.withSystem((tx) => tx.select().from(outboxEvents));
    expect(pending.map((e) => e.eventType)).toEqual(["complaint.created"]);
    expect(await ctx.app.events.drain()).toBe(1);
    const afterCreate = await ctx.db.withSystem((tx) => tx.select().from(notifications));
    // The administrator is told; the reporter is not notified about their own action.
    expect(afterCreate.map((n) => n.userId)).toEqual([org.userId]);

    // 6. Administrator verifies (deadline is set from the SLA policy) and assigns.
    const verified = (await status(org.client, id, "VERIFIED")).json();
    expect(verified.status).toBe("VERIFIED");
    const dueInDays = (Date.parse(verified.slaDueAt) - Date.now()) / 86_400_000;
    expect(dueInDays).toBeGreaterThan(6.9);
    expect(dueInDays).toBeLessThan(7.1);

    const assigned = await org.client.post(`${api}/complaints/${id}/assign`, {
      departmentId,
      workerId: worker.userId,
      note: "Bring cold-mix asphalt",
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json()).toMatchObject({
      status: "ASSIGNED",
      department: { id: departmentId },
      assignedWorker: { id: worker.userId },
      assignment: { status: "PENDING" },
    });

    // 7. Field worker accepts, starts, and resolves with a note.
    const workerView = (await worker.client.get(`${api}/complaints/${id}`)).json();
    expect(workerView.actions.canAcceptAssignment).toBe(true);
    expect(workerView.assignment.note).toBe("Bring cold-mix asphalt");
    expect((await worker.client.post(`${api}/complaints/${id}/assignment/accept`)).statusCode).toBe(
      200,
    );
    expect((await status(worker.client, id, "IN_PROGRESS")).json().status).toBe("IN_PROGRESS");
    expect((await status(worker.client, id, "RESOLVED")).statusCode).toBe(400); // note required
    const resolved = (await status(worker.client, id, "RESOLVED", "Filled and compacted")).json();
    expect(resolved.status).toBe("RESOLVED");
    expect(resolved.resolvedAt).not.toBeNull();

    // 8. Citizen sees the updated status and the full history, without staff instructions.
    await ctx.app.events.drain();
    const citizenView = (await citizen.client.get(`${api}/complaints/${id}`)).json();
    expect(citizenView.history.map((h: { toStatus: string }) => h.toStatus)).toEqual([
      "REPORTED",
      "VERIFIED",
      "ASSIGNED",
      "IN_PROGRESS",
      "RESOLVED",
    ]);
    expect(citizenView.assignment).toBeNull(); // completed
    expect(citizenView.actions.transitions.map((t: { to: string }) => t.to)).toEqual([
      "CLOSED",
      "REOPENED",
    ]);
    const inbox = (await citizen.client.get(`${api}/notifications`)).json();
    expect(inbox.data.map((n: { type: string }) => n.type)).toEqual([
      "complaint.resolved",
      "complaint.work_started",
      "complaint.assigned",
      "complaint.verified",
    ]);
    expect((await citizen.client.get(`${api}/notifications/unread-count`)).json().count).toBe(4);
    await citizen.client.post(`${api}/notifications/read-all`);
    expect((await citizen.client.get(`${api}/notifications/unread-count`)).json().count).toBe(0);
    // The worker was told about the assignment.
    const workerInbox = (await worker.client.get(`${api}/notifications`)).json().data;
    expect(workerInbox.map((n: { title: string }) => n.title)).toContain("New assignment");

    // Feedback once, then close.
    expect(
      (await citizen.client.post(`${api}/complaints/${id}/feedback`, { rating: 5 })).statusCode,
    ).toBe(201);
    expect(
      (await citizen.client.post(`${api}/complaints/${id}/feedback`, { rating: 1 })).statusCode,
    ).toBe(409);
    expect((await status(citizen.client, id, "CLOSED")).json().status).toBe("CLOSED");
  });

  it("lets the reporter reopen with a reason, clearing the assignee and notifying staff", async () => {
    const { id } = await report();
    await status(org.client, id, "VERIFIED");
    await org.client.post(`${api}/complaints/${id}/assign`, {
      departmentId,
      workerId: worker.userId,
    });
    await status(worker.client, id, "IN_PROGRESS");
    await status(worker.client, id, "RESOLVED", "Patched");
    await ctx.app.events.drain();

    expect((await status(citizen.client, id, "REOPENED")).statusCode).toBe(400);
    const reopened = (
      await status(citizen.client, id, "REOPENED", "Hole is back after rain")
    ).json();
    expect(reopened).toMatchObject({ status: "REOPENED", reopenedCount: 1, assignedWorker: null });
    await ctx.app.events.drain();
    const titles = async (c: Client) =>
      (await c.get(`${api}/notifications`)).json().data.map((n: { title: string }) => n.title);
    expect(await titles(worker.client)).toContain("Report reopened");
    expect(await titles(org.client)).toContain("Report reopened");
  });

  it("refuses to reopen after the organization's reopen window", async () => {
    const { id } = await report();
    await status(org.client, id, "VERIFIED");
    await org.client.post(`${api}/complaints/${id}/assign`, {
      departmentId,
      workerId: worker.userId,
    });
    await status(worker.client, id, "IN_PROGRESS");
    await status(worker.client, id, "RESOLVED", "Patched");
    await ctx.db.withSystem((tx) =>
      tx.update(complaints).set({ resolvedAt: new Date(Date.now() - 30 * 86_400_000) }),
    );
    const late = await status(citizen.client, id, "REOPENED", "Still broken");
    expect(late.statusCode).toBe(403);
    // An administrator still can.
    expect((await status(org.client, id, "REOPENED", "Confirmed on site")).statusCode).toBe(200);
  });
});

describe("status rules", () => {
  it("rejects skipped steps and unauthorized actors, leaving history untouched", async () => {
    const { id } = await report();
    expect((await status(org.client, id, "RESOLVED", "done")).json().error.code).toBe(
      "INVALID_STATUS_TRANSITION",
    );
    expect((await status(citizen.client, id, "VERIFIED")).statusCode).toBe(403);
    expect((await status(org.client, id, "ASSIGNED")).statusCode).toBe(400);
    expect((await status(org.client, id, "REJECTED")).statusCode).toBe(400); // reason required

    const view = (await citizen.client.get(`${api}/complaints/${id}`)).json();
    expect(view.status).toBe("REPORTED");
    expect(view.history).toHaveLength(1);
  });

  it("only lets the assigned worker progress the work", async () => {
    const other = await registerUser(ctx, { organizationSlug: org.slug, fullName: "Other Worker" });
    await org.client.patch(
      `${api}/organizations/current/members/${await memberIdOf(org.client, other.userId)}`,
      { role: "FIELD_WORKER", departmentId },
    );
    const { id } = await report();
    await status(org.client, id, "VERIFIED");
    await org.client.post(`${api}/complaints/${id}/assign`, {
      departmentId,
      workerId: worker.userId,
    });

    // Another worker in the same department cannot even see it.
    expect((await other.client.get(`${api}/complaints/${id}`)).statusCode).toBe(404);
    expect((await status(other.client, id, "IN_PROGRESS")).statusCode).toBe(404);
    expect((await status(worker.client, id, "IN_PROGRESS")).statusCode).toBe(200);
  });

  it("validates assignment targets", async () => {
    const { id } = await report();
    const tooEarly = await org.client.post(`${api}/complaints/${id}/assign`, { departmentId });
    expect(tooEarly.json().error.code).toBe("INVALID_STATUS_TRANSITION");
    await status(org.client, id, "VERIFIED");
    const notAWorker = await org.client.post(`${api}/complaints/${id}/assign`, {
      departmentId,
      workerId: citizen.userId,
    });
    expect(notAWorker.statusCode).toBe(400);
    expect(
      (await citizen.client.post(`${api}/complaints/${id}/assign`, { departmentId })).statusCode,
    ).toBe(403);
  });
});

describe("visibility", () => {
  it("scopes the list by role", async () => {
    const mine = await report();
    const otherCitizen = await registerUser(ctx, { organizationSlug: org.slug });
    const theirs = await report(otherCitizen.client, { title: "Streetlight out near hostel" });
    await status(org.client, mine.id, "VERIFIED");
    await org.client.post(`${api}/complaints/${mine.id}/assign`, {
      departmentId,
      workerId: worker.userId,
    });

    const ids = async (c: Client, query = "") =>
      (await c.get(`${api}/complaints${query}`))
        .json()
        .data.map((row: { id: string }) => row.id)
        .sort();
    expect(await ids(citizen.client)).toEqual([mine.id]);
    expect(await ids(otherCitizen.client)).toEqual([theirs.id]);
    expect(await ids(worker.client)).toEqual([mine.id]);
    expect(await ids(manager.client)).toEqual([mine.id]); // only their department
    expect(await ids(org.client)).toEqual([mine.id, theirs.id].sort());

    expect((await citizen.client.get(`${api}/complaints/${theirs.id}`)).statusCode).toBe(404);
    expect(await ids(org.client, "?state=unassigned")).toEqual([theirs.id]);
    expect(await ids(org.client, "?q=streetlight")).toEqual([theirs.id]);
    expect(await ids(org.client, `?q=${mine.trackingId.toLowerCase()}`)).toEqual([mine.id]);
  });

  it("keeps internal notes away from the reporter", async () => {
    const { id } = await report();
    expect(
      (
        await org.client.post(`${api}/complaints/${id}/comments`, {
          body: "Vendor quote pending",
          isInternal: true,
        })
      ).statusCode,
    ).toBe(201);
    await org.client.post(`${api}/complaints/${id}/comments`, { body: "We are looking into it." });
    expect(
      (
        await citizen.client.post(`${api}/complaints/${id}/comments`, {
          body: "sneaky",
          isInternal: true,
        })
      ).statusCode,
    ).toBe(403);

    const citizenView = (await citizen.client.get(`${api}/complaints/${id}`)).json();
    expect(citizenView.comments.map((c: { body: string }) => c.body)).toEqual([
      "We are looking into it.",
    ]);
    expect(JSON.stringify(citizenView)).not.toContain("Vendor quote");
    const staffView = (await org.client.get(`${api}/complaints/${id}`)).json();
    expect(staffView.comments).toHaveLength(2);
  });

  it("hides complaints of another organization", async () => {
    const { id, trackingId } = await report();
    const beta = await createOrganizationWithAdmin(ctx, "beta-society");
    expect((await beta.client.get(`${api}/complaints/${id}`)).statusCode).toBe(404);
    expect((await status(beta.client, id, "VERIFIED")).statusCode).toBe(404);
    expect((await beta.client.get(`${api}/complaints?q=${trackingId}`)).json().data).toEqual([]);
    expect((await beta.client.get(`${api}/analytics/overview`)).json().total).toBe(0);
  });
});

describe("public tracking", () => {
  it("shows progress without personal or internal data", async () => {
    const { id, trackingId } = await report();
    await status(org.client, id, "VERIFIED", "internal: checked by guard");
    await org.client.post(`${api}/complaints/${id}/comments`, {
      body: "secret note",
      isInternal: true,
    });

    const response = await ctx.app.inject(`${api}/tracking/${trackingId.toLowerCase()}`);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ trackingId, status: "VERIFIED", category: "Roads" });
    expect(body.timeline.map((t: { status: string }) => t.status)).toEqual([
      "REPORTED",
      "VERIFIED",
    ]);
    const text = response.body;
    for (const secret of [
      "Priya",
      citizen.email,
      citizen.userId,
      id,
      "12.97",
      "secret note",
      "checked by guard",
      org.organizationId,
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("answers identically for unknown, malformed and disabled tracking", async () => {
    const { trackingId } = await report();
    const unknown = await ctx.app.inject(`${api}/tracking/CP-0000000000`);
    const malformed = await ctx.app.inject(`${api}/tracking/not-an-id`);
    expect(unknown.statusCode).toBe(404);
    expect(malformed.statusCode).toBe(404);

    await org.client.patch(`${api}/organizations/${org.organizationId}`, {
      settings: { publicTrackingEnabled: false },
    });
    const disabled = await ctx.app.inject(`${api}/tracking/${trackingId}`);
    expect(disabled.statusCode).toBe(404);
    expect(disabled.json().error.message).toBe(unknown.json().error.message);
  });
});

describe("photo uploads", () => {
  const boundary = "----civicpulse-test";
  function multipart(file: Buffer, filename: string, type: string) {
    return Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`,
      ),
      file,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
  }
  const upload = (
    client: Client,
    id: string,
    file: Buffer,
    name = "photo.jpg",
    type = "image/jpeg",
  ) =>
    client.request("POST", `${api}/complaints/${id}/attachments`, multipart(file, name, type), {
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    });
  const jpeg = () =>
    sharp({ create: { width: 800, height: 600, channels: 3, background: "#7799bb" } })
      .withExif({ IFD0: { Copyright: "secret-exif-marker" } })
      .jpeg()
      .toBuffer();

  it("stores a re-encoded image and serves it only through a valid signed URL", async () => {
    const { id } = await report();
    const response = await upload(citizen.client, id, await jpeg());
    expect(response.statusCode).toBe(201);

    const view = (await citizen.client.get(`${api}/complaints/${id}`)).json();
    expect(view.attachments).toHaveLength(1);
    expect(view.attachments[0]).toMatchObject({ kind: "REPORT", width: 800, height: 600 });

    const file = await ctx.app.inject(view.attachments[0].url);
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toBe("image/webp");
    expect(file.rawPayload.includes(Buffer.from("secret-exif-marker"))).toBe(false);

    const tampered = view.attachments[0].url.replace(/sig=.{6}/, "sig=AAAAAA");
    expect((await ctx.app.inject(tampered)).statusCode).toBe(404);
    const expired = view.attachments[0].url.replace(/exp=\d+/, "exp=1000");
    expect((await ctx.app.inject(expired)).statusCode).toBe(404);
  });

  it("rejects files that are not images, whatever they claim to be", async () => {
    const { id } = await report();
    const fake = await upload(
      citizen.client,
      id,
      Buffer.from("<script>alert(1)</script>".repeat(10)),
    );
    expect(fake.statusCode).toBe(415);
    const truncated = await upload(citizen.client, id, (await jpeg()).subarray(0, 200));
    expect(truncated.statusCode).toBe(415);
    expect((await citizen.client.get(`${api}/complaints/${id}`)).json().attachments).toEqual([]);
  });

  it("rejects oversized files and uploads from people outside the complaint", async () => {
    const small = await createTestContext({ UPLOAD_MAX_BYTES: "2048" });
    try {
      const { id } = await report();
      const client = new Client(small.app);
      client.cookie = citizen.client.cookie;
      expect((await upload(client, id, await jpeg())).statusCode).toBe(413);
    } finally {
      await small.close();
    }
    const { id } = await report();
    const stranger = await registerUser(ctx, { organizationSlug: org.slug });
    expect((await upload(stranger.client, id, await jpeg())).statusCode).toBe(404);
  });

  it("marks worker photos during work as resolution evidence shown on public tracking", async () => {
    const { id, trackingId } = await report();
    await status(org.client, id, "VERIFIED");
    await org.client.post(`${api}/complaints/${id}/assign`, {
      departmentId,
      workerId: worker.userId,
    });
    await status(worker.client, id, "IN_PROGRESS");
    await upload(citizen.client, id, await jpeg());
    await upload(worker.client, id, await jpeg());

    const view = (await worker.client.get(`${api}/complaints/${id}`)).json();
    expect(view.attachments.map((a: { kind: string }) => a.kind).sort()).toEqual([
      "REPORT",
      "RESOLUTION",
    ]);
    const tracking = (await ctx.app.inject(`${api}/tracking/${trackingId}`)).json();
    expect(tracking.resolutionPhotos).toHaveLength(1); // the reporter's photo stays private
  });
});

describe("event processing", () => {
  it("handles a duplicate delivery once", async () => {
    await report();
    await ctx.app.events.drain();
    const before = await ctx.db.withSystem((tx) => tx.select().from(notifications));
    // Simulate the relay crashing after handling but before marking the row published.
    await ctx.db.withSystem((tx) => tx.update(outboxEvents).set({ publishedAt: null }));
    expect(await ctx.app.events.drain()).toBe(1);
    const after = await ctx.db.withSystem((tx) => tx.select().from(notifications));
    expect(after).toHaveLength(before.length);
  });

  it("retries a failing consumer, then dead-letters it without blocking other events", async () => {
    await report();
    let calls = 0;
    const pump = createEventPump(
      ctx.db,
      [
        {
          group: "always-fails",
          async handle() {
            calls += 1;
            throw new Error("search index unavailable");
          },
        },
        notificationConsumer,
      ],
      { info() {}, warn() {}, error() {} },
    );
    for (let attempt = 0; attempt < 5; attempt++) {
      await ctx.db.withSystem((tx) => tx.update(outboxEvents).set({ nextAttemptAt: new Date(0) }));
      await pump.drain();
    }
    expect(calls).toBe(5);
    const dead = await ctx.db.withSystem((tx) => tx.select().from(deadLetterEvents));
    expect(dead).toHaveLength(1);
    expect(dead[0]).toMatchObject({
      consumerGroup: "always-fails",
      error: "search index unavailable",
    });
    const [row] = await ctx.db.withSystem((tx) => tx.select().from(outboxEvents));
    expect(row!.publishedAt).not.toBeNull();

    // The healthy consumer was never held back by the failing one.
    const first = await ctx.db.withSystem((tx) =>
      tx.select().from(notifications).where(eq(notifications.userId, org.userId)),
    );
    expect(first).toHaveLength(1);
    await report(citizen.client, { title: "Second report after the failure" });
    await pump.drain();
    const both = await ctx.db.withSystem((tx) =>
      tx.select().from(notifications).where(eq(notifications.userId, org.userId)),
    );
    expect(both).toHaveLength(2);
  });

  it("commits no event when the business change fails", async () => {
    const response = await citizen.client.post(`${api}/complaints`, {
      categoryId: "00000000-0000-4000-8000-000000000000",
      title: "Invalid category report",
      description: "This should not be stored at all.",
      locationText: "Nowhere",
    });
    expect(response.statusCode).toBe(400);
    expect(await ctx.db.withSystem((tx) => tx.select().from(outboxEvents))).toEqual([]);
    expect(await ctx.db.withSystem((tx) => tx.select().from(complaints))).toEqual([]);
  });
});

describe("departments, members and analytics", () => {
  it("computes figures from real records", async () => {
    const empty = (await org.client.get(`${api}/analytics/overview`)).json();
    expect(empty).toMatchObject({ total: 0, averageResolutionHours: null, resolutionRate: null });

    const a = await report();
    const b = await report(citizen.client, { title: "Garbage not collected for days" });
    await report(citizen.client, { title: "Third report waiting in the queue" });
    await status(org.client, b.id, "REJECTED", "Duplicate of an existing report");
    await status(org.client, a.id, "VERIFIED");
    await org.client.post(`${api}/complaints/${a.id}/assign`, {
      departmentId,
      workerId: worker.userId,
    });
    await status(worker.client, a.id, "IN_PROGRESS");
    await status(worker.client, a.id, "RESOLVED", "Done");
    await citizen.client.post(`${api}/complaints/${a.id}/feedback`, { rating: 4 });

    const overview = (await org.client.get(`${api}/analytics/overview`)).json();
    expect(overview).toMatchObject({
      total: 3,
      open: 1,
      resolved: 1,
      rejected: 1,
      unassigned: 1,
      overdue: 0,
      averageRating: 4,
      ratingCount: 1,
    });
    expect(overview.resolutionRate).toBeCloseTo(0.5);
    expect(overview.averageResolutionHours).toBeGreaterThanOrEqual(0);

    const perDepartment = (await org.client.get(`${api}/analytics/departments`)).json().data;
    expect(perDepartment).toEqual([
      expect.objectContaining({ name: "Roads and Works", total: 1, resolved: 1 }),
    ]);
    const trends = (await org.client.get(`${api}/analytics/trends?months=3`)).json().data;
    expect(trends).toHaveLength(3);
    expect(trends.at(-1)).toMatchObject({ reported: 3, resolved: 1 });
    const roads = (await org.client.get(`${api}/analytics/categories`)).json().data[0];
    expect(roads).toMatchObject({ name: "Roads", total: 3, open: 1 });
    expect((await org.client.get(`${api}/analytics/hotspots`)).json().data).toEqual([
      { latitude: 12.972, longitude: 77.595, count: 1 },
    ]);

    // Overdue is derived from the deadline, not stored.
    await ctx.db.withSystem((tx) =>
      tx
        .update(complaints)
        .set({ slaDueAt: new Date(Date.now() - 1000) })
        .where(eq(complaints.status, "REPORTED")),
    );
    expect((await org.client.get(`${api}/analytics/overview`)).json().overdue).toBe(1);
    expect((await org.client.get(`${api}/complaints?state=overdue`)).json().data).toHaveLength(1);

    expect((await citizen.client.get(`${api}/analytics/overview`)).statusCode).toBe(403);
  });

  it("protects department and member administration", async () => {
    expect((await citizen.client.post(`${api}/departments`, { name: "Rogue" })).statusCode).toBe(
      403,
    );
    expect(
      (await org.client.post(`${api}/departments`, { name: "roads AND works" })).statusCode,
    ).toBe(409);

    const list = (await org.client.get(`${api}/departments`)).json().data;
    expect(list[0]).toMatchObject({
      name: "Roads and Works",
      workerCount: 1,
      manager: { id: manager.userId },
    });

    // The last administrator cannot be demoted.
    const adminMember = await memberIdOf(org.client, org.userId);
    const demote = await org.client.patch(`${api}/organizations/current/members/${adminMember}`, {
      role: "CITIZEN",
    });
    expect(demote.statusCode).toBe(409);
    // A field worker needs a department.
    const citizenMember = await memberIdOf(org.client, citizen.userId);
    const noDepartment = await org.client.patch(
      `${api}/organizations/current/members/${citizenMember}`,
      { role: "FIELD_WORKER" },
    );
    expect(noDepartment.statusCode).toBe(400);

    // A department with open work cannot be removed.
    const { id } = await report();
    await status(org.client, id, "VERIFIED");
    await org.client.post(`${api}/complaints/${id}/assign`, { departmentId });
    expect((await org.client.delete(`${api}/departments/${departmentId}`)).statusCode).toBe(409);

    // Suspending a member cuts access immediately.
    await org.client.patch(`${api}/organizations/current/members/${citizenMember}`, {
      status: "SUSPENDED",
    });
    expect((await citizen.client.get(`${api}/complaints`)).statusCode).toBe(403);
    const [row] = await ctx.db.withSystem((tx) =>
      tx.select().from(organizationMembers).where(eq(organizationMembers.id, citizenMember)),
    );
    expect(row!.status).toBe("SUSPENDED");
  });

  it("records an audit trail administrators can read", async () => {
    const { id } = await report();
    await status(org.client, id, "VERIFIED");
    const audit = (await org.client.get(`${api}/audit-logs?pageSize=50`)).json();
    const actions = audit.data.map((entry: { action: string }) => entry.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "complaint.created",
        "complaint.status_changed",
        "department.created",
        "member.updated",
      ]),
    );
    expect(audit.data[0].actor.fullName).toBeDefined();
    expect((await manager.client.get(`${api}/audit-logs`)).statusCode).toBe(403);
    void users;
  });
});
