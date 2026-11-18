import type { Db, Tx } from "@civicpulse/db";
import type {
  Cache,
  JobQueues,
  Logger,
  Mailer,
  Metrics,
  ObjectStorage,
  SearchIndex,
} from "@civicpulse/platform";
import type { EventEnvelope } from "@civicpulse/shared";

/** Everything a handler or job may touch. Optional services have in-process fallbacks. */
export interface EventDeps {
  db: Db;
  logger: Logger;
  search: SearchIndex;
  cache: Cache;
  /** Null when Redis is not configured: callers run the work inline instead. */
  queues: JobQueues | null;
  mailer: Mailer;
  storage: ObjectStorage;
  webOrigin: string;
  metrics?: Metrics;
}

/** Work to do after the handler's transaction has committed (queueing, network calls). */
export type AfterCommit = () => Promise<void>;

export interface EventHandler {
  /** Consumer group. Idempotency is tracked per group in `processed_events`. */
  group: string;
  handle(tx: Tx, event: EventEnvelope, deps: EventDeps): Promise<void | AfterCommit>;
}

/** Carries an envelope to consumers. Kafka in production; in-process otherwise. */
export interface Broker {
  readonly driver: "kafka" | "memory";
  publish(event: EventEnvelope, headers: Record<string, string>): Promise<void>;
}
