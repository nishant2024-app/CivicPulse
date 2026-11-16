import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs, sessions, users } from "@civicpulse/db";
import { hashToken } from "@civicpulse/platform";
import {
  Client,
  createTestContext,
  PASSWORD,
  registerUser,
  resetDatabase,
  uniqueEmail,
  type TestContext,
} from "./helpers";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDatabase(ctx.db);
  ctx.outbox.length = 0;
});

describe("registration", () => {
  it("creates an account, signs the user in and returns the profile", async () => {
    const client = new Client(ctx.app);
    const email = uniqueEmail();
    const response = await client.post("/api/v1/auth/register", {
      email: email.toUpperCase(),
      password: PASSWORD,
      fullName: "  Priya Nair ",
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.user).toMatchObject({ email, fullName: "Priya Nair", isSuperAdmin: false });
    expect(body.memberships).toEqual([]);
    expect(JSON.stringify(body)).not.toMatch(/password/i);

    const me = await client.get("/api/v1/auth/me");
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe(email);
  });

  it("stores an Argon2id hash, never the password", async () => {
    const { userId } = await registerUser(ctx);
    const [row] = await ctx.db.withSystem((tx) =>
      tx.select({ hash: users.passwordHash }).from(users).where(eq(users.id, userId)),
    );
    expect(row?.hash).toMatch(/^\$argon2id\$/);
    expect(row?.hash).not.toContain(PASSWORD);
  });

  it("rejects a duplicate email regardless of letter case", async () => {
    const { email } = await registerUser(ctx);
    const response = await new Client(ctx.app).post("/api/v1/auth/register", {
      email: email.toUpperCase(),
      password: PASSWORD,
      fullName: "Someone Else",
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("CONFLICT");
  });

  it("validates input and reports each invalid field", async () => {
    const response = await new Client(ctx.app).post("/api/v1/auth/register", {
      email: "not-an-email",
      password: "short",
      fullName: "",
    });
    expect(response.statusCode).toBe(400);
    const error = response.json().error;
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.details.map((d: { path: string }) => d.path).sort()).toEqual([
      "email",
      "fullName",
      "password",
    ]);
  });

  it("refuses to join an organization that does not exist", async () => {
    const response = await new Client(ctx.app).post("/api/v1/auth/register", {
      email: uniqueEmail(),
      password: PASSWORD,
      fullName: "Test User",
      organizationSlug: "no-such-organization",
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("login and sessions", () => {
  it("signs in with correct credentials and sets a hardened cookie", async () => {
    const { email } = await registerUser(ctx);
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { "x-requested-with": "civicpulse" },
      payload: { email, password: PASSWORD },
    });
    expect(response.statusCode).toBe(200);
    const cookie = response.cookies.find((c) => c.name === "cp_session");
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
    expect(cookie?.value.length).toBeGreaterThanOrEqual(43);
  });

  it("stores only a hash of the session token", async () => {
    const { client } = await registerUser(ctx);
    const token = client.cookie!.replace("cp_session=", "");
    const rows = await ctx.db.withSystem((tx) => tx.select().from(sessions));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    const { email } = await registerUser(ctx);
    const wrongPassword = await new Client(ctx.app).post("/api/v1/auth/login", {
      email,
      password: "definitely-wrong",
    });
    const unknownEmail = await new Client(ctx.app).post("/api/v1/auth/login", {
      email: uniqueEmail("ghost"),
      password: "definitely-wrong",
    });
    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(wrongPassword.json().error.message).toBe(unknownEmail.json().error.message);

    const failures = await ctx.db.withSystem((tx) =>
      tx.select().from(auditLogs).where(eq(auditLogs.action, "user.login_failed")),
    );
    expect(failures).toHaveLength(2);
  });

  it("rejects requests without a session", async () => {
    const response = await new Client(ctx.app).get("/api/v1/auth/me");
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects a forged session cookie", async () => {
    const client = new Client(ctx.app);
    client.cookie = "cp_session=forged-token-value-that-was-never-issued";
    expect((await client.get("/api/v1/auth/me")).statusCode).toBe(401);
  });

  it("invalidates the session on logout", async () => {
    const { client } = await registerUser(ctx);
    const stolen = client.cookie!;
    expect((await client.post("/api/v1/auth/logout")).statusCode).toBe(200);

    const replay = new Client(ctx.app);
    replay.cookie = stolen;
    expect((await replay.get("/api/v1/auth/me")).statusCode).toBe(401);
  });

  it("rejects an expired session", async () => {
    const { client } = await registerUser(ctx);
    await ctx.db.withSystem((tx) =>
      tx.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }),
    );
    expect((await client.get("/api/v1/auth/me")).statusCode).toBe(401);
  });

  it("lists sessions and lets the user revoke another device", async () => {
    const { client, email } = await registerUser(ctx);
    const second = new Client(ctx.app);
    await second.post("/api/v1/auth/login", { email, password: PASSWORD });

    const list = (await client.get("/api/v1/auth/sessions")).json().data;
    expect(list).toHaveLength(2);
    const other = list.find((s: { current: boolean }) => !s.current);

    expect((await client.delete(`/api/v1/auth/sessions/${other.id}`)).statusCode).toBe(200);
    expect((await second.get("/api/v1/auth/me")).statusCode).toBe(401);
    expect((await client.get("/api/v1/auth/me")).statusCode).toBe(200);
  });

  it("does not let one user revoke another user's session", async () => {
    const alice = await registerUser(ctx);
    const bob = await registerUser(ctx);
    const bobSession = (await bob.client.get("/api/v1/auth/sessions")).json().data[0];
    const response = await alice.client.delete(`/api/v1/auth/sessions/${bobSession.id}`);
    expect(response.statusCode).toBe(404);
    expect((await bob.client.get("/api/v1/auth/me")).statusCode).toBe(200);
  });
});

describe("CSRF protection", () => {
  it("rejects state-changing requests without the custom header", async () => {
    const { client } = await registerUser(ctx);
    const response = await client.request("POST", "/api/v1/auth/logout", {}, { csrf: false });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("CSRF_REJECTED");
    // The session survived the rejected request.
    expect((await client.get("/api/v1/auth/me")).statusCode).toBe(200);
  });

  it("rejects state-changing requests from a foreign origin", async () => {
    const { client } = await registerUser(ctx);
    const response = await client.request(
      "POST",
      "/api/v1/auth/logout",
      {},
      { headers: { origin: "https://evil.example" } },
    );
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("CSRF_REJECTED");
  });

  it("accepts the configured web origin", async () => {
    const { client } = await registerUser(ctx);
    const response = await client.request(
      "POST",
      "/api/v1/auth/logout",
      {},
      { headers: { origin: ctx.config.WEB_ORIGIN } },
    );
    expect(response.statusCode).toBe(200);
  });
});

describe("password management", () => {
  it("changes the password and signs out other devices", async () => {
    const { client, email } = await registerUser(ctx);
    const otherDevice = new Client(ctx.app);
    await otherDevice.post("/api/v1/auth/login", { email, password: PASSWORD });

    const wrong = await client.post("/api/v1/auth/password/change", {
      currentPassword: "not-my-password",
      newPassword: "a-brand-new-password",
    });
    expect(wrong.statusCode).toBe(400);

    const changed = await client.post("/api/v1/auth/password/change", {
      currentPassword: PASSWORD,
      newPassword: "a-brand-new-password",
    });
    expect(changed.statusCode).toBe(200);
    expect((await client.get("/api/v1/auth/me")).statusCode).toBe(200);
    expect((await otherDevice.get("/api/v1/auth/me")).statusCode).toBe(401);

    const oldLogin = await new Client(ctx.app).post("/api/v1/auth/login", {
      email,
      password: PASSWORD,
    });
    expect(oldLogin.statusCode).toBe(401);
  });

  it("answers identically for known and unknown emails when a reset is requested", async () => {
    const { email } = await registerUser(ctx);
    const known = await new Client(ctx.app).post("/api/v1/auth/password/forgot", { email });
    const unknown = await new Client(ctx.app).post("/api/v1/auth/password/forgot", {
      email: uniqueEmail("ghost"),
    });
    expect(known.statusCode).toBe(202);
    expect(unknown.statusCode).toBe(202);
    expect(known.body).toBe(unknown.body);
    expect(ctx.outbox).toHaveLength(1);
    expect(ctx.outbox[0]!.to).toBe(email);
  });

  it("resets the password with a single-use token and revokes all sessions", async () => {
    const { client, email } = await registerUser(ctx);
    await new Client(ctx.app).post("/api/v1/auth/password/forgot", { email });
    const token = decodeURIComponent(/token=([\w%-]+)/.exec(ctx.outbox[0]!.text)![1]!);

    const reset = await new Client(ctx.app).post("/api/v1/auth/password/reset", {
      token,
      password: "freshly-chosen-password",
    });
    expect(reset.statusCode).toBe(200);
    expect((await client.get("/api/v1/auth/me")).statusCode).toBe(401);

    const reuse = await new Client(ctx.app).post("/api/v1/auth/password/reset", {
      token,
      password: "another-password-entirely",
    });
    expect(reuse.statusCode).toBe(400);

    const login = await new Client(ctx.app).post("/api/v1/auth/login", {
      email,
      password: "freshly-chosen-password",
    });
    expect(login.statusCode).toBe(200);
  });

  it("rejects an expired reset token", async () => {
    const { email } = await registerUser(ctx);
    await new Client(ctx.app).post("/api/v1/auth/password/forgot", { email });
    const token = decodeURIComponent(/token=([\w%-]+)/.exec(ctx.outbox[0]!.text)![1]!);
    await ctx.db.withSystem((tx) =>
      tx.execute(sql`update password_reset_tokens set expires_at = now() - interval '1 minute'`),
    );
    const reset = await new Client(ctx.app).post("/api/v1/auth/password/reset", {
      token,
      password: "freshly-chosen-password",
    });
    expect(reset.statusCode).toBe(400);
  });
});

describe("profile and account deletion", () => {
  it("updates the profile", async () => {
    const { client } = await registerUser(ctx);
    const response = await client.patch("/api/v1/users/me", {
      fullName: "Renamed Person",
      phone: "+91 98765 43210",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().user).toMatchObject({
      fullName: "Renamed Person",
      phone: "+91 98765 43210",
    });
  });

  it("anonymizes the account on deletion and blocks further sign-in", async () => {
    const { client, email, userId } = await registerUser(ctx);
    const wrong = await client.delete("/api/v1/users/me", { password: "wrong-password" });
    expect(wrong.statusCode).toBe(400);

    const deleted = await client.delete("/api/v1/users/me", { password: PASSWORD });
    expect(deleted.statusCode).toBe(200);

    const [row] = await ctx.db.withSystem((tx) =>
      tx.select().from(users).where(eq(users.id, userId)),
    );
    expect(row).toMatchObject({ status: "DELETED", fullName: "Deleted user", passwordHash: null });
    expect(row!.email).not.toBe(email);

    const login = await new Client(ctx.app).post("/api/v1/auth/login", {
      email,
      password: PASSWORD,
    });
    expect(login.statusCode).toBe(401);
  });
});

describe("rate limiting", () => {
  it("throttles repeated login attempts with the standard error envelope", async () => {
    const limited = await createTestContext({ RATE_LIMIT_ENABLED: "true" });
    try {
      const client = new Client(limited.app);
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) {
        const response = await client.post("/api/v1/auth/login", {
          email: "nobody@example.test",
          password: "wrong-password",
        });
        statuses.push(response.statusCode);
        if (response.statusCode === 429) {
          expect(response.json().error.code).toBe("RATE_LIMITED");
        }
      }
      expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
      expect(statuses.slice(10)).toEqual([429, 429]);
    } finally {
      await limited.close();
    }
  });
});

describe("operations endpoints", () => {
  it("reports liveness and readiness", async () => {
    expect((await ctx.app.inject("/healthz")).json()).toEqual({ status: "ok" });
    expect((await ctx.app.inject("/readyz")).json()).toEqual({
      status: "ready",
      checks: { database: "ok" },
    });
  });

  it("returns the error envelope and a request ID for unknown routes", async () => {
    const response = await ctx.app.inject("/api/v1/nope");
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("NOT_FOUND");
    expect(response.headers["x-request-id"]).toBe(response.json().error.requestId);
  });

  it("serves an OpenAPI document covering the registered routes", async () => {
    const spec = (await ctx.app.inject("/api/docs/json")).json();
    expect(spec.paths["/api/v1/auth/login"].post).toBeDefined();
    expect(spec.paths["/api/v1/organizations/{id}"].patch).toBeDefined();
  });
});
