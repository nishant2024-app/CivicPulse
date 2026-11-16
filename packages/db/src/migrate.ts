import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

export const MIGRATIONS_DIR =
  process.env.MIGRATIONS_DIR ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");

/** Apply all pending migrations. Safe to run repeatedly. */
export async function runMigrations(connectionString: string): Promise<void> {
  const pool = new pg.Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await pool.end();
  }
}

const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL (or DATABASE_MIGRATION_URL) is required");
    process.exit(1);
  }
  runMigrations(url)
    .then(() => console.log("Migrations applied"))
    .catch((error: unknown) => {
      console.error("Migration failed:", error);
      process.exit(1);
    });
}
