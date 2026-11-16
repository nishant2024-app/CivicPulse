export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "BAD_REQUEST",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "CSRF_REJECTED",
  "NOT_FOUND",
  "CONFLICT",
  "INVALID_STATUS_TRANSITION",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
  "SERVICE_UNAVAILABLE",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: Array<{ path: string; message: string }>;
    requestId?: string;
  };
}

/** Header every state-changing request must carry (CSRF defence). */
export const CSRF_HEADER = "x-requested-with";
export const CSRF_HEADER_VALUE = "civicpulse";
