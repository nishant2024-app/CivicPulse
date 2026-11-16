import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { OrganizationSettings } from "@civicpulse/shared";
import { createdAt, deletedAt, id, updatedAt } from "./columns";
import {
  complaintPriorityEnum,
  memberRoleEnum,
  memberStatusEnum,
  organizationTypeEnum,
} from "./enums";
import { users } from "./identity";

export const organizations = pgTable(
  "organizations",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    type: organizationTypeEnum("type").notNull(),
    description: text("description"),
    contactEmail: text("contact_email"),
    logoStorageKey: text("logo_storage_key"),
    settings: jsonb("settings").$type<OrganizationSettings>().notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [uniqueIndex("organizations_slug_uq").on(t.slug)],
);

export const departments = pgTable(
  "departments",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description"),
    managerUserId: uuid("manager_user_id").references(() => users.id, { onDelete: "set null" }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("departments_org_name_uq")
      .on(t.organizationId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const organizationMembers = pgTable(
  "organization_members",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    role: memberRoleEnum("role").notNull(),
    departmentId: uuid("department_id").references(() => departments.id, {
      onDelete: "set null",
    }),
    status: memberStatusEnum("status").notNull().default("ACTIVE"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("organization_members_org_user_uq").on(t.organizationId, t.userId),
    index("organization_members_user_idx").on(t.userId),
    index("organization_members_org_role_idx").on(t.organizationId, t.role),
    index("organization_members_department_idx").on(t.departmentId),
  ],
);

export const workerProfiles = pgTable(
  "worker_profiles",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => organizationMembers.id, { onDelete: "cascade" }),
    employeeCode: text("employee_code"),
    skills: text("skills").array().notNull().default(sql`'{}'::text[]`),
    isAvailable: boolean("is_available").notNull().default(true),
    maxActiveAssignments: integer("max_active_assignments").notNull().default(10),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("worker_profiles_member_uq").on(t.memberId),
    check("worker_profiles_max_active_ck", sql`${t.maxActiveAssignments} between 1 and 100`),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    email: text("email").notNull(),
    role: memberRoleEnum("role").notNull(),
    departmentId: uuid("department_id").references(() => departments.id, {
      onDelete: "set null",
    }),
    tokenHash: text("token_hash").notNull(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("invitations_token_hash_uq").on(t.tokenHash),
    uniqueIndex("invitations_pending_uq")
      .on(t.organizationId, sql`lower(${t.email})`)
      .where(sql`${t.acceptedAt} is null and ${t.revokedAt} is null`),
  ],
);

export const complaintCategories = pgTable(
  "complaint_categories",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    defaultDepartmentId: uuid("default_department_id").references(() => departments.id, {
      onDelete: "set null",
    }),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("complaint_categories_org_slug_uq").on(t.organizationId, t.slug)],
);

export const slaPolicies = pgTable(
  "sla_policies",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    /** NULL = organization-wide default for the priority. */
    categoryId: uuid("category_id").references(() => complaintCategories.id, {
      onDelete: "cascade",
    }),
    priority: complaintPriorityEnum("priority").notNull(),
    resolutionMinutes: integer("resolution_minutes").notNull(),
    /** Emit an "approaching deadline" event when this much time remains. */
    warningMinutes: integer("warning_minutes").notNull().default(120),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("sla_policies_org_category_priority_uq")
      .on(t.organizationId, t.categoryId, t.priority)
      .nullsNotDistinct(),
    check("sla_policies_resolution_ck", sql`${t.resolutionMinutes} > 0`),
    check("sla_policies_warning_ck", sql`${t.warningMinutes} >= 0`),
  ],
);
