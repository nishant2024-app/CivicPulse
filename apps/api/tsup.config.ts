import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts", "src/seed.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // Workspace packages ship TypeScript source, so they are bundled; npm packages stay external.
  noExternal: [/^@civicpulse\//],
});
