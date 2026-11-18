import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import {
  createJobQueues,
  createMemoryCache,
  createRedis,
  createRedisCache,
  startWorkers,
  type MailJob,
  type Redis,
  type WorkerSet,
} from "@civicpulse/platform";
import {
  Client,
  createTestContext,
  PASSWORD,
  registerUser,
  resetDatabase,
  uniqueEmail,
  type TestContext,
} from "../helpers";
import { eventually, integration, quietLogger, sleep, URLS } from "./support";

let redis: Redis;
let ctx: TestContext;

beforeAll(async () => {
  redis = createRedis(URLS.redis, quietLogger, { mode: "fast-fail", name: "test" });
  // A fail-fast client rejects commands until the connection is up.
  if (redis.status !== "ready")
    await new Promise<void>((resolve) => redis.once("ready", () => resolve()));
  await redis.flushdb();
  ctx = await createTestContext();
});
afterAll(async () => {
  redis?.disconnect();
  await ctx?.close();
});
beforeEach(async () => {
  await resetDatabase(ctx.db);
  await redis.flushdb();
});

integration("Redis cache (real Redis)", () => {
  it("stores, expires and invalidates by prefix", async () => {
    const results: string[] = [];
    const cache = createRedisCache(redis, { onResult: (r) => results.push(r) });
    await cache.set("analytics:org1:overview", { total: 3 }, 30);
    await cache.set("analytics:org1:trends", [1, 2], 30);
    await cache.set("analytics:org2:overview", { total: 9 }, 30);
    expect(await cache.get("analytics:org1:overview")).toEqual({ total: 3 });

    await cache.deleteByPrefix("analytics:org1:");
    expect(await cache.get("analytics:org1:overview")).toBeUndefined();
    expect(await cache.get("analytics:org1:trends")).toBeUndefined();
    expect(await cache.get("analytics:org2:overview")).toEqual({ total: 9 });

    await cache.set("short", "lived", 1);
    await sleep(1300);
    expect(await cache.get("short")).toBeUndefined();
    expect(results).toContain("hit");
    expect(results).toContain("miss");
  });

  it("loads once and serves repeats from the cache", async () => {
    const cache = createRedisCache(redis);
    let loads = 0;
    const load = async () => ({ loads: ++loads });
    expect(await cache.getOrSet("k", 30, load)).toEqual({ loads: 1 });
    expect(await cache.getOrSet("k", 30, load)).toEqual({ loads: 1 });
    expect(loads).toBe(1);
  });
});

integration("Redis rate limiting (real Redis)", () => {
  it("shares counters between two API instances", async () => {
    const config = { RATE_LIMIT_ENABLED: "true" };
    const a = await createTestContext(config, { redis, cache: createRedisCache(redis) });
    const b = await createTestContext(config, { redis, cache: createRedisCache(redis) });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) {
        const target = i % 2 === 0 ? a : b;
        const response = await new Client(target.app).post("/api/v1/auth/login", {
          email: "nobody@example.test",
          password: "wrong-password",
        });
        statuses.push(response.statusCode);
      }
      // Login allows 10 per minute per address *across* both instances.
      expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
      expect(statuses.slice(10)).toEqual([429, 429]);
    } finally {
      await a.close();
      await b.close();
    }
  });
});

integration("Redis unavailable", () => {
  it("keeps serving requests when Redis is down", async () => {
    // Nothing listens on this port: every Redis command fails.
    const dead = createRedis("redis://127.0.0.1:6399", quietLogger, {
      mode: "fast-fail",
      name: "dead",
    });
    const app = await createTestContext(
      { RATE_LIMIT_ENABLED: "true" },
      { redis: dead, cache: createRedisCache(dead) },
    );
    try {
      const { email, client } = await registerUser(app);
      expect((await client.get("/api/v1/auth/me")).statusCode).toBe(200);
      const login = await new Client(app.app).post("/api/v1/auth/login", {
        email,
        password: PASSWORD,
      });
      expect(login.statusCode).toBe(200); // not rejected, not 500: rate limiting fails open
      // The cache turns a failure into a miss and still returns the data.
      const cache = createRedisCache(dead);
      expect(await cache.getOrSet("x", 10, async () => "fresh")).toBe("fresh");
    } finally {
      await app.close();
      dead.disconnect();
    }
  });

  it("reports that a job could not be queued so the caller can run it inline", async () => {
    const dead = createRedis("redis://127.0.0.1:6399", quietLogger, {
      mode: "fast-fail",
      name: "dead-queue",
    });
    const queues = createJobQueues(dead, quietLogger);
    try {
      expect(
        await queues.enqueueMail({
          kind: "message",
          to: "a@b.test",
          subject: "s",
          text: "t",
          template: "x",
        }),
      ).toBe(false);
    } finally {
      await queues.close();
      dead.disconnect();
    }
  });

  it("works without Redis at all using the in-process cache", async () => {
    const cache = createMemoryCache();
    let loads = 0;
    await cache.getOrSet("k", 10, async () => ++loads);
    await cache.getOrSet("k", 10, async () => ++loads);
    expect(loads).toBe(1);
    await cache.deleteByPrefix("k");
    await cache.getOrSet("k", 10, async () => ++loads);
    expect(loads).toBe(2);
  });
});

integration("BullMQ (real Redis)", () => {
  it("retries a failing mail job with backoff until it succeeds", async () => {
    const queues = createJobQueues(redis, quietLogger);
    const seen: MailJob[] = [];
    let attempts = 0;
    const noop = async () => {};
    const workers: WorkerSet = startWorkers(URLS.redis, quietLogger, {
      mail: async (job) => {
        attempts += 1;
        if (attempts === 1) throw new Error("smtp temporarily unavailable");
        seen.push(job.data);
      },
      media: noop,
      scheduler: noop,
    });
    try {
      expect(
        await queues.enqueueMail({
          kind: "message",
          to: "citizen@example.test",
          subject: "Hello",
          text: "Body",
          template: "t",
        }),
      ).toBe(true);
      // First attempt fails; BullMQ retries after the 5 s exponential backoff.
      await eventually(async () => seen.length === 1, 30_000);
      expect(attempts).toBe(2);
      expect(seen[0]).toMatchObject({ to: "citizen@example.test" });
    } finally {
      await workers.close();
      await queues.close();
    }
  }, 45_000);

  it("registers the recurring scheduler jobs once, however many replicas start", async () => {
    const a = createJobQueues(redis, quietLogger);
    const b = createJobQueues(redis, quietLogger);
    try {
      await a.scheduleRecurring();
      await b.scheduleRecurring();
      const keys = await redis.keys("bull:scheduler:repeat*");
      const schedulers = await redis.zcard("bull:scheduler:repeat");
      expect(keys.length).toBeGreaterThan(0);
      expect(schedulers).toBe(2); // sla-scan and retention, not four
    } finally {
      await a.close();
      await b.close();
    }
  });

  it("deduplicates a notification email queued twice", async () => {
    const queues = createJobQueues(redis, quietLogger);
    try {
      await queues.enqueueMail({ kind: "notification", notificationId: uniqueEmail("n") });
      const id = "11111111-1111-4111-8111-111111111111";
      await queues.enqueueMail({ kind: "notification", notificationId: id });
      await queues.enqueueMail({ kind: "notification", notificationId: id });
      const waiting = await redis.llen("bull:mail:wait");
      expect(waiting).toBe(2);
    } finally {
      await queues.close();
    }
  });
});
