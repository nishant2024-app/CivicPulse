import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  auditLogs,
  complaintCategories,
  complaints,
  complaintStatusHistory,
  departments,
  organizationMembers,
  organizations,
  slaPolicies,
  users,
} from "@civicpulse/db";
import { generateTrackingId } from "@civicpulse/platform";
import {
  createOrganizationWithAdmin,
  createTestContext,
  expectDatabaseRejection,
  registerUser,
  resetDatabase,
  type TestContext,
} from "./helpers";

let ctx: TestContext;
let alpha: Awaited<ReturnType<typeof createOrganizationWithAdmin>>;
let beta: Awaited<ReturnType<typeof createOrganizationWithAdmin>>;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDatabase(ctx.db);
  alpha = await createOrganizationWithAdmin(ctx, "alpha-college");
  beta = await createOrganizationWithAdmin(ctx, "beta-society");
});

const tenantOf = (org: { organizationId: string; userId: string }) => ({
  organizationId: org.organizationId,
  userId: org.userId,
});

/** Insert a complaint for an organization using privileged access (test fixture). */
async function insertComplaint(org: { organizationId: string; userId: string }) {
  return ctx.db.withSystem(async (tx) => {
    const [category] = await tx
      .select({ id: complaintCategories.id })
      .from(complaintCategories)
      .where(eq(complaintCategories.organizationId, org.organizationId))
      .limit(1);
    const [complaint] = await tx
      .insert(complaints)
      .values({
        organizationId: org.organizationId,
        trackingId: generateTrackingId(),
        reporterId: org.userId,
        categoryId: category!.id,
        title: "Broken streetlight",
        description: "The light near the library gate has been out for a week.",
        locationText: "Library gate",
      })
      .returning();
    await tx.insert(complaintStatusHistory).values({
      organizationId: org.organizationId,
      complaintId: complaint!.id,
      toStatus: "REPORTED",
      changedBy: org.userId,
    });
    return complaint!;
  });
}

describe("row-level security (database layer)", () => {
  it("shows a tenant only its own rows", async () => {
    await insertComplaint(alpha);
    await insertComplaint(beta);

    const seen = await ctx.db.withTenant(tenantOf(alpha), async (tx) => ({
      organizations: await tx.select({ id: organizations.id }).from(organizations),
      categories: await tx
        .selectDistinct({ org: complaintCategories.organizationId })
        .from(complaintCategories),
      sla: await tx.selectDistinct({ org: slaPolicies.organizationId }).from(slaPolicies),
      members: await tx
        .select({ org: organizationMembers.organizationId })
        .from(organizationMembers),
      complaints: await tx.select({ org: complaints.organizationId }).from(complaints),
      history: await tx
        .select({ org: complaintStatusHistory.organizationId })
        .from(complaintStatusHistory),
      audit: await tx.selectDistinct({ org: auditLogs.organizationId }).from(auditLogs),
    }));

    expect(seen.organizations).toEqual([{ id: alpha.organizationId }]);
    for (const rows of [seen.categories, seen.sla, seen.members, seen.complaints, seen.history, seen.audit]) {
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.org === alpha.organizationId)).toBe(true);
    }
  });

  it("cannot read another tenant's row even when asking for it by ID", async () => {
    const foreign = await insertComplaint(beta);
    const rows = await ctx.db.withTenant(tenantOf(alpha), (tx) =>
      tx.select().from(complaints).where(eq(complaints.id, foreign.id)),
    );
    expect(rows).toEqual([]);
  });

  it("cannot update or delete another tenant's rows", async () => {
    const foreign = await insertComplaint(beta);
    const result = await ctx.db.withTenant(tenantOf(alpha), async (tx) => ({
      updated: await tx
        .update(complaints)
        .set({ title: "hijacked" })
        .where(eq(complaints.id, foreign.id))
        .returning({ id: complaints.id }),
      deleted: await tx
        .delete(departments)
        .where(eq(departments.organizationId, beta.organizationId))
        .returning({ id: departments.id }),
    }));
    expect(result).toEqual({ updated: [], deleted: [] });

    const [untouched] = await ctx.db.withSystem((tx) =>
      tx.select({ title: complaints.title }).from(complaints).where(eq(complaints.id, foreign.id)),
    );
    expect(untouched?.title).toBe("Broken streetlight");
  });

  it("refuses to insert a row that belongs to another tenant", async () => {
    await expectDatabaseRejection(
      ctx.db.withTenant(tenantOf(alpha), (tx) =>
        tx.insert(departments).values({ organizationId: beta.organizationId, name: "Planted" }),
      ),
     /row-level security/i);
  });

  it("refuses to move a row into another tenant", async () => {
    const own = await insertComplaint(alpha);
    await expectDatabaseRejection(
      ctx.db.withTenant(tenantOf(alpha), (tx) =>
        tx
          .update(complaints)
          .set({ organizationId: beta.organizationId })
          .where(eq(complaints.id, own.id)),
      ),
     /row-level security/i);
  });

  it("fails closed when no tenant is set: nothing visible, nothing insertable", async () => {
    await insertComplaint(alpha);
    const rows = await ctx.db.withSystem(async (tx) => {
      await tx.execute(sql`set local role civicpulse_app`);
      return {
        complaints: await tx.select().from(complaints),
        organizations: await tx.select().from(organizations),
      };
    });
    expect(rows).toEqual({ complaints: [], organizations: [] });

    await expectDatabaseRejection(
      ctx.db.withSystem(async (tx) => {
        await tx.execute(sql`set local role civicpulse_app`);
        await tx.insert(departments).values({ organizationId: alpha.organizationId, name: "X" });
      }),
     /row-level security/i);
  });

  it("does not leak the tenant setting to the next transaction on a pooled connection", async () => {
    await insertComplaint(alpha);
    // One connection, so the second transaction is guaranteed to reuse it.
    for (let i = 0; i < 3; i++) {
      await ctx.db.withTenant(tenantOf(alpha), (tx) => tx.select().from(complaints));
      const after = await ctx.db.withSystem((tx) =>
        tx.execute<{ org: string | null; role: string }>(
          sql`select current_setting('app.organization_id', true) as org, current_user as role`,
        ),
      );
      expect(after.rows[0]!.org ?? "").toBe("");
      expect(after.rows[0]!.role).not.toBe("civicpulse_app");
    }
  });

  it("rejects a malformed tenant context before touching the database", async () => {
    await expect(
      ctx.db.withTenant({ organizationId: "'; drop table users; --", userId: null }, async () => 1),
    ).rejects.toThrow(/invalid tenant context/);
  });

  it("hides users of other organizations and never exposes password hashes", async () => {
    const users_ = await ctx.db.withTenant(tenantOf(alpha), (tx) =>
      tx.select({ id: users.id }).from(users),
    );
    expect(users_.map((u) => u.id)).toEqual([alpha.userId]);

    await expectDatabaseRejection(
      ctx.db.withTenant(tenantOf(alpha), (tx) =>
        tx.select({ hash: users.passwordHash }).from(users),
      ),
      /permission denied/i,
    );
  });
});

describe("append-only tables", () => {
  it("rejects UPDATE and DELETE on status history, even with full privileges", async () => {
    const complaint = await insertComplaint(alpha);
    await expectDatabaseRejection(
      ctx.db.withSystem((tx) =>
        tx
          .update(complaintStatusHistory)
          .set({ note: "rewritten" })
          .where(eq(complaintStatusHistory.complaintId, complaint.id)),
      ),
     /append-only/);
    await expectDatabaseRejection(
      ctx.db.withSystem((tx) =>
        tx.delete(complaintStatusHistory).where(eq(complaintStatusHistory.complaintId, complaint.id)),
      ),
     /append-only/);
  });

  it("rejects UPDATE and DELETE on audit logs", async () => {
    await expectDatabaseRejection(
      ctx.db.withSystem((tx) => tx.update(auditLogs).set({ action: "tampered" })),
     /append-only/);
    await expectDatabaseRejection(ctx.db.withSystem((tx) => tx.delete(auditLogs)), /append-only/);
    await expectDatabaseRejection(
      ctx.db.withTenant(tenantOf(alpha), (tx) => tx.delete(auditLogs)),
     /permission denied/i);
  });

  it("allows a retention purge only after an explicit opt-in", async () => {
    const before = await ctx.db.withSystem((tx) => tx.select().from(auditLogs));
    expect(before.length).toBeGreaterThan(0);
    await ctx.db.withSystem(async (tx) => {
      await tx.execute(sql`select set_config('app.retention_purge', 'on', true)`);
      await tx.delete(auditLogs);
    });
    expect(await ctx.db.withSystem((tx) => tx.select().from(auditLogs))).toEqual([]);
  });
});

describe("organization isolation (HTTP layer)", () => {
  it("returns 404 for another organization's profile", async () => {
    const own = await alpha.client.get(`/api/v1/organizations/${alpha.organizationId}`);
    expect(own.statusCode).toBe(200);
    const foreign = await alpha.client.get(`/api/v1/organizations/${beta.organizationId}`);
    expect(foreign.statusCode).toBe(404);
    expect(foreign.body).not.toContain("beta-society");
  });

  it("does not let an administrator modify another organization", async () => {
    const response = await alpha.client.patch(`/api/v1/organizations/${beta.organizationId}`, {
      name: "Taken Over",
    });
    expect(response.statusCode).toBe(404);
    const [row] = await ctx.db.withSystem((tx) =>
      tx.select().from(organizations).where(eq(organizations.id, beta.organizationId)),
    );
    expect(row?.name).toBe("Organization beta-society");
  });

  it("lists only the caller's organizations and members", async () => {
    await registerUser(ctx, { organizationSlug: "beta-society", fullName: "Beta Citizen" });

    const organizationsSeen = (await alpha.client.get("/api/v1/organizations")).json().data;
    expect(organizationsSeen.map((o: { slug: string }) => o.slug)).toEqual(["alpha-college"]);

    const members = (await alpha.client.get("/api/v1/organizations/current/members")).json();
    expect(members.pagination.total).toBe(1);
    expect(members.data.map((m: { userId: string }) => m.userId)).toEqual([alpha.userId]);
  });

  it("refuses to switch into an organization the user does not belong to", async () => {
    const response = await alpha.client.post("/api/v1/auth/switch-organization", {
      organizationId: beta.organizationId,
    });
    expect(response.statusCode).toBe(404);
    const me = (await alpha.client.get("/api/v1/auth/me")).json();
    expect(me.activeOrganizationId).toBe(alpha.organizationId);
  });

  it("drops access as soon as a membership is removed", async () => {
    const citizen = await registerUser(ctx, { organizationSlug: "alpha-college" });
    expect(
      (await citizen.client.get(`/api/v1/organizations/${alpha.organizationId}`)).statusCode,
    ).toBe(200);

    await ctx.db.withSystem((tx) =>
      tx
        .update(organizationMembers)
        .set({ status: "REMOVED" })
        .where(eq(organizationMembers.userId, citizen.userId)),
    );
    const after = await citizen.client.get(`/api/v1/organizations/${alpha.organizationId}`);
    expect(after.statusCode).toBe(403);
    expect((await citizen.client.get("/api/v1/auth/me")).json()).toMatchObject({
      role: null,
      activeOrganizationId: null,
      permissions: [],
    });
  });
});

describe("role-based access (HTTP layer)", () => {
  it("gives the organization creator the administrator role", async () => {
    const me = (await alpha.client.get("/api/v1/auth/me")).json();
    expect(me.role).toBe("ORGANIZATION_ADMIN");
    expect(me.permissions).toContain("member:manage");
    expect(me.permissions).not.toContain("platform:admin");
  });

  it("registers citizens with citizen permissions only", async () => {
    const citizen = await registerUser(ctx, { organizationSlug: "alpha-college" });
    const me = (await citizen.client.get("/api/v1/auth/me")).json();
    expect(me.role).toBe("CITIZEN");
    expect(me.activeOrganizationId).toBe(alpha.organizationId);

    const members = await citizen.client.get("/api/v1/organizations/current/members");
    expect(members.statusCode).toBe(403);
    const update = await citizen.client.patch(`/api/v1/organizations/${alpha.organizationId}`, {
      name: "Citizen Was Here",
    });
    expect(update.statusCode).toBe(403);
  });

  it("requires an organization for tenant-scoped endpoints", async () => {
    const loner = await registerUser(ctx);
    const response = await loner.client.get(`/api/v1/organizations/${alpha.organizationId}`);
    expect(response.statusCode).toBe(403);
  });

  it("honours the self-service switch for organization creation", async () => {
    const locked = await createTestContext({ SELF_SERVICE_ORGANIZATIONS: "false" });
    try {
      const user = await registerUser(locked);
      const response = await user.client.post("/api/v1/organizations", {
        name: "Not Allowed",
        slug: "not-allowed",
        type: "COMMUNITY",
      });
      expect(response.statusCode).toBe(403);
    } finally {
      await locked.close();
    }
  });
});

describe("organization management", () => {
  it("seeds default categories and SLA policies for a new organization", async () => {
    const seeded = await ctx.db.withTenant(tenantOf(alpha), async (tx) => ({
      categories: await tx.select({ slug: complaintCategories.slug }).from(complaintCategories),
      sla: await tx.select({ priority: slaPolicies.priority }).from(slaPolicies),
    }));
    expect(seeded.categories).toHaveLength(9);
    expect(seeded.categories.map((c) => c.slug)).toContain("college-infrastructure");
    expect(seeded.sla.map((s) => s.priority).sort()).toEqual(["CRITICAL", "HIGH", "LOW", "MEDIUM"]);
  });

  it("rejects a duplicate organization address", async () => {
    const response = await alpha.client.post("/api/v1/organizations", {
      name: "Copycat",
      slug: "beta-society",
      type: "COMMUNITY",
    });
    expect(response.statusCode).toBe(409);
  });

  it("updates settings, audits the change and controls public registration", async () => {
    const listed = async () =>
      (await ctx.app.inject("/api/v1/organizations/public"))
        .json()
        .data.map((o: { slug: string }) => o.slug);
    expect(await listed()).toEqual(["alpha-college", "beta-society"]);

    const response = await alpha.client.patch(`/api/v1/organizations/${alpha.organizationId}`, {
      description: "Engineering college",
      settings: { allowPublicRegistration: false },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().settings).toMatchObject({
      allowPublicRegistration: false,
      publicTrackingEnabled: true,
    });
    expect(await listed()).toEqual(["beta-society"]);

    const blocked = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: { "x-requested-with": "civicpulse" },
      payload: {
        email: "late@example.test",
        password: "correct-horse-battery",
        fullName: "Late Comer",
        organizationSlug: "alpha-college",
      },
    });
    expect(blocked.statusCode).toBe(400);

    const audit = await ctx.db.withTenant(tenantOf(alpha), (tx) =>
      tx.select().from(auditLogs).where(eq(auditLogs.action, "organization.updated")),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorId).toBe(alpha.userId);
  });
});
