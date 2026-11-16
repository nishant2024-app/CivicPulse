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

  RATE_LIMIT_ENABLED: booleanFromEnv(true),
  API_DOCS_ENABLED: booleanFromEnv(true),
  /** Allow any signed-in user to create an organization (they become its admin). */
  SELF_SERVICE_ORGANIZATIONS: booleanFromEnv(true),

  EMAIL_DRIVER: z.enum(["log"]).default("log"),
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
  if (isProduction && !env.WEB_ORIGIN.startsWith("https://")) {
    problems.push("WEB_ORIGIN: must be https in production");
  }
  if (problems.length > 0) throw new ConfigError(problems);

  const allowedOrigins = [...new Set([env.WEB_ORIGIN, ...env.ALLOWED_ORIGINS])].map((origin) =>
    origin.replace(/\/$/, ""),
  );

  return { ...env, isProduction, isTest: env.NODE_ENV === "test", allowedOrigins };
}
