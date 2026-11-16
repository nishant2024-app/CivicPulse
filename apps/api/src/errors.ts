import type { ApiErrorBody, ErrorCode } from "@civicpulse/shared";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  CSRF_REJECTED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_STATUS_TRANSITION: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

/** An error that is safe to show to the client. Anything else becomes a generic 500. */
export class AppError extends Error {
  readonly statusCode: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: ApiErrorBody["error"]["details"],
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = STATUS_BY_CODE[code];
  }
}

export const errors = {
  badRequest: (message: string) => new AppError("BAD_REQUEST", message),
  unauthenticated: (message = "Sign in to continue") => new AppError("UNAUTHENTICATED", message),
  forbidden: (message = "You do not have permission to do this") =>
    new AppError("FORBIDDEN", message),
  /** Also used for resources that exist in another organization. */
  notFound: (what = "Resource") => new AppError("NOT_FOUND", `${what} not found`),
  conflict: (message: string) => new AppError("CONFLICT", message),
};

/** PostgreSQL unique-violation check that does not depend on driver error classes. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  let current: unknown = error;
  // Drizzle wraps driver errors; walk the cause chain.
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    const candidate = current as { code?: string; constraint?: string; cause?: unknown };
    if (candidate.code === "23505") {
      return constraint ? candidate.constraint === constraint : true;
    }
    current = candidate.cause;
  }
  return false;
}
