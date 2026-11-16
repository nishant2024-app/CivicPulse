import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config";
import { generateTrackingId, hashToken, TRACKING_ID_PATTERN } from "./tokens";

const base = { DATABASE_URL: "postgres://u:p@localhost:5432/db" };

describe("loadConfig", () => {
  it("applies defaults", () => {
    const config = loadConfig(base);
    expect(config.PORT).toBe(4000);
    expect(config.allowedOrigins).toEqual(["http://localhost:3000"]);
    expect(config.RATE_LIMIT_ENABLED).toBe(true);
  });

  it("reports every invalid variable at once", () => {
    expect(() => loadConfig({ PORT: "abc" })).toThrow(ConfigError);
    try {
      loadConfig({ PORT: "abc" });
    } catch (error) {
      expect((error as ConfigError).issues.join("\n")).toMatch(/DATABASE_URL/);
      expect((error as ConfigError).issues.join("\n")).toMatch(/PORT/);
    }
  });

  it("refuses development secrets in production", () => {
    expect(() =>
      loadConfig({ ...base, NODE_ENV: "production", WEB_ORIGIN: "https://app.example.org" }),
    ).toThrow(/SESSION_SECRET/);
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: "production",
        SESSION_SECRET: "x".repeat(40),
        WEB_ORIGIN: "http://app.example.org",
      }),
    ).toThrow(/https/);
  });

  it("merges and normalizes allowed origins", () => {
    const config = loadConfig({ ...base, ALLOWED_ORIGINS: "https://a.example/, https://b.example" });
    expect(config.allowedOrigins).toEqual([
      "http://localhost:3000",
      "https://a.example",
      "https://b.example",
    ]);
  });
});

describe("tokens", () => {
  it("generates tracking IDs in the documented format", () => {
    const ids = new Set(Array.from({ length: 200 }, generateTrackingId));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(TRACKING_ID_PATTERN);
  });

  it("hashes tokens deterministically", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).toHaveLength(64);
  });
});
