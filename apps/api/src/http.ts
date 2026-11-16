import type { FastifyRequest } from "fastify";
import type { Pagination } from "@civicpulse/shared";
import type { RequestMeta } from "./modules/auth/service";

export function requestMeta(request: FastifyRequest): RequestMeta {
  const userAgent = request.headers["user-agent"];
  return {
    ipAddress: request.ip ?? null,
    userAgent: typeof userAgent === "string" ? userAgent : null,
    requestId: request.id,
  };
}

export function paginate(page: number, pageSize: number, total: number): Pagination {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
