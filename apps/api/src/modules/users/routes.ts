import { eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { organizationMembers, users } from "@civicpulse/db";
import { deleteAccountSchema, meSchema, updateProfileSchema } from "@civicpulse/shared";
import { errors } from "../../errors";
import { requestMeta } from "../../http";
import { recordAudit } from "../audit/service";
import { verifyPassword } from "../auth/passwords";
import { getMe } from "../auth/service";
import { revokeAllSessions } from "../auth/sessions";

export const userRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook("preHandler", app.authenticate);

  app.patch(
    "/me",
    {
      schema: {
        tags: ["Users"],
        summary: "Update own profile",
        body: updateProfileSchema,
        response: { 200: meSchema },
      },
    },
    async (request) => {
      const auth = request.requireAuth();
      const { fullName, phone } = request.body;
      if (fullName !== undefined || phone !== undefined) {
        await app.db.withSystem((tx) =>
          tx
            .update(users)
            .set({
              ...(fullName !== undefined ? { fullName } : {}),
              ...(phone !== undefined ? { phone } : {}),
            })
            .where(eq(users.id, auth.user.id)),
        );
      }
      return getMe(app.db, auth);
    },
  );

  app.delete(
    "/me",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      schema: {
        tags: ["Users"],
        summary: "Delete own account",
        description:
          "Anonymizes the account, revokes all sessions and deactivates memberships. " +
          "Complaints already filed stay with the organization, attributed to an anonymous user.",
        body: deleteAccountSchema,
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (request, reply) => {
      const auth = request.requireAuth();
      const meta = requestMeta(request);
      await app.db.withSystem(async (tx) => {
        const [user] = await tx
          .select({ passwordHash: users.passwordHash })
          .from(users)
          .where(eq(users.id, auth.user.id))
          .limit(1);
        if (
          !user?.passwordHash ||
          !(await verifyPassword(user.passwordHash, request.body.password))
        ) {
          throw errors.badRequest("Password is incorrect");
        }
        await tx
          .update(users)
          .set({
            email: `deleted+${auth.user.id}@invalid`,
            fullName: "Deleted user",
            phone: null,
            passwordHash: null,
            isSuperAdmin: false,
            status: "DELETED",
            deletedAt: new Date(),
          })
          .where(eq(users.id, auth.user.id));
        await tx
          .update(organizationMembers)
          .set({ status: "REMOVED" })
          .where(eq(organizationMembers.userId, auth.user.id));
        await revokeAllSessions(tx, auth.user.id);
        await recordAudit(tx, {
          organizationId: null,
          actorId: auth.user.id,
          action: "user.deleted",
          entityType: "user",
          entityId: auth.user.id,
          ipAddress: meta.ipAddress,
          requestId: meta.requestId,
        });
      });
      app.clearSessionCookie(reply);
      return { ok: true as const };
    },
  );
};
