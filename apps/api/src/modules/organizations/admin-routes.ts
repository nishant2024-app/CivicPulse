import { and, asc, count, desc, eq, ne } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  auditLogs,
  complaintCategories,
  departments,
  organizationMembers,
  users,
} from "@civicpulse/db";
import {
  auditLogSchema,
  categorySchema,
  memberSchema,
  paginated,
  paginationQuerySchema,
  updateCategorySchema,
  updateMemberSchema,
  uuidSchema,
} from "@civicpulse/shared";
import { errors } from "../../errors";
import { paginate, requestMeta } from "../../http";
import { recordAudit } from "../audit/service";

/** Member administration, categories and the audit trail of the active organization. */
export const organizationAdminRoutes: FastifyPluginAsyncZod = async (app) => {
  app.patch(
    "/organizations/current/members/:memberId",
    {
      preHandler: app.requirePermission("member:manage"),
      schema: {
        tags: ["Organizations"],
        summary: "Change a member's role, department or status",
        params: z.object({ memberId: uuidSchema }),
        body: updateMemberSchema,
        response: { 200: memberSchema },
      },
    },
    async (request) => {
      const ctx = request.tenant();
      const meta = requestMeta(request);
      return app.db.withTenant(ctx, async (tx) => {
        const [member] = await tx
          .select()
          .from(organizationMembers)
          .where(eq(organizationMembers.id, request.params.memberId))
          .for("update")
          .limit(1);
        if (!member) throw errors.notFound("Member");

        const role = request.body.role ?? member.role;
        const status = request.body.status ?? member.status;
        let departmentId =
          request.body.departmentId !== undefined ? request.body.departmentId : member.departmentId;

        // Never leave the organization without an active administrator.
        const losesAdmin =
          member.role === "ORGANIZATION_ADMIN" &&
          (role !== "ORGANIZATION_ADMIN" || status !== "ACTIVE");
        if (losesAdmin) {
          const [others] = await tx
            .select({ value: count() })
            .from(organizationMembers)
            .where(
              and(
                eq(organizationMembers.role, "ORGANIZATION_ADMIN"),
                eq(organizationMembers.status, "ACTIVE"),
                ne(organizationMembers.id, member.id),
              ),
            );
          if ((others?.value ?? 0) === 0) {
            throw errors.conflict("An organization needs at least one active administrator");
          }
        }

        const needsDepartment = role === "FIELD_WORKER" || role === "DEPARTMENT_MANAGER";
        if (needsDepartment && !departmentId) {
          throw errors.badRequest("Field workers and department managers need a department");
        }
        if (!needsDepartment) departmentId = null;
        if (departmentId) {
          const [department] = await tx
            .select({ id: departments.id })
            .from(departments)
            .where(eq(departments.id, departmentId))
            .limit(1);
          if (!department) throw errors.badRequest("Choose a valid department");
        }

        await tx
          .update(organizationMembers)
          .set({ role, status, departmentId })
          .where(eq(organizationMembers.id, member.id));

        // Keep departments.manager_user_id consistent with the role.
        if (
          member.role === "DEPARTMENT_MANAGER" &&
          (role !== "DEPARTMENT_MANAGER" || departmentId !== member.departmentId)
        ) {
          await tx
            .update(departments)
            .set({ managerUserId: null })
            .where(eq(departments.managerUserId, member.userId));
        }
        if (role === "DEPARTMENT_MANAGER" && departmentId && status === "ACTIVE") {
          await tx
            .update(departments)
            .set({ managerUserId: member.userId })
            .where(eq(departments.id, departmentId));
        }

        await recordAudit(tx, {
          organizationId: ctx.organizationId,
          actorId: ctx.userId,
          action: "member.updated",
          entityType: "member",
          entityId: member.id,
          metadata: {
            userId: member.userId,
            from: { role: member.role, status: member.status, departmentId: member.departmentId },
            to: { role, status, departmentId },
          },
          ipAddress: meta.ipAddress,
          requestId: meta.requestId,
        });

        const [row] = await tx
          .select({
            id: organizationMembers.id,
            userId: users.id,
            fullName: users.fullName,
            email: users.email,
            role: organizationMembers.role,
            departmentId: organizationMembers.departmentId,
            status: organizationMembers.status,
            joinedAt: organizationMembers.createdAt,
          })
          .from(organizationMembers)
          .innerJoin(users, eq(users.id, organizationMembers.userId))
          .where(eq(organizationMembers.id, member.id));
        return { ...row!, joinedAt: row!.joinedAt.toISOString() };
      });
    },
  );

  app.get(
    "/organizations/current/categories",
    {
      preHandler: app.requirePermission("organization:read"),
      schema: {
        tags: ["Organizations"],
        summary: "Complaint categories",
        response: { 200: z.object({ data: z.array(categorySchema) }) },
      },
    },
    async (request) => ({
      data: await app.db.withTenant(request.tenant(), (tx) =>
        tx
          .select({
            id: complaintCategories.id,
            name: complaintCategories.name,
            slug: complaintCategories.slug,
            defaultDepartmentId: complaintCategories.defaultDepartmentId,
            isActive: complaintCategories.isActive,
          })
          .from(complaintCategories)
          .orderBy(asc(complaintCategories.sortOrder), asc(complaintCategories.name)),
      ),
    }),
  );

  app.patch(
    "/organizations/current/categories/:id",
    {
      preHandler: app.requirePermission("category:manage"),
      schema: {
        tags: ["Organizations"],
        summary: "Route a category to a department, or switch it off",
        params: z.object({ id: uuidSchema }),
        body: updateCategorySchema,
        response: { 200: categorySchema },
      },
    },
    async (request) =>
      app.db.withTenant(request.tenant(), async (tx) => {
        const { defaultDepartmentId, isActive } = request.body;
        if (defaultDepartmentId) {
          const [department] = await tx
            .select({ id: departments.id })
            .from(departments)
            .where(eq(departments.id, defaultDepartmentId))
            .limit(1);
          if (!department) throw errors.badRequest("Choose a valid department");
        }
        const [row] = await tx
          .update(complaintCategories)
          .set({
            ...(defaultDepartmentId !== undefined ? { defaultDepartmentId } : {}),
            ...(isActive !== undefined ? { isActive } : {}),
          })
          .where(eq(complaintCategories.id, request.params.id))
          .returning({
            id: complaintCategories.id,
            name: complaintCategories.name,
            slug: complaintCategories.slug,
            defaultDepartmentId: complaintCategories.defaultDepartmentId,
            isActive: complaintCategories.isActive,
          });
        if (!row) throw errors.notFound("Category");
        return row;
      }),
  );

  app.get(
    "/audit-logs",
    {
      preHandler: app.requirePermission("audit:read"),
      schema: {
        tags: ["Audit"],
        summary: "Audit trail of the active organization, newest first",
        querystring: paginationQuerySchema,
        response: { 200: paginated(auditLogSchema) },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query;
      return app.db.withTenant(request.tenant(), async (tx) => {
        const [total] = await tx.select({ value: count() }).from(auditLogs);
        const rows = await tx
          .select({
            id: auditLogs.id,
            action: auditLogs.action,
            entityType: auditLogs.entityType,
            entityId: auditLogs.entityId,
            metadata: auditLogs.metadata,
            createdAt: auditLogs.createdAt,
            actorId: users.id,
            actorName: users.fullName,
          })
          .from(auditLogs)
          .leftJoin(users, eq(users.id, auditLogs.actorId))
          .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
          .limit(pageSize)
          .offset((page - 1) * pageSize);
        return {
          data: rows.map((row) => ({
            id: row.id,
            action: row.action,
            entityType: row.entityType,
            entityId: row.entityId,
            metadata: row.metadata,
            actor:
              row.actorId && row.actorName ? { id: row.actorId, fullName: row.actorName } : null,
            createdAt: row.createdAt.toISOString(),
          })),
          pagination: paginate(page, pageSize, total?.value ?? 0),
        };
      });
    },
  );
};
