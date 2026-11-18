import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  complaintAssignments,
  complaintAttachments,
  complaintCategories,
  complaintComments,
  complaintFeedback,
  complaints,
  complaintStatusHistory,
  departments,
  organizationMembers,
  organizations,
  slaPolicies,
  users,
  type Db,
  type TenantContext,
  type Tx,
} from "@civicpulse/db";
import { generateTrackingId, type JobQueues, type ObjectStorage } from "@civicpulse/platform";
import {
  availableTransitions,
  checkTransition,
  EVENT_TOPICS,
  hasPermission,
  isOpenStatus,
  OPEN_STATUSES,
  organizationSettingsSchema,
  STAFF_ROLES,
  STATUS_EVENT,
  type AssignComplaintInput,
  type ChangeStatusInput,
  type ComplaintDetail,
  type ComplaintEventPayload,
  type ComplaintEventType,
  type ComplaintListQuery,
  type ComplaintPriority,
  type ComplaintStatus,
  type ComplaintSummary,
  type CreateComplaintInput,
  type Role,
  type TransitionActor,
} from "@civicpulse/shared";
import { AppError, errors, isUniqueViolation } from "../../errors";
import { emitEvent } from "@civicpulse/events";
import { recordAudit } from "../audit/service";
import type { RequestMeta } from "../auth/service";
import type { AuthContext } from "../auth/sessions";

export type Ctx = TenantContext & { auth: AuthContext };
type ComplaintRow = typeof complaints.$inferSelect;

const workerUser = alias(users, "worker_user");
const reporterUser = alias(users, "reporter_user");

const isStaff = (role: Role | null) => !!role && STAFF_ROLES.includes(role);

/**
 * Which complaints the caller may see at all (layer 2 of authorization).
 * Anything outside this predicate behaves as if it did not exist.
 */
function visibility(auth: AuthContext): SQL | undefined {
  const own = eq(complaints.reporterId, auth.user.id);
  switch (auth.role) {
    case "SUPER_ADMIN":
    case "ORGANIZATION_ADMIN":
      return undefined;
    case "DEPARTMENT_MANAGER":
      return auth.departmentId ? or(own, eq(complaints.departmentId, auth.departmentId)) : own;
    case "FIELD_WORKER":
      return or(own, eq(complaints.assignedWorkerId, auth.user.id));
    default:
      return own;
  }
}

function actorFor(auth: AuthContext, complaint: ComplaintRow): TransitionActor {
  return {
    role: auth.role ?? "CITIZEN",
    isAssignee: complaint.assignedWorkerId === auth.user.id,
    isReporter: complaint.reporterId === auth.user.id,
  };
}

function eventPayload(complaint: ComplaintRow, extra: Partial<ComplaintEventPayload> = {}) {
  const payload: ComplaintEventPayload = {
    complaintId: complaint.id,
    trackingId: complaint.trackingId,
    title: complaint.title,
    status: complaint.status,
    reporterId: complaint.reporterId,
    departmentId: complaint.departmentId,
    assignedWorkerId: complaint.assignedWorkerId,
    ...extra,
  };
  return payload as unknown as Record<string, unknown>;
}

async function emitComplaintEvent(
  tx: Tx,
  ctx: Ctx,
  type: ComplaintEventType,
  complaint: ComplaintRow,
  meta: RequestMeta,
  extra: Partial<ComplaintEventPayload> = {},
) {
  await emitEvent(tx, {
    topic: EVENT_TOPICS.complaints,
    type,
    organizationId: ctx.organizationId,
    aggregateType: "complaint",
    aggregateId: complaint.id,
    actorId: ctx.auth.user.id,
    correlationId: meta.requestId,
    payload: eventPayload(complaint, extra),
  });
}

/** Load one complaint the caller may see and lock it for the rest of the transaction. */
async function lockVisible(tx: Tx, ctx: Ctx, id: string): Promise<ComplaintRow> {
  const [row] = await tx
    .select()
    .from(complaints)
    .where(and(eq(complaints.id, id), isNull(complaints.deletedAt), visibility(ctx.auth)))
    .for("update")
    .limit(1);
  if (!row) throw errors.notFound("Complaint");
  return row;
}

/* ---------- create ---------- */

export async function createComplaint(
  db: Db,
  ctx: Ctx,
  input: CreateComplaintInput,
  meta: RequestMeta,
): Promise<{ id: string; trackingId: string }> {
  // A tracking ID collision is astronomically unlikely; retry rather than fail if it happens.
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.withTenant(ctx, async (tx) => {
        const [category] = await tx
          .select()
          .from(complaintCategories)
          .where(
            and(
              eq(complaintCategories.id, input.categoryId),
              eq(complaintCategories.isActive, true),
            ),
          )
          .limit(1);
        if (!category) throw errors.badRequest("Choose a valid category");

        const [organization] = await tx
          .select({ settings: organizations.settings })
          .from(organizations)
          .limit(1);
        const settings = organizationSettingsSchema.parse(organization?.settings ?? {});
        const maySetPriority = isStaff(ctx.auth.role) || settings.citizenCanSetPriority;

        const [complaint] = await tx
          .insert(complaints)
          .values({
            organizationId: ctx.organizationId,
            trackingId: generateTrackingId(),
            reporterId: ctx.auth.user.id,
            categoryId: category.id,
            departmentId: category.defaultDepartmentId,
            title: input.title,
            description: input.description,
            locationText: input.locationText,
            latitude: input.latitude ?? null,
            longitude: input.longitude ?? null,
            priority: maySetPriority && input.priority ? input.priority : "MEDIUM",
          })
          .returning();
        if (!complaint) throw new Error("complaint insert returned no row");

        await tx.insert(complaintStatusHistory).values({
          organizationId: ctx.organizationId,
          complaintId: complaint.id,
          fromStatus: null,
          toStatus: "REPORTED",
          changedBy: ctx.auth.user.id,
        });
        await emitComplaintEvent(tx, ctx, "complaint.created", complaint, meta);
        await recordAudit(tx, {
          organizationId: ctx.organizationId,
          actorId: ctx.auth.user.id,
          action: "complaint.created",
          entityType: "complaint",
          entityId: complaint.id,
          metadata: { trackingId: complaint.trackingId },
          ipAddress: meta.ipAddress,
          requestId: meta.requestId,
        });
        return { id: complaint.id, trackingId: complaint.trackingId };
      });
    } catch (error) {
      if (attempt < 2 && isUniqueViolation(error, "complaints_tracking_id_uq")) continue;
      throw error;
    }
  }
}

/* ---------- list ---------- */

const PRIORITY_ORDER = sql`case ${complaints.priority} when 'CRITICAL' then 4 when 'HIGH' then 3 when 'MEDIUM' then 2 else 1 end`;
const overdueSql = sql<boolean>`(${complaints.slaDueAt} is not null and ${complaints.slaDueAt} < now() and ${complaints.status} in ('REPORTED','VERIFIED','ASSIGNED','IN_PROGRESS','ON_HOLD','REOPENED'))`;

const summaryColumns = {
  id: complaints.id,
  trackingId: complaints.trackingId,
  title: complaints.title,
  status: complaints.status,
  priority: complaints.priority,
  categoryId: complaintCategories.id,
  categoryName: complaintCategories.name,
  departmentId: departments.id,
  departmentName: departments.name,
  workerId: workerUser.id,
  workerName: workerUser.fullName,
  locationText: complaints.locationText,
  slaDueAt: complaints.slaDueAt,
  isOverdue: overdueSql,
  createdAt: complaints.createdAt,
  updatedAt: complaints.updatedAt,
};

type SummaryRow = {
  id: string;
  trackingId: string;
  title: string;
  status: ComplaintStatus;
  priority: ComplaintPriority;
  categoryId: string;
  categoryName: string;
  departmentId: string | null;
  departmentName: string | null;
  workerId: string | null;
  workerName: string | null;
  locationText: string;
  slaDueAt: Date | null;
  isOverdue: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function toSummary(row: SummaryRow): ComplaintSummary {
  return {
    id: row.id,
    trackingId: row.trackingId,
    title: row.title,
    status: row.status,
    priority: row.priority,
    category: { id: row.categoryId, name: row.categoryName },
    department:
      row.departmentId && row.departmentName
        ? { id: row.departmentId, name: row.departmentName }
        : null,
    assignedWorker:
      row.workerId && row.workerName ? { id: row.workerId, fullName: row.workerName } : null,
    locationText: row.locationText,
    slaDueAt: row.slaDueAt?.toISOString() ?? null,
    isOverdue: row.isOverdue,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listComplaints(db: Db, ctx: Ctx, query: ComplaintListQuery, extra?: SQL) {
  const filters: Array<SQL | undefined> = [
    isNull(complaints.deletedAt),
    visibility(ctx.auth),
    extra,
  ];
  if (query.status) filters.push(eq(complaints.status, query.status));
  if (query.state === "open") filters.push(inArray(complaints.status, [...OPEN_STATUSES]));
  if (query.state === "overdue") filters.push(overdueSql);
  if (query.state === "unassigned") {
    filters.push(inArray(complaints.status, ["REPORTED", "VERIFIED", "REOPENED"]));
  }
  if (query.priority) filters.push(eq(complaints.priority, query.priority));
  if (query.categoryId) filters.push(eq(complaints.categoryId, query.categoryId));
  if (query.departmentId) filters.push(eq(complaints.departmentId, query.departmentId));
  if (query.mine === "true") filters.push(eq(complaints.reporterId, ctx.auth.user.id));
  if (query.q) {
    // Exact tracking ID, or full-text match on title/description/location.
    filters.push(
      or(
        eq(complaints.trackingId, query.q.toUpperCase()),
        sql`${complaints.searchVector} @@ websearch_to_tsquery('english', ${query.q})`,
      ),
    );
  }
  const where = and(...filters);

  const direction = query.order === "asc" ? asc : desc;
  const orderBy =
    query.sort === "priority"
      ? [direction(PRIORITY_ORDER), desc(complaints.createdAt)]
      : query.sort === "slaDueAt"
        ? [
            sql`${complaints.slaDueAt} ${sql.raw(query.order)} nulls last`,
            desc(complaints.createdAt),
          ]
        : query.sort === "updatedAt"
          ? [direction(complaints.updatedAt)]
          : [direction(complaints.createdAt)];

  return db.withTenant(ctx, async (tx) => {
    const [totalRow] = await tx.select({ value: count() }).from(complaints).where(where);
    const rows = await tx
      .select(summaryColumns)
      .from(complaints)
      .innerJoin(complaintCategories, eq(complaintCategories.id, complaints.categoryId))
      .leftJoin(departments, eq(departments.id, complaints.departmentId))
      .leftJoin(workerUser, eq(workerUser.id, complaints.assignedWorkerId))
      .where(where)
      .orderBy(...orderBy, asc(complaints.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    return { total: totalRow?.value ?? 0, rows: rows.map(toSummary) };
  });
}

/**
 * Load summaries for specific IDs, in the given order. This is the authority for search
 * results: anything the caller may not see, or that no longer exists, is dropped here even
 * if a stale search index still lists it.
 */
export async function summariesByIds(db: Db, ctx: Ctx, ids: string[]): Promise<ComplaintSummary[]> {
  if (ids.length === 0) return [];
  const rows = await db.withTenant(ctx, (tx) =>
    tx
      .select(summaryColumns)
      .from(complaints)
      .innerJoin(complaintCategories, eq(complaintCategories.id, complaints.categoryId))
      .leftJoin(departments, eq(departments.id, complaints.departmentId))
      .leftJoin(workerUser, eq(workerUser.id, complaints.assignedWorkerId))
      .where(and(inArray(complaints.id, ids), isNull(complaints.deletedAt), visibility(ctx.auth))),
  );
  const byId = new Map(rows.map((row) => [row.id, toSummary(row)]));
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

/* ---------- detail ---------- */

export async function getComplaint(
  db: Db,
  storage: ObjectStorage,
  ctx: Ctx,
  id: string,
): Promise<ComplaintDetail> {
  const { auth } = ctx;
  return db.withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({
        ...summaryColumns,
        complaint: complaints,
        reporterName: reporterUser.fullName,
      })
      .from(complaints)
      .innerJoin(complaintCategories, eq(complaintCategories.id, complaints.categoryId))
      .innerJoin(reporterUser, eq(reporterUser.id, complaints.reporterId))
      .leftJoin(departments, eq(departments.id, complaints.departmentId))
      .leftJoin(workerUser, eq(workerUser.id, complaints.assignedWorkerId))
      .where(and(eq(complaints.id, id), isNull(complaints.deletedAt), visibility(auth)))
      .limit(1);
    if (!row) throw errors.notFound("Complaint");
    const complaint = row.complaint;
    const staff = isStaff(auth.role);

    const history = await tx
      .select({
        id: complaintStatusHistory.id,
        fromStatus: complaintStatusHistory.fromStatus,
        toStatus: complaintStatusHistory.toStatus,
        note: complaintStatusHistory.note,
        createdAt: complaintStatusHistory.createdAt,
        userId: users.id,
        userName: users.fullName,
      })
      .from(complaintStatusHistory)
      .leftJoin(users, eq(users.id, complaintStatusHistory.changedBy))
      .where(eq(complaintStatusHistory.complaintId, id))
      .orderBy(asc(complaintStatusHistory.createdAt));

    const attachments = await tx
      .select()
      .from(complaintAttachments)
      .where(and(eq(complaintAttachments.complaintId, id), isNull(complaintAttachments.deletedAt)))
      .orderBy(asc(complaintAttachments.createdAt));

    const comments = await tx
      .select({
        id: complaintComments.id,
        body: complaintComments.body,
        isInternal: complaintComments.isInternal,
        createdAt: complaintComments.createdAt,
        authorId: users.id,
        authorName: users.fullName,
        authorRole: organizationMembers.role,
      })
      .from(complaintComments)
      .leftJoin(users, eq(users.id, complaintComments.authorId))
      .leftJoin(organizationMembers, eq(organizationMembers.userId, complaintComments.authorId))
      .where(
        and(
          eq(complaintComments.complaintId, id),
          isNull(complaintComments.deletedAt),
          // Internal notes never leave the staff side.
          staff ? undefined : eq(complaintComments.isInternal, false),
        ),
      )
      .orderBy(asc(complaintComments.createdAt));

    const [assignment] = await tx
      .select({
        id: complaintAssignments.id,
        status: complaintAssignments.status,
        note: complaintAssignments.note,
        acceptedAt: complaintAssignments.acceptedAt,
        createdAt: complaintAssignments.createdAt,
        byId: users.id,
        byName: users.fullName,
      })
      .from(complaintAssignments)
      .leftJoin(users, eq(users.id, complaintAssignments.assignedBy))
      .where(
        and(
          eq(complaintAssignments.complaintId, id),
          inArray(complaintAssignments.status, ["PENDING", "ACCEPTED"]),
        ),
      )
      .limit(1);

    const [feedback] = await tx
      .select({ rating: complaintFeedback.rating, comment: complaintFeedback.comment })
      .from(complaintFeedback)
      .where(eq(complaintFeedback.complaintId, id))
      .limit(1);

    const actor = actorFor(auth, complaint);
    const canTriage = hasPermission(auth.role, "complaint:triage");
    const visibleToReporterOnly = !staff;

    return {
      ...toSummary(row),
      description: complaint.description,
      latitude: complaint.latitude,
      longitude: complaint.longitude,
      reporter: { id: complaint.reporterId, fullName: row.reporterName },
      isReporter: actor.isReporter,
      isAssignee: actor.isAssignee,
      resolvedAt: complaint.resolvedAt?.toISOString() ?? null,
      closedAt: complaint.closedAt?.toISOString() ?? null,
      reopenedCount: complaint.reopenedCount,
      assignment: assignment
        ? {
            id: assignment.id,
            status: assignment.status,
            // Assignment notes are instructions between staff.
            note: visibleToReporterOnly ? null : assignment.note,
            assignedBy:
              !visibleToReporterOnly && assignment.byId && assignment.byName
                ? { id: assignment.byId, fullName: assignment.byName }
                : null,
            acceptedAt: assignment.acceptedAt?.toISOString() ?? null,
            createdAt: assignment.createdAt.toISOString(),
          }
        : null,
      history: history.map((entry) => ({
        id: entry.id,
        fromStatus: entry.fromStatus,
        toStatus: entry.toStatus,
        note: entry.note,
        changedBy:
          entry.userId && entry.userName ? { id: entry.userId, fullName: entry.userName } : null,
        createdAt: entry.createdAt.toISOString(),
      })),
      attachments: await Promise.all(
        attachments.map(async (attachment) => ({
          id: attachment.id,
          kind: attachment.kind,
          url: await storage.signedUrl(attachment.storageKey),
          // Until a worker has made the thumbnail, the full image stands in for it.
          thumbnailUrl: await storage.signedUrl(attachment.thumbnailKey ?? attachment.storageKey),
          width: attachment.width,
          height: attachment.height,
          createdAt: attachment.createdAt.toISOString(),
        })),
      ),
      comments: comments.map((comment) => ({
        id: comment.id,
        body: comment.body,
        isInternal: comment.isInternal,
        author:
          comment.authorId && comment.authorName
            ? { id: comment.authorId, fullName: comment.authorName }
            : null,
        authorIsStaff: !!comment.authorRole && comment.authorRole !== "CITIZEN",
        createdAt: comment.createdAt.toISOString(),
      })),
      feedback: feedback ?? null,
      actions: {
        transitions: availableTransitions(complaint.status, actor)
          // ASSIGNED is reached through the assign action, which also picks the team.
          .filter((rule) => rule.to !== "ASSIGNED")
          .map((rule) => ({ to: rule.to, requiresNote: !!rule.requiresNote })),
        canAssign:
          canTriage &&
          ["VERIFIED", "REOPENED", "ON_HOLD", "ASSIGNED", "IN_PROGRESS"].includes(complaint.status),
        canAcceptAssignment: actor.isAssignee && assignment?.status === "PENDING",
        canEditTriage: canTriage && isOpenStatus(complaint.status),
        canCommentInternally: hasPermission(auth.role, "complaint:comment:internal"),
        canGiveFeedback:
          actor.isReporter && !feedback && ["RESOLVED", "CLOSED"].includes(complaint.status),
        canUpload:
          isOpenStatus(complaint.status) && (actor.isReporter || actor.isAssignee || canTriage),
      },
    };
  });
}

/* ---------- status changes ---------- */

async function resolutionDeadline(tx: Tx, complaint: ComplaintRow): Promise<Date | null> {
  // Category-specific policy first, then the organization default (category_id IS NULL).
  const [policy] = await tx
    .select({ minutes: slaPolicies.resolutionMinutes })
    .from(slaPolicies)
    .where(
      and(
        eq(slaPolicies.priority, complaint.priority),
        or(eq(slaPolicies.categoryId, complaint.categoryId), isNull(slaPolicies.categoryId)),
      ),
    )
    .orderBy(sql`${slaPolicies.categoryId} is null`)
    .limit(1);
  return policy ? new Date(Date.now() + policy.minutes * 60_000) : null;
}

/**
 * Apply a status transition inside the caller's transaction: validates it, updates the
 * complaint, appends immutable history, emits the event and writes the audit record.
 */
async function applyTransition(
  tx: Tx,
  ctx: Ctx,
  complaint: ComplaintRow,
  to: ComplaintStatus,
  note: string | undefined,
  meta: RequestMeta,
  extra: Partial<ComplaintRow> = {},
  /** Staff-only text passed to notifications but kept out of the reporter-visible history. */
  staffNote?: string,
): Promise<ComplaintRow> {
  const actor = actorFor(ctx.auth, complaint);
  const check = checkTransition(complaint.status, to, actor, note);
  if (!check.ok) {
    if (check.reason === "NOT_PERMITTED") throw errors.forbidden();
    throw new AppError(
      check.reason === "NOTE_REQUIRED" ? "VALIDATION_ERROR" : "INVALID_STATUS_TRANSITION",
      check.reason === "NOTE_REQUIRED"
        ? "A note is required for this change"
        : `A complaint that is ${complaint.status} cannot become ${to}`,
      check.reason === "NOTE_REQUIRED" ? [{ path: "note", message: "Add a note" }] : undefined,
    );
  }

  const now = new Date();
  const changes: Partial<ComplaintRow> = { ...extra, status: to };
  if (to === "VERIFIED") {
    changes.verifiedAt = now;
    changes.slaDueAt = await resolutionDeadline(tx, complaint);
  }
  if (to === "RESOLVED") changes.resolvedAt = now;
  if (to === "CLOSED") changes.closedAt = now;
  if (to === "REOPENED") {
    // A plain reporter may only reopen within the organization's window.
    if (actor.isReporter && !hasPermission(ctx.auth.role, "complaint:triage")) {
      const [organization] = await tx
        .select({ settings: organizations.settings })
        .from(organizations)
        .limit(1);
      const windowDays = organizationSettingsSchema.parse(
        organization?.settings ?? {},
      ).reopenWindowDays;
      const reference = complaint.resolvedAt ?? complaint.updatedAt;
      if (now.getTime() - reference.getTime() > windowDays * 86_400_000) {
        throw errors.forbidden(`Reports can be reopened within ${windowDays} days of resolution`);
      }
    }
    changes.reopenedCount = complaint.reopenedCount + 1;
    changes.resolvedAt = null;
    changes.closedAt = null;
    changes.assignedWorkerId = null;
    changes.slaDueAt = await resolutionDeadline(tx, complaint);
    changes.slaBreachedAt = null;
    changes.slaWarnedAt = null;
  }

  const [updated] = await tx
    .update(complaints)
    .set(changes)
    .where(eq(complaints.id, complaint.id))
    .returning();
  if (!updated) throw errors.notFound("Complaint");

  if (to === "IN_PROGRESS") {
    // Starting work implies accepting the assignment.
    await tx
      .update(complaintAssignments)
      .set({ status: "ACCEPTED", acceptedAt: now })
      .where(
        and(
          eq(complaintAssignments.complaintId, complaint.id),
          eq(complaintAssignments.status, "PENDING"),
        ),
      );
  }
  if (to === "RESOLVED" || to === "REOPENED" || to === "REJECTED") {
    await tx
      .update(complaintAssignments)
      .set({
        status: to === "RESOLVED" ? "COMPLETED" : "SUPERSEDED",
        ...(to === "RESOLVED" ? { completedAt: now } : {}),
      })
      .where(
        and(
          eq(complaintAssignments.complaintId, complaint.id),
          inArray(complaintAssignments.status, ["PENDING", "ACCEPTED"]),
        ),
      );
  }

  await tx.insert(complaintStatusHistory).values({
    organizationId: ctx.organizationId,
    complaintId: complaint.id,
    fromStatus: complaint.status,
    toStatus: to,
    changedBy: ctx.auth.user.id,
    note: note?.trim() || null,
  });
  // Notify with the pre-reopen assignee so the previous worker hears about it.
  await emitComplaintEvent(tx, ctx, STATUS_EVENT[to], updated, meta, {
    note: staffNote?.trim() || note?.trim() || null,
    ...(to === "REOPENED" ? { assignedWorkerId: complaint.assignedWorkerId } : {}),
  });
  await recordAudit(tx, {
    organizationId: ctx.organizationId,
    actorId: ctx.auth.user.id,
    action: "complaint.status_changed",
    entityType: "complaint",
    entityId: complaint.id,
    metadata: { from: complaint.status, to, trackingId: complaint.trackingId },
    ipAddress: meta.ipAddress,
    requestId: meta.requestId,
  });
  return updated;
}

export async function changeStatus(
  db: Db,
  ctx: Ctx,
  id: string,
  input: ChangeStatusInput,
  meta: RequestMeta,
): Promise<void> {
  if (input.status === "ASSIGNED") {
    throw errors.badRequest("Use the assign action to assign a complaint");
  }
  await db.withTenant(ctx, async (tx) => {
    const complaint = await lockVisible(tx, ctx, id);
    await applyTransition(tx, ctx, complaint, input.status, input.note, meta);
  });
}

/* ---------- assignment ---------- */

export async function assignComplaint(
  db: Db,
  ctx: Ctx,
  id: string,
  input: AssignComplaintInput,
  meta: RequestMeta,
): Promise<void> {
  const { auth } = ctx;
  await db.withTenant(ctx, async (tx) => {
    const complaint = await lockVisible(tx, ctx, id);

    if (auth.role === "DEPARTMENT_MANAGER" && input.departmentId !== auth.departmentId) {
      throw errors.forbidden("You can assign only within your own department");
    }
    const [department] = await tx
      .select({ id: departments.id })
      .from(departments)
      .where(
        and(
          eq(departments.id, input.departmentId),
          eq(departments.isActive, true),
          isNull(departments.deletedAt),
        ),
      )
      .limit(1);
    if (!department) throw errors.badRequest("Choose an active department");

    const workerId = input.workerId ?? null;
    if (workerId) {
      const [worker] = await tx
        .select({ id: organizationMembers.id })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.userId, workerId),
            eq(organizationMembers.role, "FIELD_WORKER"),
            eq(organizationMembers.status, "ACTIVE"),
            eq(organizationMembers.departmentId, input.departmentId),
          ),
        )
        .limit(1);
      if (!worker) throw errors.badRequest("That person is not a field worker in this department");
    }

    const routing = { departmentId: input.departmentId, assignedWorkerId: workerId };
    const reassigning = complaint.status === "ASSIGNED" || complaint.status === "IN_PROGRESS";
    if (!reassigning && !["VERIFIED", "REOPENED", "ON_HOLD"].includes(complaint.status)) {
      throw new AppError(
        "INVALID_STATUS_TRANSITION",
        `A complaint that is ${complaint.status} cannot be assigned`,
      );
    }

    await tx
      .update(complaintAssignments)
      .set({ status: "SUPERSEDED" })
      .where(
        and(
          eq(complaintAssignments.complaintId, id),
          inArray(complaintAssignments.status, ["PENDING", "ACCEPTED"]),
        ),
      );
    await tx.insert(complaintAssignments).values({
      organizationId: ctx.organizationId,
      complaintId: id,
      departmentId: input.departmentId,
      workerId,
      assignedBy: auth.user.id,
      note: input.note?.trim() || null,
    });

    if (reassigning) {
      if (!hasPermission(auth.role, "complaint:triage")) throw errors.forbidden();
      const [updated] = await tx
        .update(complaints)
        .set(routing)
        .where(eq(complaints.id, id))
        .returning();
      await emitComplaintEvent(tx, ctx, "complaint.assigned", updated!, meta, {
        note: input.note?.trim() || null,
      });
      await recordAudit(tx, {
        organizationId: ctx.organizationId,
        actorId: auth.user.id,
        action: "complaint.reassigned",
        entityType: "complaint",
        entityId: id,
        metadata: { departmentId: input.departmentId, workerId },
        ipAddress: meta.ipAddress,
        requestId: meta.requestId,
      });
    } else {
      // Instructions live on the assignment row; the status history stays note-free.
      await applyTransition(tx, ctx, complaint, "ASSIGNED", undefined, meta, routing, input.note);
    }
  });
}

export async function acceptAssignment(db: Db, ctx: Ctx, id: string): Promise<void> {
  await db.withTenant(ctx, async (tx) => {
    const complaint = await lockVisible(tx, ctx, id);
    if (complaint.assignedWorkerId !== ctx.auth.user.id) throw errors.forbidden();
    const accepted = await tx
      .update(complaintAssignments)
      .set({ status: "ACCEPTED", acceptedAt: new Date() })
      .where(
        and(eq(complaintAssignments.complaintId, id), eq(complaintAssignments.status, "PENDING")),
      )
      .returning({ id: complaintAssignments.id });
    if (accepted.length === 0) throw errors.conflict("There is no pending assignment to accept");
  });
}

/* ---------- triage edits, comments, feedback ---------- */

export async function updateTriage(
  db: Db,
  ctx: Ctx,
  id: string,
  input: { priority?: ComplaintPriority; categoryId?: string },
  meta: RequestMeta,
): Promise<void> {
  await db.withTenant(ctx, async (tx) => {
    const complaint = await lockVisible(tx, ctx, id);
    if (!isOpenStatus(complaint.status)) throw errors.conflict("This complaint is no longer open");
    if (input.categoryId) {
      const [category] = await tx
        .select({ id: complaintCategories.id })
        .from(complaintCategories)
        .where(eq(complaintCategories.id, input.categoryId))
        .limit(1);
      if (!category) throw errors.badRequest("Choose a valid category");
    }
    const [updated] = await tx
      .update(complaints)
      .set({
        ...(input.priority ? { priority: input.priority } : {}),
        ...(input.categoryId ? { categoryId: input.categoryId } : {}),
      })
      .where(eq(complaints.id, id))
      .returning();
    await emitComplaintEvent(tx, ctx, "complaint.updated", updated!, meta);
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      actorId: ctx.auth.user.id,
      action: "complaint.triage_updated",
      entityType: "complaint",
      entityId: id,
      metadata: input,
      ipAddress: meta.ipAddress,
      requestId: meta.requestId,
    });
  });
}

export async function addComment(
  db: Db,
  ctx: Ctx,
  id: string,
  input: { body: string; isInternal: boolean },
  meta: RequestMeta,
): Promise<void> {
  const internal = input.isInternal;
  if (internal && !hasPermission(ctx.auth.role, "complaint:comment:internal")) {
    throw errors.forbidden("Only staff can add internal notes");
  }
  await db.withTenant(ctx, async (tx) => {
    const complaint = await lockVisible(tx, ctx, id);
    await tx.insert(complaintComments).values({
      organizationId: ctx.organizationId,
      complaintId: id,
      authorId: ctx.auth.user.id,
      body: input.body,
      isInternal: internal,
    });
    if (!internal) {
      await emitComplaintEvent(tx, ctx, "complaint.commented", complaint, meta, {
        byStaff: complaint.reporterId !== ctx.auth.user.id,
      });
    }
  });
}

export async function submitFeedback(
  db: Db,
  ctx: Ctx,
  id: string,
  input: { rating: number; comment?: string },
): Promise<void> {
  try {
    await db.withTenant(ctx, async (tx) => {
      const complaint = await lockVisible(tx, ctx, id);
      if (complaint.reporterId !== ctx.auth.user.id) throw errors.forbidden();
      if (!["RESOLVED", "CLOSED"].includes(complaint.status)) {
        throw errors.conflict("Feedback opens once the complaint is resolved");
      }
      await tx.insert(complaintFeedback).values({
        organizationId: ctx.organizationId,
        complaintId: id,
        userId: ctx.auth.user.id,
        rating: input.rating,
        comment: input.comment?.trim() || null,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error, "complaint_feedback_complaint_uq")) {
      throw errors.conflict("Feedback was already submitted for this complaint");
    }
    throw error;
  }
}

/* ---------- attachments ---------- */

export interface ProcessedImage {
  full: Buffer;
  /** Absent when a worker will create the thumbnail after the upload. */
  thumbnail: Buffer | null;
  width: number;
  height: number;
  checksum: string;
}

export async function addAttachment(
  db: Db,
  storage: ObjectStorage,
  queues: JobQueues | null,
  ctx: Ctx,
  id: string,
  image: ProcessedImage,
  meta: RequestMeta,
): Promise<{ id: string }> {
  const fileId = randomUUID();
  const base = `org/${ctx.organizationId}/complaints/${id}/${fileId}`;
  const storageKey = `${base}.webp`;
  const thumbnailKey = image.thumbnail ? `${base}.thumb.webp` : null;

  // Authorize and decide the kind before any bytes are stored.
  const kind = await db.withTenant(ctx, async (tx) => {
    const complaint = await lockVisible(tx, ctx, id);
    const actor = actorFor(ctx.auth, complaint);
    const triage = hasPermission(ctx.auth.role, "complaint:triage");
    if (!isOpenStatus(complaint.status) || !(actor.isReporter || actor.isAssignee || triage)) {
      throw errors.forbidden("Photos cannot be added to this complaint");
    }
    const [existing] = await tx
      .select({ value: count() })
      .from(complaintAttachments)
      .where(and(eq(complaintAttachments.complaintId, id), isNull(complaintAttachments.deletedAt)));
    if ((existing?.value ?? 0) >= 10)
      throw errors.conflict("A complaint can have at most 10 photos");
    // Staff photos taken while the work is under way count as resolution evidence.
    if (actor.isReporter && !actor.isAssignee) return "REPORT" as const;
    return complaint.status === "IN_PROGRESS" ? ("RESOLUTION" as const) : ("EVIDENCE" as const);
  });

  await storage.put(storageKey, image.full, "image/webp");
  if (image.thumbnail && thumbnailKey)
    await storage.put(thumbnailKey, image.thumbnail, "image/webp");
  try {
    const created = await db.withTenant(ctx, async (tx) => {
      const complaint = await lockVisible(tx, ctx, id);
      const [row] = await tx
        .insert(complaintAttachments)
        .values({
          organizationId: ctx.organizationId,
          complaintId: id,
          uploadedBy: ctx.auth.user.id,
          kind,
          storageKey,
          thumbnailKey,
          mimeType: "image/webp",
          sizeBytes: image.full.length,
          width: image.width,
          height: image.height,
          checksumSha256: image.checksum,
          processingStatus: image.thumbnail ? "READY" : "PENDING",
        })
        .returning({ id: complaintAttachments.id });
      await emitComplaintEvent(tx, ctx, "complaint.attachment_added", complaint, meta);
      return { id: row!.id };
    });
    if (!image.thumbnail) {
      // The photo is already usable (the UI falls back to it). If the queue is unreachable,
      // the scheduled sweep picks the attachment up later.
      await queues?.enqueueMedia({
        kind: "thumbnail",
        organizationId: ctx.organizationId,
        complaintId: id,
        attachmentId: created.id,
      });
    }
    return created;
  } catch (error) {
    // Do not leave orphaned objects behind when the database write fails.
    await Promise.allSettled([
      storage.delete(storageKey),
      ...(thumbnailKey ? [storage.delete(thumbnailKey)] : []),
    ]);
    throw error;
  }
}

/* ---------- queries used by other modules ---------- */

export { visibility as complaintVisibility, overdueSql };
