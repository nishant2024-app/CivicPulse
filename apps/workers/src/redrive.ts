/**
 * Re-run events that exhausted their retries (dead_letter_events), for example after
 * OpenSearch was down for longer than the in-process retries last.
 *
 *   node dist/redrive.js            # redrive every unresolved dead letter
 *   node dist/redrive.js search-index   # only one consumer group
 *
 * Handlers are idempotent, so redriving an event that was handled meanwhile is harmless.
 */
import { and, eq, isNull } from "drizzle-orm";
import { deadLetterEvents, processedEvents } from "@civicpulse/db";
import { ALL_HANDLERS, createRuntime, handleOnce } from "@civicpulse/events";
import { loadConfig } from "@civicpulse/platform";
import { eventEnvelopeSchema } from "@civicpulse/shared";

const group = process.argv[2];
const config = loadConfig();
const runtime = createRuntime(config, { service: "workers", useQueues: !!config.REDIS_URL });
const deps = {
  db: runtime.db,
  logger: runtime.logger,
  search: runtime.search,
  cache: runtime.cache,
  queues: runtime.queues,
  mailer: runtime.mailer,
  storage: runtime.storage,
  webOrigin: config.WEB_ORIGIN,
  metrics: runtime.metrics,
};
let redriven = 0;
let failed = 0;
try {
  const rows = await runtime.db.withSystem((tx) =>
    tx
      .select()
      .from(deadLetterEvents)
      .where(
        and(
          isNull(deadLetterEvents.resolvedAt),
          group ? eq(deadLetterEvents.consumerGroup, group) : undefined,
        ),
      ),
  );
  for (const row of rows) {
    const handler = ALL_HANDLERS.find((candidate) => candidate.group === row.consumerGroup);
    const event = eventEnvelopeSchema.safeParse(row.payload);
    if (!handler || !event.success) {
      console.error(`skipping ${row.id}: unknown group or malformed event`);
      failed += 1;
      continue;
    }
    try {
      // The failed attempt rolled back its idempotency claim, but clear it defensively.
      await runtime.db.withSystem((tx) =>
        tx
          .delete(processedEvents)
          .where(
            and(
              eq(processedEvents.consumerGroup, handler.group),
              eq(processedEvents.eventId, event.data.id),
            ),
          ),
      );
      await handleOnce(deps, handler, event.data);
      await runtime.db.withSystem((tx) =>
        tx
          .update(deadLetterEvents)
          .set({ resolvedAt: new Date() })
          .where(eq(deadLetterEvents.id, row.id)),
      );
      redriven += 1;
    } catch (error) {
      console.error(`redrive of ${row.id} failed: ${(error as Error).message}`);
      failed += 1;
    }
  }
  console.log(`Redriven ${redriven} dead letter(s); ${failed} still failing`);
  process.exitCode = failed > 0 ? 1 : 0;
} finally {
  await runtime.close();
}
