import fp from "fastify-plugin";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { TenantContext } from "@civicpulse/db";
import {
  CSRF_HEADER,
  CSRF_HEADER_VALUE,
  hasPermission,
  type Permission,
} from "@civicpulse/shared";
import { AppError, errors } from "../errors";
import { resolveSession, SESSION_COOKIE, type AuthContext } from "../modules/auth/sessions";

declare module "fastify" {
  interface FastifyRequest {
    /** Populated for every request carrying a valid session cookie. */
    auth: AuthContext | null;
    /** The authenticated context, or a 401. */
    requireAuth(): AuthContext;
    /** Tenant context for the active organization, or a 4xx if there is none. */
    tenant(): TenantContext & { auth: AuthContext };
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requirePermission: (
      permission: Permission,
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): void;
    clearSessionCookie(reply: FastifyReply): void;
    /** Resolve a freshly issued session token (used right after login/registration). */
    resolveToken(token: string): Promise<AuthContext>;
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const authPlugin = fp(async (app) => {
  const { config, db } = app;
  const ttl = {
    ttlHours: config.SESSION_TTL_HOURS,
    absoluteTtlHours: config.SESSION_ABSOLUTE_TTL_HOURS,
  };

  app.decorateRequest("auth", null);

  app.decorateRequest("requireAuth", function (this: FastifyRequest) {
    if (!this.auth) throw errors.unauthenticated();
    return this.auth;
  });

  app.decorateRequest("tenant", function (this: FastifyRequest) {
    const auth = this.requireAuth();
    if (!auth.activeOrganizationId || !auth.role) {
      throw errors.forbidden("Join or select an organization first");
    }
    return { organizationId: auth.activeOrganizationId, userId: auth.user.id, auth };
  });

  const cookieOptions = {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: config.isProduction,
  };

  app.decorate("setSessionCookie", (reply: FastifyReply, token: string, expiresAt: Date) => {
    void reply.setCookie(SESSION_COOKIE, token, { ...cookieOptions, expires: expiresAt });
  });
  app.decorate("clearSessionCookie", (reply: FastifyReply) => {
    void reply.clearCookie(SESSION_COOKIE, cookieOptions);
  });

  // CSRF: browsers cannot attach a custom header to a cross-site form post, and a
  // cross-site fetch with one triggers a preflight that we never approve.
  app.addHook("onRequest", async (request) => {
    if (SAFE_METHODS.has(request.method) || !request.url.startsWith("/api/")) return;
    if (request.headers[CSRF_HEADER] !== CSRF_HEADER_VALUE) {
      throw new AppError("CSRF_REJECTED", `Missing ${CSRF_HEADER} header`);
    }
    const origin = request.headers.origin;
    if (origin && !config.allowedOrigins.includes(origin.replace(/\/$/, ""))) {
      throw new AppError("CSRF_REJECTED", "Origin not allowed");
    }
  });

  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/")) return;
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return;
    request.auth = await db.withSystem((tx) => resolveSession(tx, token, ttl));
    if (!request.auth) app.clearSessionCookie(reply);
  });

  app.decorate("resolveToken", async (token: string) => {
    const auth = await db.withSystem((tx) => resolveSession(tx, token, ttl));
    if (!auth) throw errors.unauthenticated();
    return auth;
  });

  app.decorate("authenticate", async (request: FastifyRequest) => {
    request.requireAuth();
  });

  app.decorate("requirePermission", (permission: Permission) => async (request: FastifyRequest) => {
    const auth = request.requireAuth();
    if (!hasPermission(auth.role, permission)) throw errors.forbidden();
  });
});
