import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";
import { deadLetterEvents, outboxEvents, processedEvents, type Db, type Tx } from "@civicpulse/db";
import type { EventEnvelope } from "@civicpulse/shared";

export interface EventConsumer {
  /** Consumer group name; idempotency is tracked per group. */
  group: string;
  handle(tx: Tx, event: EventEnvelope): Promise<void>;
}

interface PumpLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface EventPump {
  /** Process everything currently due. Returns the number of events published. */
  drain(): Promise<number>;
  start(intervalMs?: number): void;
  stop(): Promise<void>;
}

const BATCH_SIZE = 25;
const MAX_ATTEMPTS = 5;

/**
 * In-process outbox relay and consumer runner (the "memory" broker of EVENT_DESIGN.md §8).
 *
 * Guarantees: at-least-once delivery from the outbox; each consumer group handles an event
 * at most once (processed_events); a consumer that keeps failing is dead-lettered after
 * MAX_ATTEMPTS so one bad event cannot block the rest. `FOR UPDATE SKIP LOCKED` makes it
 * safe to run several instances.
 */
export function createEventPump(db: Db, consumers: EventConsumer[], logger: PumpLogger): EventPump {
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<number> | undefined;

  async function processBatch(): Promise<number> {
    return db.withSystem(async (tx) => {
      const rows = await tx
        .select()
        .from(outboxEvents)
        .where(and(isNull(outboxEvents.publishedAt), lte(outboxEvents.nextAttemptAt, new Date())))
        .orderBy(asc(outboxEvents.createdAt))
        .limit(BATCH_SIZE)
        .for("update", { skipLocked: true });

      let published = 0;
      for (const row of rows) {
        const { actorId, ...payload } = row.payload as Record<string, unknown>;
        const event: EventEnvelope = {
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

        let failure: { group: string; error: Error } | undefined;
        for (const consumer of consumers) {
          try {
            // A savepoint per consumer: a failing handler rolls back only its own writes.
            await tx.transaction(async (sp) => {
              const claimed = await sp
                .insert(processedEvents)
                .values({ consumerGroup: consumer.group, eventId: event.id })
                .onConflictDoNothing()
                .returning({ eventId: processedEvents.eventId });
              if (claimed.length === 0) return; // already handled by this group
              await consumer.handle(sp, event);
            });
          } catch (error) {
            // Consumers are independent: one failing must not starve the others.
            // On retry, groups that already succeeded are skipped via processed_events.
            failure ??= { group: consumer.group, error: error as Error };
          }
        }

        if (!failure) {
          await tx
            .update(outboxEvents)
            .set({ publishedAt: new Date() })
            .where(eq(outboxEvents.id, row.id));
          published += 1;
          continue;
        }

        const attempts = row.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          await tx.insert(deadLetterEvents).values({
            consumerGroup: failure.group,
            eventId: event.id,
            topic: row.topic,
            eventType: row.eventType,
            payload: row.payload,
            headers: row.headers,
            error: failure.error.message.slice(0, 2000),
            attempts,
          });
          await tx
            .update(outboxEvents)
            .set({ publishedAt: new Date(), attempts, lastError: failure.error.message })
            .where(eq(outboxEvents.id, row.id));
          logger.error(
            { eventId: event.id, eventType: event.type, group: failure.group, err: failure.error },
            "event dead-lettered",
          );
        } else {
          await tx
            .update(outboxEvents)
            .set({
              attempts,
              lastError: failure.error.message.slice(0, 2000),
              // 2s, 4s, 8s, 16s
              nextAttemptAt: sql`now() + make_interval(secs => ${2 ** attempts})`,
            })
            .where(eq(outboxEvents.id, row.id));
          logger.warn(
            { eventId: event.id, eventType: event.type, group: failure.group, attempts },
            "event handling failed; will retry",
          );
        }
      }
      return published;
    });
  }

  async function drain(): Promise<number> {
    let total = 0;
    for (;;) {
      const count = await processBatch();
      total += count;
      if (count < BATCH_SIZE) return total;
    }
  }

  return {
    drain,
    start(intervalMs = 1000) {
      if (timer) return;
      timer = setInterval(() => {
        if (running) return; // previous tick still working
        running = drain()
          .catch((error: unknown) => {
            logger.error({ err: error }, "outbox pump tick failed");
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
