import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { type FastifyInstance } from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { randomUUID } from "node:crypto";
import multipart from "@fastify/multipart";
import type { Db } from "@civicpulse/db";
import {
  ALL_HANDLERS,
  createMemoryBroker,
  createRelay,
  type EventDeps,
  type Relay,
} from "@civicpulse/events";
import {
  loggerOptions,
  type AppConfig,
  type Cache,
  type JobQueues,
  type Logger,
  type Mailer,
  type Metrics,
  type ObjectStorage,
  type Redis,
  type SearchIndex,
} from "@civicpulse/platform";
import { analyticsRoutes } from "./modules/analytics/routes";
import { authRoutes } from "./modules/auth/routes";
import { complaintRoutes } from "./modules/complaints/routes";
import { departmentRoutes } from "./modules/departments/routes";
import { fileRoutes } from "./modules/files/routes";
import { healthRoutes } from "./modules/health/routes";
import { notificationRoutes } from "./modules/notifications/routes";
import { organizationAdminRoutes } from "./modules/organizations/admin-routes";
import { organizationRoutes } from "./modules/organizations/routes";
import { searchRoutes } from "./modules/search/routes";
import { trackingRoutes } from "./modules/tracking/routes";
import { userRoutes } from "./modules/users/routes";
import { authPlugin } from "./plugins/auth";
import { observabilityPlugin } from "./plugins/observability";
import { registerErrorHandler } from "./plugins/error-handler";

declare module "fastify" {
  interface FastifyInstance {
    config: AppConfig;
    db: Db;
    mailer: Mailer;
    storage: ObjectStorage;
    cache: Cache;
    /** Null when jobs run inline (no Redis, or workers embedded in this process). */
    queues: JobQueues | null;
    searchIndex: SearchIndex;
    metrics: Metrics;
    redis: Redis | null;
    /** Outbox relay running in this process; null when a separate worker process owns it. */
    events: Relay | null;
    eventDeps: EventDeps;
  }
}

export interface AppDependencies {
  config: AppConfig;
  db: Db;
  mailer: Mailer;
  storage: ObjectStorage;
  cache: Cache;
  queues: JobQueues | null;
  search: SearchIndex;
  metrics: Metrics;
  /** Connection used as the rate-limit store; null for in-process counters. */
  redis: Redis | null;
}

/** Assemble the HTTP application. All I/O dependencies are injected, so tests build the same app. */
export async function buildApp(deps: AppDependencies): Promise<FastifyInstance> {
  const { config } = deps;

  const app = Fastify({
    logger: loggerOptions(config.LOG_LEVEL, "api"),
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
    // Signed file URLs carry an encoded storage key in the path.
    routerOptions: { maxParamLength: 1000 },
    // Accept an inbound request ID only if it looks sane; otherwise mint one.
    genReqId: (request) => {
      const inbound = request.headers["x-request-id"];
      return typeof inbound === "string" && /^[\w-]{8,64}$/.test(inbound)
        ? inbound
        : `req_${randomUUID()}`;
    },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate("config", config);
  app.decorate("db", deps.db);
  app.decorate("mailer", deps.mailer);
  app.decorate("storage", deps.storage);

  app.decorate("cache", deps.cache);
  app.decorate("queues", deps.queues);
  app.decorate("searchIndex", deps.search);
  app.decorate("metrics", deps.metrics);
  app.decorate("redis", deps.redis);

  const eventDeps: EventDeps = {
    db: deps.db,
    logger: app.log as unknown as Logger,
    search: deps.search,
    cache: deps.cache,
    queues: deps.queues,
    mailer: deps.mailer,
    storage: deps.storage,
    webOrigin: config.WEB_ORIGIN,
    metrics: deps.metrics,
  };
  app.decorate("eventDeps", eventDeps);

  // Embedded mode: this process relays outbox events and runs every consumer itself.
  // With EVENT_BROKER=kafka the separate workers process does both, and the API only writes
  // to the outbox.
  const relay =
    config.EMBEDDED_WORKERS && config.EVENT_BROKER === "memory"
      ? createRelay(
          deps.db,
          createMemoryBroker(eventDeps, ALL_HANDLERS),
          app.log as unknown as Logger,
          deps.metrics,
        )
      : null;
  app.decorate("events", relay);
  if (relay && !config.isTest) relay.start();
  app.addHook("onClose", async () => {
    await relay?.stop();
  });

  registerErrorHandler(app);

  app.addHook("onSend", async (request, reply) => {
    void reply.header("x-request-id", request.id);
  });

  await app.register(helmet, {
    // The API serves JSON; the Swagger UI page is the only HTML and needs inline assets.
    contentSecurityPolicy: config.API_DOCS_ENABLED
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:"],
          },
        }
      : { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: "same-site" },
  });
  await app.register(cookie);
  await app.register(multipart, {
    limits: { fileSize: config.UPLOAD_MAX_BYTES, files: 1, fields: 5 },
    throwFileSizeLimit: true,
  });

  if (config.RATE_LIMIT_ENABLED) {
    await app.register(rateLimit, {
      global: true,
      max: 300,
      timeWindow: "1 minute",
      // Shared counters across replicas when Redis is available. If Redis fails, requests
      // are allowed rather than rejected: an outage must not take the API down with it.
      ...(deps.redis ? { redis: deps.redis, nameSpace: "cp:rl:", skipOnError: true } : {}),
      // Throwing lets the shared error handler render the standard envelope.
      errorResponseBuilder: (_request, context) => {
        const error = new Error("Too many requests") as Error & { statusCode: number };
        error.statusCode = context.statusCode;
        return error;
      },
    });
  }

  if (config.API_DOCS_ENABLED) {
    await app.register(swagger, {
      openapi: {
        info: {
          title: "CivicPulse API",
          version: "1.0.0",
          description:
            "Community issue reporting and resolution. Authenticate with the `cp_session` " +
            "cookie; state-changing requests must send `X-Requested-With: civicpulse`.",
        },
        components: {
          securitySchemes: { session: { type: "apiKey", in: "cookie", name: "cp_session" } },
        },
      },
      transform: jsonSchemaTransform,
    });
    await app.register(swaggerUi, { routePrefix: "/api/docs" });
  }

  await app.register(observabilityPlugin);
  await app.register(authPlugin);

  await app.register(healthRoutes);
  await app.register(
    async (v1) => {
      await v1.register(authRoutes, { prefix: "/auth" });
      await v1.register(userRoutes, { prefix: "/users" });
      await v1.register(organizationRoutes, { prefix: "/organizations" });
      await v1.register(organizationAdminRoutes);
      await v1.register(departmentRoutes, { prefix: "/departments" });
      await v1.register(complaintRoutes, { prefix: "/complaints" });
      await v1.register(trackingRoutes, { prefix: "/tracking" });
      await v1.register(notificationRoutes, { prefix: "/notifications" });
      await v1.register(analyticsRoutes, { prefix: "/analytics" });
      await v1.register(searchRoutes, { prefix: "/search" });
      await v1.register(fileRoutes, { prefix: "/files" });
    },
    { prefix: "/api/v1" },
  );

  return app;
}
