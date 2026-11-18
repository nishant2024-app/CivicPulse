import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { outboxEvents, type Db } from "@civicpulse/db";
import {
  contextFromHeaders,
  currentTraceHeaders,
  SpanKind,
  withSpan,
  type Logger,
  type Metrics,
} from "@civicpulse/platform";
import type { EventEnvelope } from "@civicpulse/shared";
import type { Broker } from "./types";

const BATCH_SIZE = 50;

export interface Relay {
  /** Publish everything currently pending. Returns the number of events published. */
  drain(): Promise<number>;
  start(intervalMs?: number): void;
  stop(): Promise<void>;
}

export function toEnvelope(row: typeof outboxEvents.$inferSelect): EventEnvelope {
  const { actorId, ...payload } = row.payload as Record<string, unknown>;
  return {
    id: row.id,
    type: row.eventType,
    occurredAt: row.createdAt.toISOString(),
    organizationId: row.organizationId,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    actorId: typeof actorId === "string" ? actorId : null,
    correlationId: row.headers["correlation-id"] ?? null,
    payload,
  };
}

/**
 * Transactional-outbox relay: reads committed events from PostgreSQL and hands them to the
 * broker, then marks them published. Delivery is at-least-once (a crash between publish
 * and mark repeats the event) which is why every consumer is idempotent.
 * `FOR UPDATE SKIP LOCKED` lets several relays run side by side. If the broker is down the
 * rows simply stay pending, in order, and the relay backs off.
 */
export function createRelay(db: Db, broker: Broker, logger: Logger, metrics?: Metrics): Relay {
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<number> | undefined;
  let failures = 0;
  let pausedUntil = 0;

  async function batch(): Promise<number> {
    return db.withSystem(async (tx) => {
      const rows = await tx
        .select()
        .from(outboxEvents)
        .where(isNull(outboxEvents.publishedAt))
        .orderBy(asc(outboxEvents.createdAt), asc(outboxEvents.id))
        .limit(BATCH_SIZE)
        .for("update", { skipLocked: true });

      let published = 0;
      for (const row of rows) {
        const envelope = toEnvelope(row);
        try {
          await withSpan(
            "outbox.publish",
            {
              kind: SpanKind.PRODUCER,
              parent: contextFromHeaders(row.headers),
              attributes: {
                "event.type": row.eventType,
                "event.id": row.id,
                "messaging.destination.name": row.topic,
              },
            },
            () => broker.publish(envelope, { ...row.headers, ...currentTraceHeaders() }),
          );
        } catch (error) {
          failures += 1;
          pausedUntil = Date.now() + Math.min(1000 * 2 ** Math.min(failures, 5), 30_000);
          await tx
            .update(outboxEvents)
            .set({
              attempts: sql`${outboxEvents.attempts} + 1`,
              lastError: (error as Error).message.slice(0, 2000),
            })
            .where(eq(outboxEvents.id, row.id));
          metrics?.outboxPublished.inc({ outcome: "failed" });
          logger.warn(
            { err: error, eventId: row.id, type: row.eventType },
            "outbox publish failed; will retry",
          );
          break; // keep order: later rows wait for this one
        }
        failures = 0;
        await tx
          .update(outboxEvents)
          .set({ publishedAt: new Date() })
          .where(and(eq(outboxEvents.id, row.id), isNull(outboxEvents.publishedAt)));
        metrics?.outboxPublished.inc({ outcome: "published" });
        published += 1;
      }
      return published;
    });
  }

  async function drain(): Promise<number> {
    let total = 0;
    for (;;) {
      if (Date.now() < pausedUntil) return total;
      const count = await batch();
      total += count;
      if (count < BATCH_SIZE) return total;
    }
  }

  return {
    drain,
    start(intervalMs = 1000) {
      if (timer) return;
      timer = setInterval(() => {
        if (running) return;
        running = drain()
          .catch((error: unknown) => {
            logger.error({ err: error }, "outbox relay tick failed");
            return 0;
          })
          .finally(() => {
            running = undefined;
          });
      }, intervalMs);
      timer.unref();
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
      await running;
    },
  };
}

/** Pending outbox rows and the age of the oldest, for metrics and health checks. */
export async function outboxStats(db: Db): Promise<{ pending: number; oldestSeconds: number }> {
  const result = await db.withSystem((tx) =>
    tx.execute(
      sql`select count(*)::int as pending,
                 coalesce(extract(epoch from (now() - min(created_at))), 0)::float8 as oldest
          from outbox_events where published_at is null`,
    ),
  );
  const row = result.rows[0] as { pending: number; oldest: number } | undefined;
  return { pending: row?.pending ?? 0, oldestSeconds: row?.oldest ?? 0 };
}
