import { eq } from "drizzle-orm";
import type { Kafka } from "kafkajs";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { deadLetterEvents, notifications, processedEvents } from "@civicpulse/db";
import {
  cacheInvalidationHandler,
  createKafka,
  createKafkaBroker,
  createRelay,
  ensureTopics,
  notificationHandler,
  startKafkaConsumers,
  toEnvelope,
  topicNames,
  type EventHandler,
  type KafkaConsumers,
  type KafkaProducerHandle,
} from "@civicpulse/events";
import { createMetrics } from "@civicpulse/platform";
import { outboxEvents } from "@civicpulse/db";
import { createTestContext, resetDatabase, type TestContext } from "../helpers";
import {
  eventually,
  fileComplaint,
  integration,
  quietLogger,
  setUpOrganization,
  sleep,
  URLS,
} from "./support";

let ctx: TestContext;
let kafka: Kafka;
const opened: Array<{ consumers?: KafkaConsumers; broker?: KafkaProducerHandle }> = [];

beforeAll(async () => {
  ctx = await createTestContext();
  kafka = createKafka(
    { brokers: [URLS.kafka], clientId: "it", groupPrefix: "x", topicPrefix: "x" },
    quietLogger,
  );
});
afterAll(async () => {
  for (const item of opened) {
    await item.consumers?.stop();
    await item.broker?.disconnect();
  }
  await ctx.close();
});
beforeEach(async () => {
  await resetDatabase(ctx.db);
});

/** A fresh topic and group namespace per test, so tests never see each other's messages. */
function namespace() {
  const prefix = `it${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return { brokers: [URLS.kafka], clientId: "it", groupPrefix: `${prefix}-g`, topicPrefix: prefix };
}

async function pipeline(handlers: EventHandler[], options = namespace(), start = true) {
  const admin = kafka.admin();
  await admin.connect();
  await ensureTopics(admin, options.topicPrefix);
  await admin.disconnect();
  const broker = await createKafkaBroker(kafka, options.topicPrefix);
  const metrics = createMetrics("test");
  const deps = { ...ctx.app.eventDeps, logger: quietLogger, metrics };
  const handle: { consumers?: KafkaConsumers; broker: KafkaProducerHandle } = { broker };
  opened.push(handle);
  const startConsumers = async () => {
    handle.consumers = await startKafkaConsumers(
      kafka,
      options,
      handlers,
      deps,
      broker.producer,
      metrics,
    );
    return handle.consumers;
  };
  if (start) await startConsumers();
  return {
    options,
    broker,
    relay: createRelay(ctx.db, broker.broker, quietLogger),
    startConsumers,
    metrics,
  };
}

integration("Kafka pipeline (real broker)", () => {
  it("carries a complaint event from the outbox through Kafka to a consumer", async () => {
    const { admin, citizen, category } = await setUpOrganization(ctx, "kafka-flow");
    const p = await pipeline([notificationHandler]);
    await fileComplaint(citizen.client, category("roads"));

    expect(await p.relay.drain()).toBe(1);
    const inbox = await eventually(async () => {
      const rows = await ctx.db.withSystem((tx) =>
        tx.select().from(notifications).where(eq(notifications.userId, admin.userId)),
      );
      return rows.length ? rows : false;
    });
    expect(inbox[0]).toMatchObject({ type: "complaint.created", title: "New report to review" });
    const [row] = await ctx.db.withSystem((tx) => tx.select().from(outboxEvents));
    expect(row!.publishedAt).not.toBeNull();
  });

  it("handles a duplicate delivery once", async () => {
    const { admin, citizen, category } = await setUpOrganization(ctx, "kafka-dup");
    const p = await pipeline([notificationHandler]);
    await fileComplaint(citizen.client, category("roads"));
    await p.relay.drain();
    await eventually(
      async () => (await ctx.db.withSystem((tx) => tx.select().from(notifications))).length > 0,
    );

    // Deliver the very same event again, as a relay that crashed before marking it would.
    const [row] = await ctx.db.withSystem((tx) => tx.select().from(outboxEvents));
    await p.broker.broker.publish(toEnvelope(row!), {});
    await sleep(2500);
    const inbox = await ctx.db.withSystem((tx) =>
      tx.select().from(notifications).where(eq(notifications.userId, admin.userId)),
    );
    expect(inbox).toHaveLength(1);
    const ledger = await ctx.db.withSystem((tx) =>
      tx.select().from(processedEvents).where(eq(processedEvents.eventId, row!.id)),
    );
    expect(ledger).toHaveLength(1);
  });

  it("lets a consumer that was down catch up from the topic when it returns", async () => {
    const { admin, citizen, category } = await setUpOrganization(ctx, "kafka-catchup");
    const p = await pipeline([notificationHandler], namespace(), false);
    await fileComplaint(citizen.client, category("roads"));
    await fileComplaint(citizen.client, category("garbage"), {
      title: "Garbage not collected for days",
    });
    expect(await p.relay.drain()).toBe(2);
    // Nothing consumes while the consumer group is down.
    await sleep(1500);
    expect(
      await ctx.db.withSystem((tx) =>
        tx.select().from(notifications).where(eq(notifications.userId, admin.userId)),
      ),
    ).toHaveLength(0);

    const consumers = await p.startConsumers();
    await eventually(
      async () =>
        (
          await ctx.db.withSystem((tx) =>
            tx.select().from(notifications).where(eq(notifications.userId, admin.userId)),
          )
        ).length === 2,
    );
    // Lag drains to zero once the group has caught up.
    await eventually(async () => {
      await consumers.measureLag();
      const gauge = (await p.metrics.kafkaLag.get()).values.find((v) =>
        v.labels.group?.toString().endsWith("notification"),
      );
      return gauge?.value === 0;
    });
  });

  it("dead-letters a poison event and keeps consuming, mirroring it to the DLQ topic", async () => {
    const { admin, citizen, category } = await setUpOrganization(ctx, "kafka-dlq");
    let attempts = 0;
    const poison: EventHandler = {
      group: "poison",
      async handle() {
        attempts += 1;
        throw new Error("cannot process this event");
      },
    };
    const options = namespace();
    const p = await pipeline([poison, notificationHandler], options);
    await fileComplaint(citizen.client, category("roads"));
    await p.relay.drain();

    const dead = await eventually(async () => {
      const rows = await ctx.db.withSystem((tx) => tx.select().from(deadLetterEvents));
      return rows.length ? rows : false;
    });
    expect(dead[0]).toMatchObject({ consumerGroup: "poison", error: "cannot process this event" });
    expect(attempts).toBe(5);
    // The healthy group was unaffected.
    await eventually(
      async () =>
        (
          await ctx.db.withSystem((tx) =>
            tx.select().from(notifications).where(eq(notifications.userId, admin.userId)),
          )
        ).length === 1,
    );

    const probe = kafka.consumer({ groupId: `${options.groupPrefix}-probe` });
    await probe.connect();
    await probe.subscribe({
      topic: topicNames(options.topicPrefix).deadLetter,
      fromBeginning: true,
    });
    const seen: Array<Record<string, string>> = [];
    await probe.run({
      eachMessage: async ({ message }) =>
        void seen.push({ group: message.headers?.["dlq-group"]?.toString() ?? "" }),
    });
    await eventually(async () => seen.length > 0);
    expect(seen[0]).toEqual({ group: "poison" });
    await probe.disconnect();
  });

  it("invalidates cached analytics when a complaint changes", async () => {
    const { admin, citizen, category } = await setUpOrganization(ctx, "kafka-cache");
    const p = await pipeline([cacheInvalidationHandler]);
    expect((await admin.client.get("/api/v1/analytics/overview")).json().total).toBe(0);
    await fileComplaint(citizen.client, category("roads"));
    // Stale until the event is consumed…
    expect((await admin.client.get("/api/v1/analytics/overview")).json().total).toBe(0);
    await p.relay.drain();
    // …then fresh.
    await eventually(
      async () => (await admin.client.get("/api/v1/analytics/overview")).json().total === 1,
    );
  });
});
