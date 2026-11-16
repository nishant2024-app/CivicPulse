import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/healthz",
    {
      config: { rateLimit: false },
      schema: {
        tags: ["Operations"],
        summary: "Liveness: the process is running",
        response: { 200: z.object({ status: z.literal("ok") }) },
      },
    },
    async () => ({ status: "ok" as const }),
  );

  const readiness = z.object({
    status: z.enum(["ready", "not_ready"]),
    checks: z.object({ database: z.enum(["ok", "failed"]) }),
  });

  app.get(
    "/readyz",
    {
      config: { rateLimit: false },
      schema: {
        tags: ["Operations"],
        summary: "Readiness: required dependencies are reachable",
        response: { 200: readiness, 503: readiness },
      },
    },
    async (request, reply) => {
      try {
        await app.db.ping();
        return { status: "ready" as const, checks: { database: "ok" as const } };
      } catch (error) {
        request.log.warn({ err: error }, "readiness check failed");
        return reply
          .status(503)
          .send({ status: "not_ready" as const, checks: { database: "failed" as const } });
      }
    },
  );
};
