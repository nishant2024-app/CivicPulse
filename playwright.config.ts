import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests drive the real web app and API against a real database.
 * Start both first (`pnpm dev`), or let Playwright start them via `webServer` below.
 */
const chromiumPath = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "off",
    screenshot: "only-on-failure",
    launchOptions: chromiumPath ? { executablePath: chromiumPath } : {},
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /responsive\.spec\.ts/,
    },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /responsive\.spec\.ts/ },
  ],
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        command: "pnpm dev",
        // Many sign-ins from one address in a few seconds would trip the auth rate limit.
        // Rate limiting itself is covered by the API integration tests.
        env: { RATE_LIMIT_ENABLED: "false" },
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
