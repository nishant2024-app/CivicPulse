import { z } from "zod";
import {
  ASSIGNMENT_STATUSES,
  ATTACHMENT_KINDS,
  COMPLAINT_PRIORITIES,
  COMPLAINT_STATUSES,
  MEMBER_ROLES,
  MEMBER_STATUSES,
} from "./enums";
import { paginationQuerySchema, uuidSchema } from "./schemas";

const iso = z.iso.datetime();
const personSchema = z.object({ id: uuidSchema, fullName: z.string() });
const namedSchema = z.object({ id: uuidSchema, name: z.string() });

/* ---------- departments, categories, members ---------- */

export const departmentInputSchema = z.object({
  name: z.string().trim().min(2, "Enter a name").max(80),
  description: z.string().trim().max(500).nullable().optional(),
  managerUserId: uuidSchema.nullable().optional(),
});
export type DepartmentInput = z.infer<typeof departmentInputSchema>;

export const departmentSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  description: z.string().nullable(),
  manager: personSchema.nullable(),
  isActive: z.boolean(),
  workerCount: z.number().int(),
  openComplaints: z.number().int(),
  createdAt: iso,
});
export type Department = z.infer<typeof departmentSchema>;

export const categorySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  slug: z.string(),
  defaultDepartmentId: uuidSchema.nullable(),
  isActive: z.boolean(),
});
export type Category = z.infer<typeof categorySchema>;

export const updateCategorySchema = z.object({
  defaultDepartmentId: uuidSchema.nullable().optional(),
  isActive: z.boolean().optional(),
});

export const memberSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  fullName: z.string(),
  email: z.string(),
  role: z.enum(MEMBER_ROLES),
  departmentId: uuidSchema.nullable(),
  status: z.enum(MEMBER_STATUSES),
  joinedAt: iso,
});
export type Member = z.infer<typeof memberSchema>;

export const updateMemberSchema = z.object({
  role: z.enum(MEMBER_ROLES).optional(),
  departmentId: uuidSchema.nullable().optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
});
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

/* ---------- complaints ---------- */

export const createComplaintSchema = z
  .object({
    categoryId: uuidSchema,
    title: z.string().trim().min(5, "Give the problem a short title").max(140),
    description: z.string().trim().min(10, "Describe what is wrong").max(4000),
    locationText: z.string().trim().min(3, "Say where it is").max(240),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    priority: z.enum(COMPLAINT_PRIORITIES).optional(),
  })
  .refine((v) => (v.latitude === undefined) === (v.longitude === undefined), {
    path: ["latitude"],
    message: "Provide both latitude and longitude",
  });
export type CreateComplaintInput = z.infer<typeof createComplaintSchema>;

export const updateComplaintSchema = z.object({
  priority: z.enum(COMPLAINT_PRIORITIES).optional(),
  categoryId: uuidSchema.optional(),
});

export const complaintListQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(120).optional(),
  status: z.enum(COMPLAINT_STATUSES).optional(),
  /** "open" = every status in which work is still expected. */
  state: z.enum(["open", "overdue", "unassigned"]).optional(),
  priority: z.enum(COMPLAINT_PRIORITIES).optional(),
  categoryId: uuidSchema.optional(),
  departmentId: uuidSchema.optional(),
  mine: z.enum(["true", "false"]).optional(),
  sort: z.enum(["createdAt", "updatedAt", "priority", "slaDueAt"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});
export type ComplaintListQuery = z.infer<typeof complaintListQuerySchema>;

export const complaintSummarySchema = z.object({
  id: uuidSchema,
  trackingId: z.string(),
  title: z.string(),
  status: z.enum(COMPLAINT_STATUSES),
  priority: z.enum(COMPLAINT_PRIORITIES),
  category: namedSchema,
  department: namedSchema.nullable(),
  assignedWorker: personSchema.nullable(),
  locationText: z.string(),
  slaDueAt: iso.nullable(),
  isOverdue: z.boolean(),
  createdAt: iso,
  updatedAt: iso,
});
export type ComplaintSummary = z.infer<typeof complaintSummarySchema>;

export const statusHistoryEntrySchema = z.object({
  id: uuidSchema,
  fromStatus: z.enum(COMPLAINT_STATUSES).nullable(),
  toStatus: z.enum(COMPLAINT_STATUSES),
  note: z.string().nullable(),
  /** Null on the public tracking page and for system changes. */
  changedBy: personSchema.nullable(),
  createdAt: iso,
});
export type StatusHistoryEntry = z.infer<typeof statusHistoryEntrySchema>;

export const attachmentSchema = z.object({
  id: uuidSchema,
  kind: z.enum(ATTACHMENT_KINDS),
  url: z.string(),
  thumbnailUrl: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  createdAt: iso,
});
export type Attachment = z.infer<typeof attachmentSchema>;

export const commentSchema = z.object({
  id: uuidSchema,
  body: z.string(),
  isInternal: z.boolean(),
  author: personSchema.nullable(),
  authorIsStaff: z.boolean(),
  createdAt: iso,
});
export type Comment = z.infer<typeof commentSchema>;

export const createCommentSchema = z.object({
  body: z.string().trim().min(1, "Write something").max(2000),
  isInternal: z.boolean().default(false),
});

export const complaintDetailSchema = complaintSummarySchema.extend({
  description: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  reporter: personSchema,
  isReporter: z.boolean(),
  isAssignee: z.boolean(),
  resolvedAt: iso.nullable(),
  closedAt: iso.nullable(),
  reopenedCount: z.number().int(),
  assignment: z
    .object({
      id: uuidSchema,
      status: z.enum(ASSIGNMENT_STATUSES),
      note: z.string().nullable(),
      assignedBy: personSchema.nullable(),
      acceptedAt: iso.nullable(),
      createdAt: iso,
    })
    .nullable(),
  history: z.array(statusHistoryEntrySchema),
  attachments: z.array(attachmentSchema),
  comments: z.array(commentSchema),
  feedback: z.object({ rating: z.number().int(), comment: z.string().nullable() }).nullable(),
  /** What this caller may do next; the UI renders exactly these. */
  actions: z.object({
    transitions: z.array(z.object({ to: z.enum(COMPLAINT_STATUSES), requiresNote: z.boolean() })),
    canAssign: z.boolean(),
    canAcceptAssignment: z.boolean(),
    canEditTriage: z.boolean(),
    canCommentInternally: z.boolean(),
    canGiveFeedback: z.boolean(),
    canUpload: z.boolean(),
  }),
});
export type ComplaintDetail = z.infer<typeof complaintDetailSchema>;

export const changeStatusSchema = z.object({
  status: z.enum(COMPLAINT_STATUSES),
  note: z.string().trim().max(1000).optional(),
});
export type ChangeStatusInput = z.infer<typeof changeStatusSchema>;

export const assignComplaintSchema = z.object({
  departmentId: uuidSchema,
  workerId: uuidSchema.nullable().optional(),
  note: z.string().trim().max(1000).optional(),
});
export type AssignComplaintInput = z.infer<typeof assignComplaintSchema>;

export const feedbackSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
});

/* ---------- public tracking ---------- */

/** Everything the public may see. Adding a field here is a privacy decision. */
export const publicTrackingSchema = z.object({
  trackingId: z.string(),
  title: z.string(),
  status: z.enum(COMPLAINT_STATUSES),
  category: z.string(),
  organization: z.string(),
  department: z.string().nullable(),
  locationText: z.string(),
  reportedAt: iso,
  updatedAt: iso,
  slaDueAt: iso.nullable(),
  timeline: z.array(
    z.object({ status: z.enum(COMPLAINT_STATUSES), note: z.string().nullable(), at: iso }),
  ),
  resolutionPhotos: z.array(z.object({ url: z.string(), thumbnailUrl: z.string() })),
});
export type PublicTracking = z.infer<typeof publicTrackingSchema>;

/* ---------- notifications ---------- */

export const notificationSchema = z.object({
  id: uuidSchema,
  type: z.string(),
  title: z.string(),
  body: z.string(),
  complaintId: uuidSchema.nullable(),
  readAt: iso.nullable(),
  createdAt: iso,
});
export type Notification = z.infer<typeof notificationSchema>;

/* ---------- analytics ---------- */

export const analyticsOverviewSchema = z.object({
  total: z.number().int(),
  open: z.number().int(),
  resolved: z.number().int(),
  rejected: z.number().int(),
  overdue: z.number().int(),
  unassigned: z.number().int(),
  /** Null until at least one complaint has been resolved. */
  averageResolutionHours: z.number().nullable(),
  resolutionRate: z.number().nullable(),
  averageRating: z.number().nullable(),
  ratingCount: z.number().int(),
  byStatus: z.array(z.object({ status: z.enum(COMPLAINT_STATUSES), count: z.number().int() })),
});
export type AnalyticsOverview = z.infer<typeof analyticsOverviewSchema>;

export const departmentPerformanceSchema = z.object({
  departmentId: uuidSchema,
  name: z.string(),
  total: z.number().int(),
  open: z.number().int(),
  resolved: z.number().int(),
  overdue: z.number().int(),
  averageResolutionHours: z.number().nullable(),
});
export type DepartmentPerformance = z.infer<typeof departmentPerformanceSchema>;

export const categoryCountSchema = z.object({
  categoryId: uuidSchema,
  name: z.string(),
  total: z.number().int(),
  open: z.number().int(),
});
export type CategoryCount = z.infer<typeof categoryCountSchema>;

export const trendPointSchema = z.object({
  month: z.string(), // YYYY-MM
  reported: z.number().int(),
  resolved: z.number().int(),
});
export type TrendPoint = z.infer<typeof trendPointSchema>;

export const hotspotSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  count: z.number().int(),
});
export type Hotspot = z.infer<typeof hotspotSchema>;

/* ---------- audit ---------- */

export const auditLogSchema = z.object({
  id: uuidSchema,
  action: z.string(),
  entityType: z.string(),
  entityId: uuidSchema.nullable(),
  actor: personSchema.nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: iso,
});
export type AuditLog = z.infer<typeof auditLogSchema>;

/* ---------- domain events ---------- */

export const EVENT_TOPICS = {
  complaints: "civicpulse.complaints",
  platform: "civicpulse.platform",
} as const;

export const COMPLAINT_EVENT_TYPES = [
  "complaint.created",
  "complaint.updated",
  "complaint.verified",
  "complaint.rejected",
  "complaint.assigned",
  "complaint.work_started",
  "complaint.on_hold",
  "complaint.resolved",
  "complaint.closed",
  "complaint.reopened",
  "complaint.commented",
  "complaint.attachment_added",
] as const;
export type ComplaintEventType = (typeof COMPLAINT_EVENT_TYPES)[number];

export const complaintEventPayloadSchema = z.object({
  complaintId: uuidSchema,
  trackingId: z.string(),
  title: z.string(),
  status: z.enum(COMPLAINT_STATUSES),
  reporterId: uuidSchema,
  departmentId: uuidSchema.nullable(),
  assignedWorkerId: uuidSchema.nullable(),
  note: z.string().nullable().optional(),
  /** For complaint.commented: whether the author is staff. */
  byStaff: z.boolean().optional(),
});
export type ComplaintEventPayload = z.infer<typeof complaintEventPayloadSchema>;

export const eventEnvelopeSchema = z.object({
  id: uuidSchema,
  type: z.string(),
  occurredAt: iso,
  organizationId: uuidSchema.nullable(),
  aggregateType: z.string(),
  aggregateId: uuidSchema,
  actorId: uuidSchema.nullable(),
  correlationId: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
});
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

/** Status reached → event emitted. */
export const STATUS_EVENT: Record<(typeof COMPLAINT_STATUSES)[number], ComplaintEventType> = {
  REPORTED: "complaint.created",
  VERIFIED: "complaint.verified",
  REJECTED: "complaint.rejected",
  ASSIGNED: "complaint.assigned",
  IN_PROGRESS: "complaint.work_started",
  ON_HOLD: "complaint.on_hold",
  RESOLVED: "complaint.resolved",
  CLOSED: "complaint.closed",
  REOPENED: "complaint.reopened",
};
