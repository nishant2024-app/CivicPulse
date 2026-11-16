/** Enumerations shared by database, API and UI. Database enum types mirror these arrays. */

export const MEMBER_ROLES = [
  "ORGANIZATION_ADMIN",
  "DEPARTMENT_MANAGER",
  "FIELD_WORKER",
  "CITIZEN",
] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

/** Effective role of a request: a membership role, or the platform-level super admin. */
export const ROLES = ["SUPER_ADMIN", ...MEMBER_ROLES] as const;
export type Role = (typeof ROLES)[number];

export const STAFF_ROLES: readonly Role[] = [
  "SUPER_ADMIN",
  "ORGANIZATION_ADMIN",
  "DEPARTMENT_MANAGER",
  "FIELD_WORKER",
];

export const ORGANIZATION_TYPES = [
  "COLLEGE",
  "RESIDENTIAL_SOCIETY",
  "COMMUNITY",
  "MUNICIPALITY",
  "PRIVATE_INSTITUTION",
] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export const COMPLAINT_STATUSES = [
  "REPORTED",
  "VERIFIED",
  "REJECTED",
  "ASSIGNED",
  "IN_PROGRESS",
  "ON_HOLD",
  "RESOLVED",
  "CLOSED",
  "REOPENED",
] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

export const COMPLAINT_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type ComplaintPriority = (typeof COMPLAINT_PRIORITIES)[number];

export const USER_STATUSES = ["ACTIVE", "DISABLED", "DELETED"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const MEMBER_STATUSES = ["ACTIVE", "SUSPENDED", "REMOVED"] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const ASSIGNMENT_STATUSES = [
  "PENDING",
  "ACCEPTED",
  "COMPLETED",
  "SUPERSEDED",
] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const ATTACHMENT_KINDS = ["REPORT", "EVIDENCE", "RESOLUTION"] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

/** Categories seeded for every new organization. Organizations can add their own. */
export const DEFAULT_CATEGORIES = [
  { slug: "roads", name: "Roads" },
  { slug: "garbage", name: "Garbage" },
  { slug: "water-supply", name: "Water Supply" },
  { slug: "drainage", name: "Drainage" },
  { slug: "electricity", name: "Electricity" },
  { slug: "streetlights", name: "Streetlights" },
  { slug: "public-property", name: "Public Property" },
  { slug: "college-infrastructure", name: "College Infrastructure" },
  { slug: "other", name: "Other" },
] as const;
