import { and, count, desc, eq, isNull } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { notifications } from "@civicpulse/db";
import {
  notificationSchema,
  paginated,
  paginationQuerySchema,
  uuidSchema,
} from "@civicpulse/shared";
import { errors } from "../../errors";
import { paginate } from "../../http";

const tags = ["Notifications"];
const ok = z.object({ ok: z.literal(true) });

export const notificationRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook("preHandler", app.authenticate);

  app.get(
    "/",
    {
      schema: {
        tags,
        summary: "Own notifications in the active organization",
        querystring: paginationQuerySchema.extend({ unread: z.enum(["true", "false"]).optional() }),
        response: { 200: paginated(notificationSchema) },
      },
    },
    async (request) => {
      const ctx = request.tenant();
      const { page, pageSize, unread } = request.query;
      const where = and(
        eq(notifications.userId, ctx.auth.user.id),
        unread === "true" ? isNull(notifications.readAt) : undefined,
      );
      return app.db.withTenant(ctx, async (tx) => {
        const [total] = await tx.select({ value: count() }).from(notifications).where(where);
        const rows = await tx
          .select()
          .from(notifications)
          .where(where)
          .orderBy(desc(notifications.createdAt))
          .limit(pageSize)
          .offset((page - 1) * pageSize);
        return {
          data: rows.map((row) => ({
            id: row.id,
            type: row.type,
            title: row.title,
            body: row.body,
            complaintId: row.complaintId,
            readAt: row.readAt?.toISOString() ?? null,
            createdAt: row.createdAt.toISOString(),
          })),
          pagination: paginate(page, pageSize, total?.value ?? 0),
        };
      });
    },
  );

  app.get(
    "/unread-count",
    {
      schema: {
        tags,
        summary: "Unread notification count",
        response: { 200: z.object({ count: z.number().int() }) },
      },
    },
    async (request) => {
      const ctx = request.tenant();
      const [row] = await app.db.withTenant(ctx, (tx) =>
        tx
          .select({ value: count() })
          .from(notifications)
          .where(and(eq(notifications.userId, ctx.auth.user.id), isNull(notifications.readAt))),
      );
      return { count: row?.value ?? 0 };
    },
  );

  app.post(
    "/:id/read",
    {
      schema: {
        tags,
        summary: "Mark one as read",
        params: z.object({ id: uuidSchema }),
        response: { 200: ok },
      },
    },
    async (request) => {
      const ctx = request.tenant();
      const updated = await app.db.withTenant(ctx, (tx) =>
        tx
          .update(notifications)
          .set({ readAt: new Date() })
          .where(
            and(
              eq(notifications.id, request.params.id),
              eq(notifications.userId, ctx.auth.user.id),
            ),
          )
          .returning({ id: notifications.id }),
      );
      if (updated.length === 0) throw errors.notFound("Notification");
      return { ok: true as const };
    },
  );

  app.post(
    "/read-all",
    { schema: { tags, summary: "Mark all as read", response: { 200: ok } } },
    async (request) => {
      const ctx = request.tenant();
      await app.db.withTenant(ctx, (tx) =>
        tx
          .update(notifications)
          .set({ readAt: new Date() })
          .where(and(eq(notifications.userId, ctx.auth.user.id), isNull(notifications.readAt))),
      );
      return { ok: true as const };
    },
  );
};
