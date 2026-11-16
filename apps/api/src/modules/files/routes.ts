import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { errors } from "../../errors";

/** Serves objects from the local storage driver to holders of a valid signed URL. */
export const fileRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/:key",
    {
      schema: {
        tags: ["Files"],
        summary: "Download via signed URL (local storage driver)",
        params: z.object({ key: z.string().max(800) }),
        querystring: z.object({ exp: z.string().max(20), sig: z.string().max(100) }),
      },
    },
    async (request, reply) => {
      const key = app.storage.verifySignedRequest?.(
        request.params.key,
        request.query.exp,
        request.query.sig,
      );
      if (!key) throw errors.notFound("File");
      const object = await app.storage.get(key);
      if (!object) throw errors.notFound("File");
      return reply
        .header("content-type", object.contentType)
        .header("cache-control", "private, max-age=300")
        .header("x-content-type-options", "nosniff")
        .header("content-disposition", "inline")
        .send(object.body);
    },
  );
};
