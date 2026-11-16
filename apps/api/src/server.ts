import { createDb } from "@civicpulse/db";
import {
  ConfigError,
  createLocalStorage,
  createLogger,
  createLogMailer,
  loadConfig,
} from "@civicpulse/platform";
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

  const db = createDb({
    connectionString: config.DATABASE_URL,
    maxConnections: config.DATABASE_POOL_MAX,
  });
  const mailer = createLogMailer(createLogger(config.LOG_LEVEL, "mailer"), {
    logBodies: !config.isProduction,
  });
  const storage = createLocalStorage({
    directory: config.STORAGE_LOCAL_DIR,
    signingSecret: config.SESSION_SECRET,
    urlPrefix: "/api/v1/files",
  });
  const app = await buildApp({ config, db, mailer, storage });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "shutting down");
    try {
      await app.close(); // stops accepting connections, waits for in-flight requests
      await db.close();
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
