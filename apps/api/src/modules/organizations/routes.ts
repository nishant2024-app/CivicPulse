import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  createOrganizationSchema,
  emailSchema,
  MEMBER_ROLES,
  MEMBER_STATUSES,
  organizationSchema,
  organizationSettingsSchema,
  paginated,
  paginationQuerySchema,
  publicOrganizationSchema,
  uuidSchema,
} from "@civicpulse/shared";
import { errors } from "../../errors";
import { paginate, requestMeta } from "../../http";
import * as service from "./service";

const memberSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  fullName: z.string(),
  email: z.string(),
  role: z.enum(MEMBER_ROLES),
  departmentId: uuidSchema.nullable(),
  status: z.enum(MEMBER_STATUSES),
  joinedAt: z.iso.datetime(),
});

const updateOrganizationSchema = z.object({
  name: z.string().trim().min(3).max(120).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  contactEmail: emailSchema.nullable().optional(),
  settings: organizationSettingsSchema.partial().optional(),
});

export const organizationRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/public",
    {
      schema: {
        tags: ["Organizations"],
        summary: "Organizations open for citizen registration",
        response: { 200: z.object({ data: z.array(publicOrganizationSchema) }) },
      },
    },
    async () => ({ data: await service.listPublicOrganizations(app.db) }),
  );

  app.post(
    "/",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["Organizations"],
        summary: "Create an organization (the creator becomes its administrator)",
        body: createOrganizationSchema,
        response: { 201: organizationSchema },
      },
    },
    async (request, reply) => {
      const auth = request.requireAuth();
      if (!auth.user.isSuperAdmin && !app.config.SELF_SERVICE_ORGANIZATIONS) {
        throw errors.forbidden("Only platform administrators can create organizations");
      }
      const organization = await service.createOrganization(
        app.db,
        auth,
        request.body,
        requestMeta(request),
      );
      return reply.status(201).send(organization);
    },
  );

  app.get(
    "/",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["Organizations"],
        summary: "Organizations the caller belongs to (all, for super admins)",
        response: { 200: z.object({ data: z.array(organizationSchema) }) },
      },
    },
    async (request) => ({
      data: await service.listOrganizations(app.db, request.requireAuth()),
    }),
  );

  app.get(
    "/current/members",
    {
      preHandler: app.requirePermission("member:read"),
      schema: {
        tags: ["Organizations"],
        summary: "Members of the active organization",
        description: "Department managers see only members of their own department.",
        querystring: paginationQuerySchema,
        response: { 200: paginated(memberSchema) },
      },
    },
    async (request) => {
      const ctx = request.tenant();
      const { page, pageSize } = request.query;
      const { total, rows } = await service.listMembers(app.db, ctx, {
        page,
        pageSize,
        departmentId: ctx.auth.role === "DEPARTMENT_MANAGER" ? ctx.auth.departmentId : undefined,
      });
      return { data: rows, pagination: paginate(page, pageSize, total) };
    },
  );

  app.get(
    "/:id",
    {
      preHandler: app.requirePermission("organization:read"),
      schema: {
        tags: ["Organizations"],
        summary: "Organization profile",
        params: z.object({ id: uuidSchema }),
        response: { 200: organizationSchema },
      },
    },
    async (request) => service.getOrganization(app.db, request.tenant(), request.params.id),
  );

  app.patch(
    "/:id",
    {
      preHandler: app.requirePermission("organization:update"),
      schema: {
        tags: ["Organizations"],
        summary: "Update organization profile and settings",
        params: z.object({ id: uuidSchema }),
        body: updateOrganizationSchema,
        response: { 200: organizationSchema },
      },
    },
    async (request) =>
      service.updateOrganization(
        app.db,
        request.tenant(),
        request.params.id,
        request.body,
        requestMeta(request),
      ),
  );
};
