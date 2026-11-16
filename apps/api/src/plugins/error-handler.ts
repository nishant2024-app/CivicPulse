import type { FastifyError, FastifyInstance } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from "fastify-type-provider-zod";
import type { ApiErrorBody, ErrorCode } from "@civicpulse/shared";
import { AppError } from "../errors";

const CODE_BY_STATUS: Record<number, ErrorCode> = {
  400: "BAD_REQUEST",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  429: "RATE_LIMITED",
  503: "SERVICE_UNAVAILABLE",
};

/** Maps every failure to the documented error envelope. Internals never reach the client. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    const body: ApiErrorBody = {
      error: { code: "NOT_FOUND", message: "Route not found", requestId: request.id },
    };
    return reply.status(404).send(body);
  });

  app.setErrorHandler((error: FastifyError | AppError | Error, request, reply) => {
    const send = (
      status: number,
      code: ErrorCode,
      message: string,
      details?: ApiErrorBody["error"]["details"],
    ) => {
      const body: ApiErrorBody = {
        error: { code, message, ...(details ? { details } : {}), requestId: request.id },
      };
      return reply.status(status).send(body);
    };

    if (error instanceof AppError) {
      return send(error.statusCode, error.code, error.message, error.details);
    }

    if (hasZodFastifySchemaValidationErrors(error)) {
      const details = error.validation.map((issue) => ({
        path: issue.instancePath.replace(/^\//, "").replaceAll("/", ".") || "(root)",
        message: issue.message ?? "Invalid value",
      }));
      return send(400, "VALIDATION_ERROR", "Invalid request", details);
    }

    if (isResponseSerializationError(error)) {
      // A handler produced data that violates its own response schema: our bug.
      request.log.error({ err: error }, "response serialization failed");
      return send(500, "INTERNAL_ERROR", "Something went wrong");
    }

    const status = "statusCode" in error ? (error.statusCode ?? 500) : 500;
    if (status >= 400 && status < 500) {
      const code = CODE_BY_STATUS[status] ?? "BAD_REQUEST";
      const message = status === 429 ? "Too many requests. Try again shortly." : error.message;
      return send(status, code, message);
    }

    request.log.error({ err: error }, "unhandled error");
    return send(500, "INTERNAL_ERROR", "Something went wrong");
  });
}
