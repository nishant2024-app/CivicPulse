import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { complaints, departments, organizationMembers, users, type Tx } from "@civicpulse/db";
import {
  departmentInputSchema,
  departmentSchema,
  OPEN_STATUSES,
  uuidSchema,
  type Department,
} from "@civicpulse/shared";
import { errors, isUniqueViolation } from "../../errors";
import { requestMeta } from "../../http";
import { recordAudit } from "../audit/service";

const idParams = z.object({ id: uuidSchema });
const tags = ["Departments"];

async function loadDepartments(tx: Tx, id?: string): Promise<Department[]> {
  const rows = await tx
    .select({
      id: departments.id,
      name: departments.name,
      description: departments.description,
      isActive: departments.isActive,
      createdAt: departments.createdAt,
      managerId: users.id,
      managerName: users.fullName,
      workerCount: sql<number>`(select count(*)::int from ${organizationMembers} m where m.department_id = ${departments.id} and m.role = 'FIELD_WORKER' and m.status = 'ACTIVE')`,
      openComplaints: sql<number>`(select count(*)::int from ${complaints} c where c.department_id = ${departments.id} and c.deleted_at is null and c.status in ('REPORTED','VERIFIED','ASSIGNED','IN_PROGRESS','ON_HOLD','REOPENED'))`,
    })
    .from(departments)
    .leftJoin(users, eq(users.id, departments.managerUserId))
    .where(and(isNull(departments.deletedAt), id ? eq(departments.id, id) : undefined))
    .orderBy(asc(departments.name));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    isActive: row.isActive,
    manager:
      row.managerId && row.managerName ? { id: row.managerId, fullName: row.managerName } : null,
    workerCount: row.workerCount,
    openComplaints: row.openComplaints,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** Make `userId` the manager of the department: role, department and back-reference agree. */
async function installManager(tx: Tx, departmentId: string, userId: string): Promise<void> {
  const updated = await tx
    .update(organizationMembers)
    .set({ role: "DEPARTMENT_MANAGER", departmentId })
    .where(
      and(
        eq(organizationMembers.userId, userId),
        eq(organizationMembers.status, "ACTIVE"),
        // An organization administrator keeps the higher role.
        inArray(organizationMembers.role, ["CITIZEN", "FIELD_WORKER", "DEPARTMENT_MANAGER"]),
      ),
    )
    .returning({ id: organizationMembers.id });
  if (updated.length === 0) {
    const [member] = await tx
      .select({ role: organizationMembers.role })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, userId))
      .limit(1);
    if (!member) throw errors.badRequest("The manager must be a member of this organization");
  }
}

export const departmentRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/",
    {
      preHandler: app.requirePermission("department:read"),
      schema: {
        tags,
        summary: "Departments",
        response: { 200: z.object({ data: z.array(departmentSchema) }) },
      },
    },
    async (request) => ({
      data: await app.db.withTenant(request.tenant(), (tx) => loadDepartments(tx)),
    }),
  );

  app.post(
    "/",
    {
      preHandler: app.requirePermission("department:manage"),
      schema: {
        tags,
        summary: "Create a department",
        body: departmentInputSchema,
        response: { 201: departmentSchema },
      },
    },
    async (request, reply) => {
      const ctx = request.tenant();
      const meta = requestMeta(request);
      try {
        const department = await app.db.withTenant(ctx, async (tx) => {
          const [row] = await tx
            .insert(departments)
            .values({
              organizationId: ctx.organizationId,
              name: request.body.name,
              description: request.body.description ?? null,
              managerUserId: request.body.managerUserId ?? null,
            })
            .returning({ id: departments.id });
          if (request.body.managerUserId)
            await installManager(tx, row!.id, request.body.managerUserId);
          await recordAudit(tx, {
            organizationId: ctx.organizationId,
            actorId: ctx.userId,
            action: "department.created",
            entityType: "department",
            entityId: row!.id,
            metadata: { name: request.body.name },
            ipAddress: meta.ipAddress,
            requestId: meta.requestId,
          });
          return (await loadDepartments(tx, row!.id))[0]!;
        });
        return reply.status(201).send(department);
      } catch (error) {
        if (isUniqueViolation(error, "departments_org_name_uq")) {
          throw errors.conflict("A department with this name already exists");
        }
        throw error;
      }
    },
  );

  app.patch(
    "/:id",
    {
      preHandler: app.requirePermission("department:manage"),
      schema: {
        tags,
        summary: "Update a department",
        params: idParams,
        body: departmentInputSchema.partial().extend({ isActive: z.boolean().optional() }),
        response: { 200: departmentSchema },
      },
    },
    async (request) => {
      const ctx = request.tenant();
      const meta = requestMeta(request);
      const { name, description, managerUserId, isActive } = request.body;
      try {
        return await app.db.withTenant(ctx, async (tx) => {
          const updated = await tx
            .update(departments)
            .set({
              ...(name !== undefined ? { name } : {}),
              ...(description !== undefined ? { description } : {}),
              ...(managerUserId !== undefined ? { managerUserId } : {}),
              ...(isActive !== undefined ? { isActive } : {}),
            })
            .where(and(eq(departments.id, request.params.id), isNull(departments.deletedAt)))
            .returning({ id: departments.id });
          if (updated.length === 0) throw errors.notFound("Department");
          if (managerUserId) await installManager(tx, request.params.id, managerUserId);
          await recordAudit(tx, {
            organizationId: ctx.organizationId,
            actorId: ctx.userId,
            action: "department.updated",
            entityType: "department",
            entityId: request.params.id,
            metadata: { fields: Object.keys(request.body) },
            ipAddress: meta.ipAddress,
            requestId: meta.requestId,
          });
          return (await loadDepartments(tx, request.params.id))[0]!;
        });
      } catch (error) {
        if (isUniqueViolation(error, "departments_org_name_uq")) {
          throw errors.conflict("A department with this name already exists");
        }
        throw error;
      }
    },
  );

  app.delete(
    "/:id",
    {
      preHandler: app.requirePermission("department:manage"),
      schema: {
        tags,
        summary: "Remove a department",
        params: idParams,
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (request) => {
      const ctx = request.tenant();
      const meta = requestMeta(request);
      await app.db.withTenant(ctx, async (tx) => {
        const [open] = await tx
          .select({ value: count() })
          .from(complaints)
          .where(
            and(
              eq(complaints.departmentId, request.params.id),
              inArray(complaints.status, [...OPEN_STATUSES]),
              isNull(complaints.deletedAt),
            ),
          );
        if ((open?.value ?? 0) > 0) {
          throw errors.conflict(
            `This department still has ${open!.value} open complaint(s). Reassign them first.`,
          );
        }
        const removed = await tx
          .update(departments)
          .set({ deletedAt: new Date(), isActive: false })
          .where(and(eq(departments.id, request.params.id), isNull(departments.deletedAt)))
          .returning({ id: departments.id });
        if (removed.length === 0) throw errors.notFound("Department");
        await tx
          .update(organizationMembers)
          .set({ departmentId: null })
          .where(eq(organizationMembers.departmentId, request.params.id));
        await recordAudit(tx, {
          organizationId: ctx.organizationId,
          actorId: ctx.userId,
          action: "department.removed",
          entityType: "department",
          entityId: request.params.id,
          ipAddress: meta.ipAddress,
          requestId: meta.requestId,
        });
      });
      return { ok: true as const };
    },
  );

  app.get(
    "/:id/workers",
    {
      preHandler: app.requirePermission("complaint:triage"),
      schema: {
        tags,
        summary: "Field workers of a department, with their current load",
        params: idParams,
        response: {
          200: z.object({
            data: z.array(
              z.object({
                userId: uuidSchema,
                fullName: z.string(),
                activeAssignments: z.number().int(),
              }),
            ),
          }),
        },
      },
    },
    async (request) => ({
      data: await app.db.withTenant(request.tenant(), (tx) =>
        tx
          .select({
            userId: users.id,
            fullName: users.fullName,
            activeAssignments: sql<number>`(select count(*)::int from ${complaints} c where c.assigned_worker_id = ${users.id} and c.status in ('ASSIGNED','IN_PROGRESS','ON_HOLD') and c.deleted_at is null)`,
          })
          .from(organizationMembers)
          .innerJoin(users, eq(users.id, organizationMembers.userId))
          .where(
            and(
              eq(organizationMembers.departmentId, request.params.id),
              eq(organizationMembers.role, "FIELD_WORKER"),
              eq(organizationMembers.status, "ACTIVE"),
            ),
          )
          .orderBy(asc(users.fullName)),
      ),
    }),
  );
};
