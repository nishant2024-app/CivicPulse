import { runMigrations } from "@civicpulse/db";
import { TEST_DATABASE_URL } from "./helpers";

/** Bring the test database to the current schema once per run. */
export default async function setup(): Promise<void> {
  if (!/test/i.test(new URL(TEST_DATABASE_URL).pathname)) {
    throw new Error(
      `Refusing to run tests against "${new URL(TEST_DATABASE_URL).pathname}": ` +
        "the database name must contain 'test' because tests truncate tables.",
    );
  }
  await runMigrations(TEST_DATABASE_URL);
}
