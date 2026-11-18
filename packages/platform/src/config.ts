import { z } from "zod";

const booleanFromEnv = (defaultValue: boolean) =>
  z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((value) => (value === undefined ? defaultValue : value === "true" || value === "1"));

const csv = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );

const DEV_SESSION_SECRET = "dev-only-secret-change-me-dev-only-secret";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  /** Public origin of the web app; used for links in emails and as the default allowed origin. */
  WEB_ORIGIN: z.url().default("http://localhost:3000"),
  /** Extra origins allowed to send state-changing requests (comma separated). */
  ALLOWED_ORIGINS: csv,
  /** Set to true only when running behind a reverse proxy that sets X-Forwarded-*. */
  TRUST_PROXY: booleanFromEnv(false),

  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine((v) => /^postgres(ql)?:\/\//.test(v), "DATABASE_URL must be a postgres:// URL"),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),

  /** Used to derive HMAC keys (signed URLs). Must be overridden in production. */
  SESSION_SECRET: z.string().min(32).default(DEV_SESSION_SECRET),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .default(24 * 7),
  SESSION_ABSOLUTE_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .default(24 * 30),

  /**
   * Demonstration clusters are reached over plain HTTP. This explicit opt-in relaxes the
   * production rule that WEB_ORIGIN be https and marks cookies non-Secure. Never for real use.
   */
  ALLOW_INSECURE_HTTP: booleanFromEnv(false),
  RATE_LIMIT_ENABLED: booleanFromEnv(true),
  API_DOCS_ENABLED: booleanFromEnv(true),
  /** Allow any signed-in user to create an organization (they become its admin). */
  SELF_SERVICE_ORGANIZATIONS: booleanFromEnv(true),

  /** "local" stores uploads on disk; "s3" uses any S3-compatible service (SeaweedFS, R2, AWS). */
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default(".data/uploads"),
  S3_ENDPOINT: z.url().optional(),
  /** Endpoint browsers can reach, for presigned URLs. Unset: files are served through the API. */
  S3_PUBLIC_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: booleanFromEnv(true),
  UPLOAD_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .default(8 * 1024 * 1024),
  /** Process outbox events inside the API process. Turn off when a separate worker runs. */
  EMBEDDED_WORKERS: booleanFromEnv(true),

  /** Cache, rate limiting and job queues. Unset: in-process fallbacks. */
  REDIS_URL: z
    .string()
    .refine((v) => /^rediss?:\/\//.test(v), "REDIS_URL must be a redis:// URL")
    .optional(),

  /** "memory": events are handled in-process. "kafka": relayed to Kafka, consumed by workers. */
  EVENT_BROKER: z.enum(["memory", "kafka"]).default("memory"),
  KAFKA_BROKERS: csv,
  KAFKA_CLIENT_ID: z.string().default("civicpulse"),
  KAFKA_GROUP_PREFIX: z.string().default("civicpulse"),
  KAFKA_TOPIC_PREFIX: z.string().default("civicpulse"),

  /** "postgres": full-text search in the database. "opensearch": OpenSearch. */
  SEARCH_DRIVER: z.enum(["postgres", "opensearch"]).default("postgres"),
  OPENSEARCH_URL: z.url().optional(),
  OPENSEARCH_INDEX: z.string().default("civicpulse-complaints"),

  /** OTLP/HTTP endpoint of an OpenTelemetry collector or Jaeger. Unset: tracing is off. */
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
  OTEL_SERVICE_NAME: z.string().optional(),
  WORKER_PORT: z.coerce.number().int().min(1).max(65535).default(4100),

  EMAIL_DRIVER: z.enum(["log", "smtp"]).default("log"),
  /** e.g. smtp://mailpit:1025 or smtps://user:pass@smtp-relay.brevo.com:465 */
  SMTP_URL: z.string().optional(),
  EMAIL_FROM: z.string().default("CivicPulse <no-reply@civicpulse.local>"),
});

export type Env = z.infer<typeof envSchema>;

export interface AppConfig extends Env {
  isProduction: boolean;
  isTest: boolean;
  allowedOrigins: string[];
}

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid configuration:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

/**
 * Parse and validate environment variables. Throws ConfigError listing every problem,
 * so a misconfigured process fails at start instead of at first use.
 */
export function loadConfig(source: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`),
    );
  }
  const env = parsed.data;
  const isProduction = env.NODE_ENV === "production";

  const problems: string[] = [];
  if (isProduction && env.SESSION_SECRET === DEV_SESSION_SECRET) {
    problems.push("SESSION_SECRET: the development default must not be used in production");
  }
  if (isProduction && !env.ALLOW_INSECURE_HTTP && !env.WEB_ORIGIN.startsWith("https://")) {
    problems.push("WEB_ORIGIN: must be https in production");
  }
  if (env.EVENT_BROKER === "kafka" && env.KAFKA_BROKERS.length === 0) {
    problems.push("KAFKA_BROKERS: required when EVENT_BROKER=kafka");
  }
  if (env.SEARCH_DRIVER === "opensearch" && !env.OPENSEARCH_URL) {
    problems.push("OPENSEARCH_URL: required when SEARCH_DRIVER=opensearch");
  }
  if (env.STORAGE_DRIVER === "s3") {
    for (const name of ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const) {
      if (!env[name]) problems.push(`${name}: required when STORAGE_DRIVER=s3`);
    }
  }
  if (env.EMAIL_DRIVER === "smtp" && !env.SMTP_URL) {
    problems.push("SMTP_URL: required when EMAIL_DRIVER=smtp");
  }
  if (problems.length > 0) throw new ConfigError(problems);

  const allowedOrigins = [...new Set([env.WEB_ORIGIN, ...env.ALLOWED_ORIGINS])].map((origin) =>
    origin.replace(/\/$/, ""),
  );

  return { ...env, isProduction, isTest: env.NODE_ENV === "test", allowedOrigins };
}
