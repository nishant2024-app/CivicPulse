import { createDb, type Db } from "@civicpulse/db";
import {
  createLocalStorage,
  createLogger,
  createLogMailer,
  createJobQueues,
  createMemoryCache,
  createMetrics,
  createOpenSearchIndex,
  createPostgresSearchMarker,
  createRedis,
  createRedisCache,
  createS3Storage,
  createSmtpMailer,
  startTelemetry,
  type AppConfig,
  type Cache,
  type JobQueues,
  type Logger,
  type Mailer,
  type Metrics,
  type ObjectStorage,
  type Redis,
  type SearchIndex,
  type Telemetry,
} from "@civicpulse/platform";

/** Every service a process may use, built from configuration with the right fallbacks. */
export interface Runtime {
  config: AppConfig;
  logger: Logger;
  db: Db;
  metrics: Metrics;
  telemetry: Telemetry;
  /** Fail-fast connection used for caching and rate limiting; null without REDIS_URL. */
  redis: Redis | null;
  cache: Cache;
  /** Producers for BullMQ; null means "run the work inline". */
  queues: JobQueues | null;
  search: SearchIndex;
  storage: ObjectStorage;
  mailer: Mailer;
  close(): Promise<void>;
}

export interface RuntimeOptions {
  /** "api" or "workers": names the metrics, logs and traces. */
  service: string;
  /** Create BullMQ producers. Requires REDIS_URL. */
  useQueues: boolean;
}

export function createRuntime(config: AppConfig, options: RuntimeOptions): Runtime {
  const logger = createLogger(config.LOG_LEVEL, options.service);
  const telemetry = startTelemetry({
    serviceName: config.OTEL_SERVICE_NAME ?? `civicpulse-${options.service}`,
    endpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
  });
  const metrics = createMetrics(options.service);
  const db = createDb({
    connectionString: config.DATABASE_URL,
    maxConnections: config.DATABASE_POOL_MAX,
    onQuery: (ms, failed) =>
      metrics.dbQuery.observe({ outcome: failed ? "error" : "ok" }, ms / 1000),
  });

  const redis = config.REDIS_URL
    ? createRedis(config.REDIS_URL, logger, { mode: "fast-fail", name: options.service })
    : null;
  const hooks = {
    onResult: (result: "hit" | "miss" | "error") => metrics.cacheResults.inc({ result }),
  };
  const cache = redis ? createRedisCache(redis, hooks) : createMemoryCache(hooks);
  const queues = redis && options.useQueues ? createJobQueues(redis, logger) : null;

  const search =
    config.SEARCH_DRIVER === "opensearch" && config.OPENSEARCH_URL
      ? createOpenSearchIndex(config.OPENSEARCH_URL, config.OPENSEARCH_INDEX, {
          onRequest: (operation, seconds, ok) =>
            metrics.searchDuration.observe({ operation, outcome: ok ? "ok" : "error" }, seconds),
        })
      : createPostgresSearchMarker();

  const urlPrefix = "/api/v1/files";
  const storage =
    config.STORAGE_DRIVER === "s3"
      ? createS3Storage({
          ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT } : {}),
          ...(config.S3_PUBLIC_ENDPOINT ? { publicEndpoint: config.S3_PUBLIC_ENDPOINT } : {}),
          region: config.S3_REGION,
          bucket: config.S3_BUCKET!,
          accessKeyId: config.S3_ACCESS_KEY_ID!,
          secretAccessKey: config.S3_SECRET_ACCESS_KEY!,
          forcePathStyle: config.S3_FORCE_PATH_STYLE,
          signingSecret: config.SESSION_SECRET,
          urlPrefix,
        })
      : createLocalStorage({
          directory: config.STORAGE_LOCAL_DIR,
          signingSecret: config.SESSION_SECRET,
          urlPrefix,
        });

  const mailer =
    config.EMAIL_DRIVER === "smtp" && config.SMTP_URL
      ? createSmtpMailer(config.SMTP_URL, config.EMAIL_FROM)
      : createLogMailer(logger, { logBodies: !config.isProduction });

  return {
    config,
    logger,
    db,
    metrics,
    telemetry,
    redis,
    cache,
    queues,
    search,
    storage,
    mailer,
    async close() {
      await queues?.close();
      redis?.disconnect();
      await search.close().catch(() => undefined);
      await db.close();
      await telemetry.shutdown().catch(() => undefined);
    },
  };
}
