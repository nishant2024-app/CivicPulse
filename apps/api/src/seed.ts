/**
 * Seed a demo organization with one user per role.
 * Idempotent: running it again changes nothing. Refuses to run in production.
 *
 * Passwords come from SEED_PASSWORD (default below is for local development only).
 */
import { eq, sql } from "drizzle-orm";
import { createDb, departments, organizationMembers, organizations, users } from "@civicpulse/db";
import { loadConfig } from "@civicpulse/platform";
import { organizationSettingsSchema, type MemberRole } from "@civicpulse/shared";
import { hashPassword } from "./modules/auth/passwords";
import { seedOrganizationDefaults } from "./modules/organizations/service";

const config = loadConfig();
if (config.isProduction && process.env.ALLOW_DEMO_SEED !== "true") {
  console.error(
    "Refusing to seed demo data in production (set ALLOW_DEMO_SEED=true for a demo cluster)",
  );
  process.exit(1);
}

const password = process.env.SEED_PASSWORD ?? "civicpulse-demo-1";
const db = createDb({ connectionString: config.DATABASE_URL, maxConnections: 2 });

const people: Array<{ email: string; fullName: string; role: MemberRole | "SUPER_ADMIN" }> = [
  { email: "superadmin@civicpulse.local", fullName: "Platform Admin", role: "SUPER_ADMIN" },
  { email: "admin@demo.civicpulse.local", fullName: "Asha Verma", role: "ORGANIZATION_ADMIN" },
  { email: "manager@demo.civicpulse.local", fullName: "Rohan Mehta", role: "DEPARTMENT_MANAGER" },
  { email: "worker@demo.civicpulse.local", fullName: "Imran Sheikh", role: "FIELD_WORKER" },
  { email: "citizen@demo.civicpulse.local", fullName: "Priya Nair", role: "CITIZEN" },
];

try {
  const passwordHash = await hashPassword(password);
  await db.withSystem(async (tx) => {
    let [organization] = await tx
      .select()
      .from(organizations)
      .where(eq(organizations.slug, "demo-campus"))
      .limit(1);
    if (!organization) {
      [organization] = await tx
        .insert(organizations)
        .values({
          name: "Demo Campus",
          slug: "demo-campus",
          type: "COLLEGE",
          description: "Sample college campus for trying out CivicPulse.",
          settings: organizationSettingsSchema.parse({}),
        })
        .returning();
      await seedOrganizationDefaults(tx, organization!.id);
    }
    const organizationId = organization!.id;

    let [department] = await tx
      .select()
      .from(departments)
      .where(eq(departments.organizationId, organizationId))
      .limit(1);
    if (!department) {
      [department] = await tx
        .insert(departments)
        .values({
          organizationId,
          name: "Maintenance",
          description: "Campus maintenance and repairs",
        })
        .returning();
    }

    for (const person of people) {
      let [user] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(sql`lower(${users.email})`, person.email))
        .limit(1);
      if (!user) {
        [user] = await tx
          .insert(users)
          .values({
            email: person.email,
            fullName: person.fullName,
            passwordHash,
            isSuperAdmin: person.role === "SUPER_ADMIN",
            emailVerifiedAt: new Date(),
          })
          .returning({ id: users.id });
      }
      if (person.role === "SUPER_ADMIN") continue;
      const staffInDepartment =
        person.role === "DEPARTMENT_MANAGER" || person.role === "FIELD_WORKER";
      await tx
        .insert(organizationMembers)
        .values({
          organizationId,
          userId: user!.id,
          role: person.role,
          departmentId: staffInDepartment ? department!.id : null,
        })
        .onConflictDoNothing();
      if (person.role === "DEPARTMENT_MANAGER") {
        await tx
          .update(departments)
          .set({ managerUserId: user!.id })
          .where(eq(departments.id, department!.id));
      }
    }
  });
  console.log("Seeded organization 'demo-campus' with accounts:");
  for (const person of people) console.log(`  ${person.role.padEnd(20)} ${person.email}`);
  console.log(
    `Password for all accounts: ${process.env.SEED_PASSWORD ? "(SEED_PASSWORD)" : password}`,
  );
} finally {
  await db.close();
}
