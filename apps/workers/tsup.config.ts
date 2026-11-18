import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts", "src/reindex.ts", "src/redrive.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // Workspace packages ship TypeScript source, so they are compiled into the bundle.
  // Every npm package stays external and is installed into the image with the app.
  noExternal: [/^@civicpulse\//],
  external: [/^(?!@civicpulse\/)[a-z@]/],
});
