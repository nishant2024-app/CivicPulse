import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./columns";
import { emailStatusEnum } from "./enums";
import { complaints } from "./complaints";
import { users } from "./identity";
import { organizations } from "./organizations";

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    complaintId: uuid("complaint_id").references(() => complaints.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    /** `<eventId>` — makes notification creation idempotent per recipient. */
    dedupeKey: text("dedupe_key").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    emailStatus: emailStatusEnum("email_status").notNull().default("NOT_REQUESTED"),
    emailAttempts: integer("email_attempts").notNull().default(0),
    emailError: text("email_error"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("notifications_user_dedupe_uq").on(t.userId, t.dedupeKey),
    index("notifications_user_created_idx").on(t.userId, t.createdAt.desc()),
    index("notifications_user_unread_idx")
      .on(t.userId, t.createdAt.desc())
      .where(sql`${t.readAt} is null`),
  ],
);

export const notificationPreferences = pgTable("notification_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  inAppEnabled: boolean("in_app_enabled").notNull().default(true),
  emailEnabled: boolean("email_enabled").notNull().default(true),
  mutedEventTypes: text("muted_event_types").array().notNull().default(sql`'{}'::text[]`),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    /** NULL for platform-level actions (e.g. a failed login for an unknown account). */
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "restrict",
    }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ipAddress: text("ip_address"),
    requestId: text("request_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_logs_org_created_idx").on(t.organizationId, t.createdAt.desc()),
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
    index("audit_logs_actor_idx").on(t.actorId, t.createdAt.desc()),
  ],
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: id(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "restrict",
    }),
    topic: text("topic").notNull(),
    eventType: text("event_type").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    /** correlation ID and W3C trace context captured at write time. */
    headers: jsonb("headers").$type<Record<string, string>>().notNull().default({}),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("outbox_events_pending_idx")
      .on(t.nextAttemptAt, t.createdAt)
      .where(sql`${t.publishedAt} is null`),
    index("outbox_events_published_idx").on(t.publishedAt),
  ],
);

export const processedEvents = pgTable(
  "processed_events",
  {
    consumerGroup: text("consumer_group").notNull(),
    eventId: uuid("event_id").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.consumerGroup, t.eventId] }),
    index("processed_events_processed_at_idx").on(t.processedAt),
  ],
);

export const deadLetterEvents = pgTable(
  "dead_letter_events",
  {
    id: id(),
    consumerGroup: text("consumer_group").notNull(),
    eventId: uuid("event_id"),
    topic: text("topic").notNull(),
    eventType: text("event_type"),
    payload: jsonb("payload").$type<unknown>().notNull(),
    headers: jsonb("headers").$type<Record<string, string>>().notNull().default({}),
    error: text("error").notNull(),
    attempts: integer("attempts").notNull().default(0),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("dead_letter_events_group_created_idx").on(t.consumerGroup, t.createdAt.desc())],
);
