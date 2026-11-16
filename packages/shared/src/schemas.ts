import { z } from "zod";
import { MEMBER_ROLES, ORGANIZATION_TYPES, ROLES } from "./enums";
import { PERMISSIONS } from "./permissions";

/* ---------- primitives ---------- */

export const uuidSchema = z.uuid();

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address").max(254));

export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(128, "Password must be at most 128 characters");

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens");

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const paginationSchema = z.object({
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
});
export type Pagination = z.infer<typeof paginationSchema>;

export function paginated<T extends z.ZodType>(item: T) {
  return z.object({ data: z.array(item), pagination: paginationSchema });
}

/* ---------- auth ---------- */

export const registerSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your name").max(120),
  email: emailSchema,
  password: passwordSchema,
  /** Join this organization as a citizen. It must allow public registration. */
  organizationSlug: slugSchema.optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password").max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const switchOrganizationSchema = z.object({ organizationId: uuidSchema });

export const membershipSchema = z.object({
  organizationId: uuidSchema,
  organizationName: z.string(),
  organizationSlug: z.string(),
  role: z.enum(MEMBER_ROLES),
  departmentId: uuidSchema.nullable(),
});
export type Membership = z.infer<typeof membershipSchema>;

export const userSchema = z.object({
  id: uuidSchema,
  email: z.string(),
  fullName: z.string(),
  phone: z.string().nullable(),
  isSuperAdmin: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type User = z.infer<typeof userSchema>;

export const meSchema = z.object({
  user: userSchema,
  memberships: z.array(membershipSchema),
  activeOrganizationId: uuidSchema.nullable(),
  role: z.enum(ROLES).nullable(),
  permissions: z.array(z.enum(PERMISSIONS)),
});
export type Me = z.infer<typeof meSchema>;

export const sessionInfoSchema = z.object({
  id: uuidSchema,
  current: z.boolean(),
  userAgent: z.string().nullable(),
  ipAddress: z.string().nullable(),
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export type SessionInfo = z.infer<typeof sessionInfoSchema>;

export const updateProfileSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid phone number")
    .nullable()
    .optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const deleteAccountSchema = z.object({ password: z.string().min(1).max(128) });

/* ---------- organizations ---------- */

export const organizationSettingsSchema = z.object({
  allowPublicRegistration: z.boolean().default(true),
  publicTrackingEnabled: z.boolean().default(true),
  citizenCanSetPriority: z.boolean().default(false),
  /** Days after resolution during which the reporter may reopen. */
  reopenWindowDays: z.number().int().min(0).max(90).default(14),
});
export type OrganizationSettings = z.infer<typeof organizationSettingsSchema>;

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(3).max(120),
  slug: slugSchema,
  type: z.enum(ORGANIZATION_TYPES),
  description: z.string().trim().max(1000).optional(),
  contactEmail: emailSchema.optional(),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const organizationSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  slug: z.string(),
  type: z.enum(ORGANIZATION_TYPES),
  description: z.string().nullable(),
  contactEmail: z.string().nullable(),
  settings: organizationSettingsSchema,
  createdAt: z.iso.datetime(),
});
export type Organization = z.infer<typeof organizationSchema>;

export const publicOrganizationSchema = organizationSchema.pick({
  id: true,
  name: true,
  slug: true,
  type: true,
});
export type PublicOrganization = z.infer<typeof publicOrganizationSchema>;
