import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Logger } from "@civicpulse/platform";
import {
  COMPLAINT_PRIORITIES,
  COMPLAINT_STATUSES,
  complaintSummarySchema,
  paginationQuerySchema,
  uuidSchema,
} from "@civicpulse/shared";
import { paginate } from "../../http";
import { searchComplaints } from "./service";

const segments = z.array(z.object({ text: z.string(), match: z.boolean() }));

const querySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(200).optional(),
  status: z.enum(COMPLAINT_STATUSES).optional(),
  priority: z.enum(COMPLAINT_PRIORITIES).optional(),
  categoryId: uuidSchema.optional(),
  departmentId: uuidSchema.optional(),
  /** "lat,lng" */
  near: z
    .string()
    .regex(/^-?\d{1,2}(\.\d+)?,-?\d{1,3}(\.\d+)?$/, "Use latitude,longitude")
    .optional(),
  radiusKm: z.coerce.number().min(0.05).max(200).default(2),
  sort: z.enum(["relevance", "createdAt", "updatedAt"]).default("relevance"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export const searchRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/complaints",
    {
      preHandler: app.requirePermission("search:use"),
      schema: {
        tags: ["Search"],
        summary: "Search complaints",
        description:
          "Full-text search with filters, sorting and highlighting. Results are limited to what the " +
          "caller may see. Powered by OpenSearch, with PostgreSQL as the fallback engine.",
        querystring: querySchema,
        response: {
          200: z.object({
            data: z.array(
              complaintSummarySchema.extend({
                highlights: z.object({
                  title: segments.optional(),
                  description: segments.optional(),
                  locationText: segments.optional(),
                }),
              }),
            ),
            pagination: z.object({
              page: z.number(),
              pageSize: z.number(),
              total: z.number(),
              totalPages: z.number(),
            }),
            meta: z.object({
              engine: z.enum(["opensearch", "postgres"]),
              degraded: z.boolean(),
              tookMs: z.number(),
            }),
          }),
        },
      },
    },
    async (request) => {
      const { near, radiusKm, ...rest } = request.query;
      const point = near ? near.split(",").map(Number) : null;
      const result = await searchComplaints(
        { db: app.db, index: app.searchIndex, logger: app.log as unknown as Logger },
        request.tenant(),
        {
          ...rest,
          // Without a query there is nothing to rank by.
          sort: !rest.q && rest.sort === "relevance" ? "createdAt" : rest.sort,
          ...(point ? { near: { lat: point[0]!, lon: point[1]!, radiusKm } } : {}),
        },
      );
      return {
        data: result.data,
        pagination: paginate(rest.page, rest.pageSize, result.total),
        meta: { engine: result.engine, degraded: result.degraded, tookMs: result.tookMs },
      };
    },
  );
};
