import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  meSchema,
  registerSchema,
  resetPasswordSchema,
  sessionInfoSchema,
  switchOrganizationSchema,
  uuidSchema,
} from "@civicpulse/shared";
import { requestMeta } from "../../http";
import * as service from "./service";

const AUTH_RATE_LIMIT = { rateLimit: { max: 10, timeWindow: "1 minute" } };
const okSchema = z.object({ ok: z.literal(true) });

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  const deps = { db: app.db, config: app.config, mailer: app.mailer };

  app.post(
    "/register",
    {
      config: AUTH_RATE_LIMIT,
      schema: {
        tags: ["Auth"],
        summary: "Register a citizen account",
        body: registerSchema,
        response: { 201: meSchema },
      },
    },
    async (request, reply) => {
      const session = await service.register(deps, request.body, requestMeta(request));
      app.setSessionCookie(reply, session.token, session.expiresAt);
      const auth = await app.resolveToken(session.token);
      return reply.status(201).send(await service.getMe(app.db, auth));
    },
  );

  app.post(
    "/login",
    {
      config: AUTH_RATE_LIMIT,
      schema: {
        tags: ["Auth"],
        summary: "Sign in",
        body: loginSchema,
        response: { 200: meSchema },
      },
    },
    async (request, reply) => {
      const session = await service.login(deps, request.body, requestMeta(request));
      app.setSessionCookie(reply, session.token, session.expiresAt);
      const auth = await app.resolveToken(session.token);
      return service.getMe(app.db, auth);
    },
  );

  app.post(
    "/logout",
    { schema: { tags: ["Auth"], summary: "Sign out", response: { 200: okSchema } } },
    async (request, reply) => {
      if (request.auth) await service.logout(app.db, request.auth, requestMeta(request));
      app.clearSessionCookie(reply);
      return { ok: true as const };
    },
  );

  app.get(
    "/me",
    {
      preHandler: app.authenticate,
      schema: { tags: ["Auth"], summary: "Current user", response: { 200: meSchema } },
    },
    async (request) => service.getMe(app.db, request.requireAuth()),
  );

  app.post(
    "/switch-organization",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["Auth"],
        summary: "Change the active organization of this session",
        body: switchOrganizationSchema,
        response: { 200: meSchema },
      },
    },
    async (request) => {
      const auth = request.requireAuth();
      await service.switchOrganization(app.db, auth, request.body.organizationId);
      const token = request.cookies.cp_session;
      return service.getMe(app.db, token ? await app.resolveToken(token) : auth);
    },
  );

  app.post(
    "/password/forgot",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      schema: {
        tags: ["Auth"],
        summary: "Request a password reset email",
        description: "Always responds 202, whether or not the email is registered.",
        body: forgotPasswordSchema,
        response: { 202: okSchema },
      },
    },
    async (request, reply) => {
      await service.requestPasswordReset(deps, request.body.email);
      return reply.status(202).send({ ok: true as const });
    },
  );

  app.post(
    "/password/reset",
    {
      config: AUTH_RATE_LIMIT,
      schema: {
        tags: ["Auth"],
        summary: "Set a new password with a reset token",
        body: resetPasswordSchema,
        response: { 200: okSchema },
      },
    },
    async (request) => {
      await service.resetPassword(app.db, request.body, requestMeta(request));
      return { ok: true as const };
    },
  );

  app.post(
    "/password/change",
    {
      preHandler: app.authenticate,
      config: AUTH_RATE_LIMIT,
      schema: {
        tags: ["Auth"],
        summary: "Change password (revokes other sessions)",
        body: changePasswordSchema,
        response: { 200: okSchema },
      },
    },
    async (request) => {
      await service.changePassword(
        app.db,
        request.requireAuth(),
        request.body,
        requestMeta(request),
      );
      return { ok: true as const };
    },
  );

  app.get(
    "/sessions",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["Auth"],
        summary: "List own active sessions",
        response: { 200: z.object({ data: z.array(sessionInfoSchema) }) },
      },
    },
    async (request) => ({ data: await service.listSessions(app.db, request.requireAuth()) }),
  );

  app.delete(
    "/sessions/:id",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["Auth"],
        summary: "Revoke one of own sessions",
        params: z.object({ id: uuidSchema }),
        response: { 200: okSchema },
      },
    },
    async (request) => {
      await service.revokeOwnSession(app.db, request.requireAuth(), request.params.id);
      return { ok: true as const };
    },
  );
};
