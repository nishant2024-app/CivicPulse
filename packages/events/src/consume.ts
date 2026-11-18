import { deadLetterEvents, processedEvents } from "@civicpulse/db";
import { contextFromHeaders, SpanKind, withSpan } from "@civicpulse/platform";
import type { EventEnvelope } from "@civicpulse/shared";
import type { AfterCommit, Broker, EventDeps, EventHandler } from "./types";

export type ConsumeResult = "processed" | "duplicate" | "dead-lettered";

export interface ConsumeOptions {
  maxAttempts?: number;
  /** Delay before the second attempt; doubles each time. */
  backoffMs?: number;
  /** Called after an event is dead-lettered, e.g. to mirror it to a Kafka topic. */
  onDeadLetter?: (event: EventEnvelope, group: string, error: string) => Promise<void>;
  headers?: Record<string, string>;
}

/** Run one handler for one event exactly once per consumer group (duplicates are skipped). */
export async function handleOnce(
  deps: EventDeps,
  handler: EventHandler,
  event: EventEnvelope,
): Promise<"processed" | "duplicate"> {
  let after: AfterCommit | undefined;
  let duplicate = false;
  await deps.db.withSystem(async (tx) => {
    const claimed = await tx
      .insert(processedEvents)
      .values({ consumerGroup: handler.group, eventId: event.id })
      .onConflictDoNothing()
      .returning({ eventId: processedEvents.eventId });
    if (claimed.length === 0) {
      duplicate = true;
      return;
    }
    const result = await handler.handle(tx, event, deps);
    if (typeof result === "function") after = result;
  });
  if (after) {
    try {
      await after();
    } catch (error) {
      // The transaction has committed; a failing side effect must not undo or repeat it.
      deps.logger.warn(
        { err: error, group: handler.group, eventId: event.id },
        "post-commit action failed",
      );
    }
  }
  return duplicate ? "duplicate" : "processed";
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Handle an event with retries; after the last attempt it is written to the dead-letter table
 * and processing moves on, so one poison event cannot block the stream.
 */
export async function consumeWithRetry(
  deps: EventDeps,
  handler: EventHandler,
  event: EventEnvelope,
  options: ConsumeOptions = {},
): Promise<ConsumeResult> {
  const maxAttempts = options.maxAttempts ?? 5;
  const backoff = options.backoffMs ?? 200;
  const parent = contextFromHeaders(options.headers ?? {});
  return withSpan(
    `consume ${handler.group}`,
    {
      kind: SpanKind.CONSUMER,
      parent,
      attributes: {
        "messaging.system": "civicpulse",
        "messaging.consumer.group": handler.group,
        "event.type": event.type,
        "event.id": event.id,
      },
    },
    async () => {
      let lastError: Error | undefined;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const result = await handleOnce(deps, handler, event);
          deps.metrics?.eventsHandled.inc({
            group: handler.group,
            type: event.type,
            outcome: result,
          });
          return result;
        } catch (error) {
          lastError = error as Error;
          deps.logger.warn(
            { err: error, group: handler.group, eventId: event.id, type: event.type, attempt },
            "event handler failed",
          );
          if (attempt < maxAttempts) await sleep(Math.min(backoff * 2 ** (attempt - 1), 5000));
        }
      }
      const message = (lastError?.message ?? "unknown error").slice(0, 2000);
      await deps.db.withSystem((tx) =>
        tx.insert(deadLetterEvents).values({
          consumerGroup: handler.group,
          eventId: event.id,
          topic: "civicpulse.complaints",
          eventType: event.type,
          payload: event,
          headers: options.headers ?? {},
          error: message,
          attempts: maxAttempts,
        }),
      );
      deps.metrics?.eventsHandled.inc({
        group: handler.group,
        type: event.type,
        outcome: "dead-lettered",
      });
      deps.metrics?.eventsDeadLettered.inc({ group: handler.group });
      deps.logger.error(
        { group: handler.group, eventId: event.id, type: event.type, error: message },
        "event dead-lettered",
      );
      await options
        .onDeadLetter?.(event, handler.group, message)
        .catch((error: unknown) =>
          deps.logger.warn({ err: error }, "could not mirror dead letter"),
        );
      return "dead-lettered";
    },
  );
}

/** Broker that runs consumers in the publishing process. For development and single-process hosting. */
export function createMemoryBroker(
  deps: EventDeps,
  handlers: EventHandler[],
  options: ConsumeOptions = {},
): Broker {
  return {
    driver: "memory",
    async publish(event, headers) {
      for (const handler of handlers)
        await consumeWithRetry(deps, handler, event, { ...options, headers });
    },
  };
}
