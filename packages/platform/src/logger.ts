import pino, { type Logger, type LoggerOptions } from "pino";

export type { Logger };

/** Paths removed from every log line. Keep in sync with docs/security/SECURITY.md §8. */
export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
  "password",
  "currentPassword",
  "newPassword",
  "token",
  "passwordHash",
  "*.password",
  "*.currentPassword",
  "*.newPassword",
  "*.token",
  "*.passwordHash",
  "*.signedUrl",
];

export function loggerOptions(level: string, service: string): LoggerOptions {
  return {
    level,
    base: { service },
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
  };
}

export function createLogger(level: string, service: string): Logger {
  return pino(loggerOptions(level, service));
}
