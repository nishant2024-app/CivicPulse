import { Redis } from "ioredis";
import type { Logger } from "pino";

export type { Redis };

export interface RedisOptions {
  /**
   * "fast-fail": commands error immediately while Redis is unreachable, so a Redis outage
   * degrades features instead of stalling requests. "blocking": for BullMQ workers, which
   * must keep waiting and reconnecting.
   */
  mode: "fast-fail" | "blocking";
  name: string;
}

/** Create a Redis connection that never throws on connection errors. */
export function createRedis(url: string, logger: Logger, options: RedisOptions): Redis {
  const failFast = options.mode === "fast-fail";
  const client = new Redis(url, {
    connectionName: `civicpulse-${options.name}`,
    maxRetriesPerRequest: failFast ? 1 : null,
    enableOfflineQueue: !failFast,
    connectTimeout: 3000,
    retryStrategy: (attempt) => Math.min(attempt * 250, 5000),
  });
  let lastLogged = 0;
  client.on("error", (error) => {
    // Reconnect attempts repeat the same error; log it at most every 30 seconds.
    if (Date.now() - lastLogged > 30_000) {
      lastLogged = Date.now();
      logger.warn({ err: error, redis: options.name }, "redis connection error");
    }
  });
  client.on("ready", () => logger.info({ redis: options.name }, "redis connected"));
  return client;
}
