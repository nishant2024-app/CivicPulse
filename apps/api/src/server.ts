import { createRuntime } from "@civicpulse/events";
import { ConfigError, loadConfig } from "@civicpulse/platform";
import { buildApp } from "./app";

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  // Jobs go to BullMQ only when a separate workers process exists to run them.
  const runtime = createRuntime(config, {
    service: "api",
    useQueues: !!config.REDIS_URL && !config.EMBEDDED_WORKERS,
  });
  const { logger } = runtime;

  await runtime.storage
    .ensureReady()
    .catch((error: unknown) => logger.warn({ err: error }, "object storage is not ready yet"));
  if (runtime.search.driver === "opensearch") {
    await runtime.search
      .ensureIndex()
      .catch((error: unknown) => logger.warn({ err: error }, "search index is not ready yet"));
  }

  const app = await buildApp({
    config,
    db: runtime.db,
    mailer: runtime.mailer,
    storage: runtime.storage,
    cache: runtime.cache,
    queues: runtime.queues,
    search: runtime.search,
    metrics: runtime.metrics,
    redis: runtime.redis,
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "shutting down");
    try {
      await app.close(); // stops accepting connections, waits for in-flight requests
      await runtime.close();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, "error during shutdown");
      process.exit(1);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ host: config.HOST, port: config.PORT });
}

main().catch((error: unknown) => {
  console.error("Fatal startup error:", error);
  process.exit(1);
});
