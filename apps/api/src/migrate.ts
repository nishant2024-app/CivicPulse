/**
 * Apply database migrations. Shipped in the API image so a Kubernetes Job (or a deploy
 * step) can run `node dist/migrate.js` before the new version starts.
 */
import { runMigrations } from "@civicpulse/db";

const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL (or DATABASE_MIGRATION_URL) is required");
  process.exit(1);
}
try {
  await runMigrations(url);
  console.log("Migrations applied");
} catch (error) {
  console.error("Migration failed:", error);
  process.exit(1);
}
