import { pgEnum } from "drizzle-orm/pg-core";
import {
  ASSIGNMENT_STATUSES,
  ATTACHMENT_KINDS,
  COMPLAINT_PRIORITIES,
  COMPLAINT_STATUSES,
  MEMBER_ROLES,
  MEMBER_STATUSES,
  ORGANIZATION_TYPES,
  USER_STATUSES,
} from "@civicpulse/shared";

export const userStatusEnum = pgEnum("user_status", USER_STATUSES);
export const organizationTypeEnum = pgEnum("organization_type", ORGANIZATION_TYPES);
export const memberRoleEnum = pgEnum("member_role", MEMBER_ROLES);
export const memberStatusEnum = pgEnum("member_status", MEMBER_STATUSES);
export const complaintStatusEnum = pgEnum("complaint_status", COMPLAINT_STATUSES);
export const complaintPriorityEnum = pgEnum("complaint_priority", COMPLAINT_PRIORITIES);
export const assignmentStatusEnum = pgEnum("assignment_status", ASSIGNMENT_STATUSES);
export const attachmentKindEnum = pgEnum("attachment_kind", ATTACHMENT_KINDS);
export const processingStatusEnum = pgEnum("processing_status", ["PENDING", "READY", "FAILED"]);
export const emailStatusEnum = pgEnum("email_status", [
  "NOT_REQUESTED",
  "QUEUED",
  "SENT",
  "FAILED",
]);
