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
  loggerOptions,
  type AppConfig,
  type Mailer,
  type ObjectStorage,
} from "@civicpulse/platform";
import { notificationConsumer } from "./events/notification-consumer";
import { createEventPump, type EventPump } from "./events/pump";
import { analyticsRoutes } from "./modules/analytics/routes";
import { authRoutes } from "./modules/auth/routes";
import { complaintRoutes } from "./modules/complaints/routes";
import { departmentRoutes } from "./modules/departments/routes";
import { fileRoutes } from "./modules/files/routes";
import { healthRoutes } from "./modules/health/routes";
import { notificationRoutes } from "./modules/notifications/routes";
import { organizationAdminRoutes } from "./modules/organizations/admin-routes";
import { organizationRoutes } from "./modules/organizations/routes";
import { trackingRoutes } from "./modules/tracking/routes";
import { userRoutes } from "./modules/users/routes";
import { authPlugin } from "./plugins/auth";
import { registerErrorHandler } from "./plugins/error-handler";

declare module "fastify" {
  interface FastifyInstance {
    config: AppConfig;
    db: Db;
    mailer: Mailer;
    storage: ObjectStorage;
    events: EventPump;
  }
}

export interface AppDependencies {
  config: AppConfig;
  db: Db;
  mailer: Mailer;
  storage: ObjectStorage;
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

  // Outbox relay and consumers. Embedded by default; a separate worker can take over.
  const events = createEventPump(deps.db, [notificationConsumer], app.log);
  app.decorate("events", events);
  if (config.EMBEDDED_WORKERS && !config.isTest) events.start();
  app.addHook("onClose", () => events.stop());

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
      await v1.register(fileRoutes, { prefix: "/files" });
    },
    { prefix: "/api/v1" },
  );

  return app;
}
