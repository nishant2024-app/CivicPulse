import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  // Only needed for introspection commands; `generate` works offline from the schema.
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://localhost/civicpulse" },
});
