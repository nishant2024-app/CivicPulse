import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import {
  organizationMembers,
  organizations,
  passwordResetTokens,
  sessions,
  users,
  type Db,
  type Tx,
} from "@civicpulse/db";
import { generateToken, hashToken, type AppConfig, type Mailer } from "@civicpulse/platform";
import {
  permissionsFor,
  type ChangePasswordInput,
  type LoginInput,
  type Me,
  type Membership,
  type RegisterInput,
  type SessionInfo,
} from "@civicpulse/shared";
import { errors, isUniqueViolation } from "../../errors";
import { recordAudit } from "../audit/service";
import { hashPassword, needsRehash, verifyAgainstDummy, verifyPassword } from "./passwords";
import {
  createSession,
  revokeAllSessions,
  revokeSession,
  type AuthContext,
  type SessionTtl,
} from "./sessions";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string;
}

export interface AuthDeps {
  db: Db;
  config: AppConfig;
  mailer: Mailer;
}

function ttlOf(config: AppConfig): SessionTtl {
  return {
    ttlHours: config.SESSION_TTL_HOURS,
    absoluteTtlHours: config.SESSION_ABSOLUTE_TTL_HOURS,
  };
}

export async function listMemberships(tx: Tx, userId: string): Promise<Membership[]> {
  return tx
    .select({
      organizationId: organizations.id,
      organizationName: organizations.name,
      organizationSlug: organizations.slug,
      role: organizationMembers.role,
      departmentId: organizationMembers.departmentId,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(
      and(
        eq(organizationMembers.userId, userId),
        eq(organizationMembers.status, "ACTIVE"),
        isNull(organizations.deletedAt),
      ),
    )
    .orderBy(organizationMembers.createdAt);
}

export async function register(deps: AuthDeps, input: RegisterInput, meta: RequestMeta) {
  const { db, config } = deps;
  const passwordHash = await hashPassword(input.password);

  try {
    return await db.withSystem(async (tx) => {
      let organizationId: string | null = null;
      if (input.organizationSlug) {
        const [organization] = await tx
          .select({ id: organizations.id, settings: organizations.settings })
          .from(organizations)
          .where(
            and(eq(organizations.slug, input.organizationSlug), isNull(organizations.deletedAt)),
          )
          .limit(1);
        if (!organization?.settings.allowPublicRegistration) {
          throw errors.badRequest("This organization is not open for registration");
        }
        organizationId = organization.id;
      }

      const [user] = await tx
        .insert(users)
        .values({ email: input.email, fullName: input.fullName, passwordHash })
        .returning({ id: users.id });
      if (!user) throw new Error("user insert returned no row");

      if (organizationId) {
        await tx
          .insert(organizationMembers)
          .values({ organizationId, userId: user.id, role: "CITIZEN" });
      }

      await recordAudit(tx, {
        organizationId,
        actorId: user.id,
        action: "user.registered",
        entityType: "user",
        entityId: user.id,
        ipAddress: meta.ipAddress,
        requestId: meta.requestId,
      });

      return createSession(
        tx,
        { userId: user.id, activeOrganizationId: organizationId, ...meta },
        ttlOf(config),
      );
    });
  } catch (error) {
    if (isUniqueViolation(error, "users_email_lower_uq")) {
      throw errors.conflict("An account with this email already exists");
    }
    throw error;
  }
}

export async function login(deps: AuthDeps, input: LoginInput, meta: RequestMeta) {
  const { db, config } = deps;
  const invalid = () => errors.unauthenticated("Incorrect email or password");

  const [user] = await db.withSystem((tx) =>
    tx
      .select({ id: users.id, passwordHash: users.passwordHash, status: users.status })
      .from(users)
      .where(eq(sql`lower(${users.email})`, input.email))
      .limit(1),
  );

  if (!user?.passwordHash || user.status !== "ACTIVE") {
    await verifyAgainstDummy(input.password);
    await db.withSystem((tx) =>
      recordAudit(tx, {
        organizationId: null,
        actorId: null,
        action: "user.login_failed",
        entityType: "user",
        metadata: { reason: "unknown_or_inactive" },
        ipAddress: meta.ipAddress,
        requestId: meta.requestId,
      }),
    );
    throw invalid();
  }

  const passwordOk = await verifyPassword(user.passwordHash, input.password);
  if (!passwordOk) {
    await db.withSystem((tx) =>
      recordAudit(tx, {
        organizationId: null,
        actorId: user.id,
        action: "user.login_failed",
        entityType: "user",
        entityId: user.id,
        metadata: { reason: "bad_password" },
        ipAddress: meta.ipAddress,
        requestId: meta.requestId,
      }),
    );
    throw invalid();
  }

  const upgradedHash = needsRehash(user.passwordHash)
    ? await hashPassword(input.password)
    : undefined;

  return db.withSystem(async (tx) => {
    const memberships = await listMemberships(tx, user.id);
    await tx
      .update(users)
      .set({ lastLoginAt: new Date(), ...(upgradedHash ? { passwordHash: upgradedHash } : {}) })
      .where(eq(users.id, user.id));
    await recordAudit(tx, {
      organizationId: null,
      actorId: user.id,
      action: "user.login",
      entityType: "user",
      entityId: user.id,
      ipAddress: meta.ipAddress,
      requestId: meta.requestId,
    });
    // Always a brand-new session: a pre-login cookie value is never reused (no fixation).
    return createSession(
      tx,
      {
        userId: user.id,
        activeOrganizationId: memberships[0]?.organizationId ?? null,
        ...meta,
      },
      ttlOf(config),
    );
  });
}

export async function logout(db: Db, auth: AuthContext, meta: RequestMeta): Promise<void> {
  await db.withSystem(async (tx) => {
    await revokeSession(tx, auth.sessionId, auth.user.id);
    await recordAudit(tx, {
      organizationId: null,
      actorId: auth.user.id,
      action: "user.logout",
      entityType: "user",
      entityId: auth.user.id,
      ipAddress: meta.ipAddress,
      requestId: meta.requestId,
    });
  });
}

export async function getMe(db: Db, auth: AuthContext): Promise<Me> {
  return db.withSystem(async (tx) => {
    const [user] = await tx
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        phone: users.phone,
        isSuperAdmin: users.isSuperAdmin,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, auth.user.id))
      .limit(1);
    if (!user) throw errors.unauthenticated();
    return {
      user: { ...user, createdAt: user.createdAt.toISOString() },
      memberships: await listMemberships(tx, auth.user.id),
      activeOrganizationId: auth.activeOrganizationId,
      role: auth.role,
      permissions: permissionsFor(auth.role),
    };
  });
}

export async function switchOrganization(
  db: Db,
  auth: AuthContext,
  organizationId: string,
): Promise<void> {
  await db.withSystem(async (tx) => {
    if (auth.user.isSuperAdmin) {
      const [organization] = await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(and(eq(organizations.id, organizationId), isNull(organizations.deletedAt)))
        .limit(1);
      if (!organization) throw errors.notFound("Organization");
    } else {
      const memberships = await listMemberships(tx, auth.user.id);
      if (!memberships.some((m) => m.organizationId === organizationId)) {
        // Same response whether the organization does not exist or the user is not a member.
        throw errors.notFound("Organization");
      }
    }
    await tx
      .update(sessions)
      .set({ activeOrganizationId: organizationId })
      .where(eq(sessions.id, auth.sessionId));
  });
}

export async function requestPasswordReset(deps: AuthDeps, email: string): Promise<void> {
  const { db, config, mailer } = deps;
  const [user] = await db.withSystem((tx) =>
    tx
      .select({ id: users.id, email: users.email, fullName: users.fullName })
      .from(users)
      .where(and(eq(sql`lower(${users.email})`, email), eq(users.status, "ACTIVE")))
      .limit(1),
  );
  // Unknown email: do nothing, and the caller responds identically either way.
  if (!user) return;

  const token = generateToken();
  await db.withSystem((tx) =>
    tx.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    }),
  );

  const link = `${config.WEB_ORIGIN}/reset-password?token=${encodeURIComponent(token)}`;
  await mailer.send({
    to: user.email,
    template: "password-reset",
    subject: "Reset your CivicPulse password",
    text: `Hello ${user.fullName},\n\nUse this link to choose a new password. It expires in one hour and can be used once.\n\n${link}\n\nIf you did not ask for this, you can ignore this email.`,
  });
}

export async function resetPassword(
  db: Db,
  input: { token: string; password: string },
  meta: RequestMeta,
): Promise<void> {
  const passwordHash = await hashPassword(input.password);
  await db.withSystem(async (tx) => {
    // Claim the token atomically so two concurrent requests cannot both use it.
    const [claimed] = await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(passwordResetTokens.tokenHash, hashToken(input.token)),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, new Date()),
        ),
      )
      .returning({ userId: passwordResetTokens.userId });
    if (!claimed) throw errors.badRequest("This reset link is invalid or has expired");

    await tx.update(users).set({ passwordHash }).where(eq(users.id, claimed.userId));
    await revokeAllSessions(tx, claimed.userId);
    await recordAudit(tx, {
      organizationId: null,
      actorId: claimed.userId,
      action: "user.password_reset",
      entityType: "user",
      entityId: claimed.userId,
      ipAddress: meta.ipAddress,
      requestId: meta.requestId,
    });
  });
}

export async function changePassword(
  db: Db,
  auth: AuthContext,
  input: ChangePasswordInput,
  meta: RequestMeta,
): Promise<void> {
  const [user] = await db.withSystem((tx) =>
    tx
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, auth.user.id))
      .limit(1),
  );
  if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, input.currentPassword))) {
    throw errors.badRequest("Current password is incorrect");
  }
  const passwordHash = await hashPassword(input.newPassword);
  await db.withSystem(async (tx) => {
    await tx.update(users).set({ passwordHash }).where(eq(users.id, auth.user.id));
    await revokeAllSessions(tx, auth.user.id, auth.sessionId);
    await recordAudit(tx, {
      organizationId: null,
      actorId: auth.user.id,
      action: "user.password_changed",
      entityType: "user",
      entityId: auth.user.id,
      ipAddress: meta.ipAddress,
      requestId: meta.requestId,
    });
  });
}

export async function listSessions(db: Db, auth: AuthContext): Promise<SessionInfo[]> {
  const rows = await db.withSystem((tx) =>
    tx
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, auth.user.id),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(sessions.lastSeenAt)),
  );
  return rows.map((row) => ({
    id: row.id,
    current: row.id === auth.sessionId,
    userAgent: row.userAgent,
    ipAddress: row.ipAddress,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  }));
}

export async function revokeOwnSession(
  db: Db,
  auth: AuthContext,
  sessionId: string,
): Promise<void> {
  const revoked = await db.withSystem((tx) => revokeSession(tx, sessionId, auth.user.id));
  if (!revoked) throw errors.notFound("Session");
}
