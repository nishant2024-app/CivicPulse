import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, deletedAt, id, tsvector, updatedAt } from "./columns";
import {
  assignmentStatusEnum,
  attachmentKindEnum,
  complaintPriorityEnum,
  complaintStatusEnum,
  processingStatusEnum,
} from "./enums";
import { users } from "./identity";
import { complaintCategories, departments, organizations } from "./organizations";

const OPEN = sql`('REPORTED','VERIFIED','ASSIGNED','IN_PROGRESS','ON_HOLD','REOPENED')`;

export const complaints = pgTable(
  "complaints",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    trackingId: text("tracking_id").notNull(),
    reporterId: uuid("reporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => complaintCategories.id, { onDelete: "restrict" }),
    departmentId: uuid("department_id").references(() => departments.id, {
      onDelete: "set null",
    }),
    assignedWorkerId: uuid("assigned_worker_id").references(() => users.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    description: text("description").notNull(),
    priority: complaintPriorityEnum("priority").notNull().default("MEDIUM"),
    status: complaintStatusEnum("status").notNull().default("REPORTED"),
    locationText: text("location_text").notNull(),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    slaDueAt: timestamp("sla_due_at", { withTimezone: true }),
    slaWarnedAt: timestamp("sla_warned_at", { withTimezone: true }),
    slaBreachedAt: timestamp("sla_breached_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    reopenedCount: integer("reopened_count").notNull().default(0),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(tracking_id, '')), 'A') || setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(description, '')), 'B') || setweight(to_tsvector('english', coalesce(location_text, '')), 'C')`,
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("complaints_tracking_id_uq").on(t.trackingId),
    index("complaints_org_status_created_idx").on(t.organizationId, t.status, t.createdAt.desc()),
    index("complaints_org_reporter_idx").on(t.organizationId, t.reporterId, t.createdAt.desc()),
    index("complaints_org_department_status_idx").on(t.organizationId, t.departmentId, t.status),
    index("complaints_org_worker_status_idx").on(t.organizationId, t.assignedWorkerId, t.status),
    index("complaints_org_category_idx").on(t.organizationId, t.categoryId),
    index("complaints_org_sla_open_idx")
      .on(t.organizationId, t.slaDueAt)
      .where(sql`${t.status} in ${OPEN} and ${t.slaDueAt} is not null`),
    index("complaints_search_idx").using("gin", t.searchVector),
    check("complaints_latitude_ck", sql`${t.latitude} is null or ${t.latitude} between -90 and 90`),
    check(
      "complaints_longitude_ck",
      sql`${t.longitude} is null or ${t.longitude} between -180 and 180`,
    ),
    check(
      "complaints_coordinates_pair_ck",
      sql`(${t.latitude} is null) = (${t.longitude} is null)`,
    ),
  ],
);

export const complaintStatusHistory = pgTable(
  "complaint_status_history",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    complaintId: uuid("complaint_id")
      .notNull()
      .references(() => complaints.id, { onDelete: "restrict" }),
    fromStatus: complaintStatusEnum("from_status"),
    toStatus: complaintStatusEnum("to_status").notNull(),
    changedBy: uuid("changed_by").references(() => users.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("complaint_status_history_complaint_idx").on(t.complaintId, t.createdAt)],
);

export const complaintAssignments = pgTable(
  "complaint_assignments",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    complaintId: uuid("complaint_id")
      .notNull()
      .references(() => complaints.id, { onDelete: "restrict" }),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "restrict" }),
    workerId: uuid("worker_id").references(() => users.id, { onDelete: "set null" }),
    assignedBy: uuid("assigned_by").references(() => users.id, { onDelete: "set null" }),
    note: text("note"),
    status: assignmentStatusEnum("status").notNull().default("PENDING"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("complaint_assignments_complaint_idx").on(t.complaintId, t.createdAt),
    index("complaint_assignments_worker_idx").on(t.organizationId, t.workerId, t.status),
    uniqueIndex("complaint_assignments_one_active_uq")
      .on(t.complaintId)
      .where(sql`${t.status} in ('PENDING','ACCEPTED')`),
  ],
);

export const complaintAttachments = pgTable(
  "complaint_attachments",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    complaintId: uuid("complaint_id")
      .notNull()
      .references(() => complaints.id, { onDelete: "restrict" }),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    kind: attachmentKindEnum("kind").notNull().default("REPORT"),
    storageKey: text("storage_key").notNull(),
    thumbnailKey: text("thumbnail_key"),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    checksumSha256: text("checksum_sha256").notNull(),
    processingStatus: processingStatusEnum("processing_status").notNull().default("PENDING"),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index("complaint_attachments_complaint_idx").on(t.complaintId),
    uniqueIndex("complaint_attachments_storage_key_uq").on(t.storageKey),
    check("complaint_attachments_size_ck", sql`${t.sizeBytes} > 0`),
  ],
);

export const complaintComments = pgTable(
  "complaint_comments",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    complaintId: uuid("complaint_id")
      .notNull()
      .references(() => complaints.id, { onDelete: "restrict" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    /** Internal notes are visible to staff only. */
    isInternal: boolean("is_internal").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("complaint_comments_complaint_idx").on(t.complaintId, t.createdAt)],
);

export const complaintFeedback = pgTable(
  "complaint_feedback",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    complaintId: uuid("complaint_id")
      .notNull()
      .references(() => complaints.id, { onDelete: "restrict" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    rating: smallint("rating").notNull(),
    comment: text("comment"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("complaint_feedback_complaint_uq").on(t.complaintId),
    check("complaint_feedback_rating_ck", sql`${t.rating} between 1 and 5`),
  ],
);
