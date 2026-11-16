import { and, eq, gt, isNull, ne } from "drizzle-orm";
import { organizationMembers, sessions, users, type Tx } from "@civicpulse/db";
import { generateToken, hashToken } from "@civicpulse/platform";
import type { MemberRole, Role } from "@civicpulse/shared";

export const SESSION_COOKIE = "cp_session";
/** Sliding expiry is written at most this often, to avoid a write on every request. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface SessionTtl {
  ttlHours: number;
  absoluteTtlHours: number;
}

export interface AuthContext {
  sessionId: string;
  user: { id: string; email: string; fullName: string; isSuperAdmin: boolean };
  activeOrganizationId: string | null;
  /** Effective role in the active organization; null when the user has none. */
  role: Role | null;
  memberId: string | null;
  departmentId: string | null;
}

export async function createSession(
  tx: Tx,
  input: {
    userId: string;
    activeOrganizationId: string | null;
    ipAddress: string | null;
    userAgent: string | null;
  },
  ttl: SessionTtl,
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const now = Date.now();
  const expiresAt = new Date(now + ttl.ttlHours * 3_600_000);
  await tx.insert(sessions).values({
    userId: input.userId,
    tokenHash: hashToken(token),
    activeOrganizationId: input.activeOrganizationId,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent?.slice(0, 500) ?? null,
    expiresAt,
    absoluteExpiresAt: new Date(now + ttl.absoluteTtlHours * 3_600_000),
  });
  return { token, expiresAt };
}

/** Resolve a session token to an auth context, or null if it is not valid. */
export async function resolveSession(
  tx: Tx,
  token: string,
  ttl: SessionTtl,
): Promise<AuthContext | null> {
  const now = new Date();
  const [row] = await tx
    .select({
      sessionId: sessions.id,
      activeOrganizationId: sessions.activeOrganizationId,
      lastSeenAt: sessions.lastSeenAt,
      absoluteExpiresAt: sessions.absoluteExpiresAt,
      userId: users.id,
      email: users.email,
      fullName: users.fullName,
      isSuperAdmin: users.isSuperAdmin,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
        gt(sessions.absoluteExpiresAt, now),
        eq(users.status, "ACTIVE"),
      ),
    )
    .limit(1);
  if (!row) return null;

  if (now.getTime() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    const slid = new Date(now.getTime() + ttl.ttlHours * 3_600_000);
    await tx
      .update(sessions)
      .set({
        lastSeenAt: now,
        expiresAt: slid < row.absoluteExpiresAt ? slid : row.absoluteExpiresAt,
      })
      .where(eq(sessions.id, row.sessionId));
  }

  let membership: { id: string; role: MemberRole; departmentId: string | null } | undefined;
  if (row.activeOrganizationId) {
    [membership] = await tx
      .select({
        id: organizationMembers.id,
        role: organizationMembers.role,
        departmentId: organizationMembers.departmentId,
      })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.userId, row.userId),
          eq(organizationMembers.organizationId, row.activeOrganizationId),
          eq(organizationMembers.status, "ACTIVE"),
        ),
      )
      .limit(1);
  }

  // A membership that was removed after the session was created grants nothing.
  const hasAccess = row.isSuperAdmin || membership !== undefined;
  const role: Role | null = row.isSuperAdmin ? "SUPER_ADMIN" : (membership?.role ?? null);

  return {
    sessionId: row.sessionId,
    user: {
      id: row.userId,
      email: row.email,
      fullName: row.fullName,
      isSuperAdmin: row.isSuperAdmin,
    },
    activeOrganizationId: hasAccess ? row.activeOrganizationId : null,
    role,
    memberId: membership?.id ?? null,
    departmentId: membership?.departmentId ?? null,
  };
}

export async function revokeSession(tx: Tx, sessionId: string, userId: string): Promise<boolean> {
  const revoked = await tx
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  return revoked.length > 0;
}

export async function revokeAllSessions(
  tx: Tx,
  userId: string,
  exceptSessionId?: string,
): Promise<void> {
  await tx
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        exceptSessionId ? ne(sessions.id, exceptSessionId) : undefined,
      ),
    );
}
