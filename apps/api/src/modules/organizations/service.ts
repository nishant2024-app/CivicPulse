import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import {
  complaintCategories,
  organizationMembers,
  organizations,
  sessions,
  slaPolicies,
  users,
  type Db,
  type TenantContext,
  type Tx,
} from "@civicpulse/db";
import {
  DEFAULT_CATEGORIES,
  organizationSettingsSchema,
  type ComplaintPriority,
  type CreateOrganizationInput,
  type Organization,
  type OrganizationSettings,
  type PublicOrganization,
} from "@civicpulse/shared";
import { errors, isUniqueViolation } from "../../errors";
import { recordAudit } from "../audit/service";
import type { RequestMeta } from "../auth/service";
import type { AuthContext } from "../auth/sessions";

/** Organization-wide resolution targets applied when an organization is created. */
const DEFAULT_SLA_MINUTES: Record<ComplaintPriority, { resolution: number; warning: number }> = {
  CRITICAL: { resolution: 24 * 60, warning: 4 * 60 },
  HIGH: { resolution: 3 * 24 * 60, warning: 12 * 60 },
  MEDIUM: { resolution: 7 * 24 * 60, warning: 24 * 60 },
  LOW: { resolution: 14 * 24 * 60, warning: 48 * 60 },
};

type OrganizationRow = typeof organizations.$inferSelect;

export function toOrganization(row: OrganizationRow): Organization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    type: row.type,
    description: row.description,
    contactEmail: row.contactEmail,
    // Parse so that settings added in later versions get their defaults.
    settings: organizationSettingsSchema.parse(row.settings),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listPublicOrganizations(db: Db): Promise<PublicOrganization[]> {
  return db.withSystem((tx) =>
    tx
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        type: organizations.type,
      })
      .from(organizations)
      .where(
        and(
          isNull(organizations.deletedAt),
          sql`coalesce((${organizations.settings} ->> 'allowPublicRegistration')::boolean, true)`,
        ),
      )
      .orderBy(asc(organizations.name))
      .limit(200),
  );
}

export async function createOrganization(
  db: Db,
  auth: AuthContext,
  input: CreateOrganizationInput,
  meta: RequestMeta,
): Promise<Organization> {
  try {
    return await db.withSystem(async (tx) => {
      const [organization] = await tx
        .insert(organizations)
        .values({
          name: input.name,
          slug: input.slug,
          type: input.type,
          description: input.description ?? null,
          contactEmail: input.contactEmail ?? null,
          settings: organizationSettingsSchema.parse({}),
          createdBy: auth.user.id,
        })
        .returning();
      if (!organization) throw new Error("organization insert returned no row");

      await seedOrganizationDefaults(tx, organization.id);

      await tx.insert(organizationMembers).values({
        organizationId: organization.id,
        userId: auth.user.id,
        role: "ORGANIZATION_ADMIN",
      });

      // Make the new organization active so the creator lands in it.
      await tx
        .update(sessions)
        .set({ activeOrganizationId: organization.id })
        .where(eq(sessions.id, auth.sessionId));

      await recordAudit(tx, {
        organizationId: organization.id,
        actorId: auth.user.id,
        action: "organization.created",
        entityType: "organization",
        entityId: organization.id,
        metadata: { slug: organization.slug, type: organization.type },
        ipAddress: meta.ipAddress,
        requestId: meta.requestId,
      });
      return toOrganization(organization);
    });
  } catch (error) {
    if (isUniqueViolation(error, "organizations_slug_uq")) {
      throw errors.conflict("This organization address is already taken");
    }
    throw error;
  }
}

export async function seedOrganizationDefaults(tx: Tx, organizationId: string): Promise<void> {
  await tx.insert(complaintCategories).values(
    DEFAULT_CATEGORIES.map((category, index) => ({
      organizationId,
      name: category.name,
      slug: category.slug,
      sortOrder: index,
    })),
  );
  await tx.insert(slaPolicies).values(
    (Object.keys(DEFAULT_SLA_MINUTES) as ComplaintPriority[]).map((priority) => ({
      organizationId,
      categoryId: null,
      priority,
      resolutionMinutes: DEFAULT_SLA_MINUTES[priority].resolution,
      warningMinutes: DEFAULT_SLA_MINUTES[priority].warning,
    })),
  );
}

export async function listOrganizations(db: Db, auth: AuthContext): Promise<Organization[]> {
  const rows = await db.withSystem((tx) =>
    auth.user.isSuperAdmin
      ? tx
          .select()
          .from(organizations)
          .where(isNull(organizations.deletedAt))
          .orderBy(asc(organizations.name))
      : tx
          .select({ organization: organizations })
          .from(organizationMembers)
          .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
          .where(
            and(
              eq(organizationMembers.userId, auth.user.id),
              eq(organizationMembers.status, "ACTIVE"),
              isNull(organizations.deletedAt),
            ),
          )
          .orderBy(asc(organizations.name))
          .then((result) => result.map((r) => r.organization)),
  );
  return rows.map(toOrganization);
}

/**
 * Read one organization. The lookup runs under the caller's tenant context, so a
 * request for an organization other than the active one finds nothing — row-level
 * security, not an `if`, is what keeps tenants apart.
 */
export async function getOrganization(
  db: Db,
  ctx: TenantContext,
  organizationId: string,
): Promise<Organization> {
  const [row] = await db.withTenant(ctx, (tx) =>
    tx
      .select()
      .from(organizations)
      .where(and(eq(organizations.id, organizationId), isNull(organizations.deletedAt)))
      .limit(1),
  );
  if (!row) throw errors.notFound("Organization");
  return toOrganization(row);
}

export interface UpdateOrganizationInput {
  name?: string;
  description?: string | null;
  contactEmail?: string | null;
  settings?: Partial<OrganizationSettings>;
}

export async function updateOrganization(
  db: Db,
  ctx: TenantContext,
  organizationId: string,
  input: UpdateOrganizationInput,
  meta: RequestMeta,
): Promise<Organization> {
  return db.withTenant(ctx, async (tx) => {
    const [current] = await tx
      .select()
      .from(organizations)
      .where(and(eq(organizations.id, organizationId), isNull(organizations.deletedAt)))
      .for("update")
      .limit(1);
    if (!current) throw errors.notFound("Organization");

    const settings = organizationSettingsSchema.parse({ ...current.settings, ...input.settings });
    const [updated] = await tx
      .update(organizations)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.contactEmail !== undefined ? { contactEmail: input.contactEmail } : {}),
        settings,
      })
      .where(eq(organizations.id, organizationId))
      .returning();
    if (!updated) throw errors.notFound("Organization");

    await recordAudit(tx, {
      organizationId,
      actorId: ctx.userId,
      action: "organization.updated",
      entityType: "organization",
      entityId: organizationId,
      metadata: { fields: Object.keys(input) },
      ipAddress: meta.ipAddress,
      requestId: meta.requestId,
    });
    return toOrganization(updated);
  });
}

export async function listMembers(
  db: Db,
  ctx: TenantContext,
  options: { page: number; pageSize: number; departmentId?: string | null },
) {
  return db.withTenant(ctx, async (tx) => {
    const where = options.departmentId
      ? eq(organizationMembers.departmentId, options.departmentId)
      : undefined;
    const [totalRow] = await tx.select({ value: count() }).from(organizationMembers).where(where);
    const rows = await tx
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
      .where(where)
      .orderBy(asc(users.fullName), asc(organizationMembers.id))
      .limit(options.pageSize)
      .offset((options.page - 1) * options.pageSize);
    return {
      total: totalRow?.value ?? 0,
      rows: rows.map((row) => ({ ...row, joinedAt: row.joinedAt.toISOString() })),
    };
  });
}
