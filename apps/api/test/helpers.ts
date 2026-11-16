import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";
import { sql } from "drizzle-orm";
import { createDb, type Db } from "@civicpulse/db";
import { loadConfig, type AppConfig, type EmailMessage, type Mailer } from "@civicpulse/platform";
import { CSRF_HEADER, CSRF_HEADER_VALUE } from "@civicpulse/shared";
import { buildApp } from "../src/app";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://civicpulse:civicpulse@localhost:5432/civicpulse_test";

export interface TestContext {
  app: FastifyInstance;
  db: Db;
  config: AppConfig;
  /** Every email the app tried to send during the test. */
  outbox: EmailMessage[];
  close(): Promise<void>;
}

export async function createTestContext(
  overrides: Record<string, string> = {},
): Promise<TestContext> {
  const config = loadConfig({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    DATABASE_URL: TEST_DATABASE_URL,
    DATABASE_POOL_MAX: "5",
    RATE_LIMIT_ENABLED: "false",
    ...overrides,
  });
  const db = createDb({ connectionString: config.DATABASE_URL, maxConnections: 5 });
  const outbox: EmailMessage[] = [];
  const mailer: Mailer = {
    driver: "memory",
    async send(message) {
      outbox.push(message);
    },
  };
  const app = await buildApp({ config, db, mailer });
  await app.ready();
  return {
    app,
    db,
    config,
    outbox,
    async close() {
      await app.close();
      await db.close();
    },
  };
}

/** Empty every application table. TRUNCATE bypasses the append-only row triggers. */
export async function resetDatabase(db: Db): Promise<void> {
  await db.withSystem(async (tx) => {
    const tables = await tx.execute<{ tablename: string }>(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    const names = tables.rows.map((row) => `"${row.tablename}"`).join(", ");
    if (names) await tx.execute(sql.raw(`truncate table ${names} restart identity cascade`));
  });
}

/** A browser-like client: keeps cookies between requests and sends the CSRF header. */
export class Client {
  cookie: string | null = null;

  constructor(private readonly app: FastifyInstance) {}

  async request(
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    url: string,
    body?: unknown,
    options: { headers?: Record<string, string>; csrf?: boolean } = {},
  ): Promise<LightMyRequestResponse> {
    const headers: Record<string, string> = { ...options.headers };
    if (options.csrf !== false) headers[CSRF_HEADER] = CSRF_HEADER_VALUE;
    if (this.cookie) headers.cookie = this.cookie;
    const inject: InjectOptions = { method, url, headers };
    if (body !== undefined) inject.payload = body as InjectOptions["payload"];
    const response = await this.app.inject(inject);
    for (const cookie of response.cookies) {
      if (cookie.name === "cp_session") {
        this.cookie = cookie.value ? `cp_session=${cookie.value}` : null;
      }
    }
    return response;
  }

  get = (url: string) => this.request("GET", url);
  post = (url: string, body?: unknown) => this.request("POST", url, body ?? {});
  patch = (url: string, body?: unknown) => this.request("PATCH", url, body ?? {});
  delete = (url: string, body?: unknown) => this.request("DELETE", url, body);
}

export const PASSWORD = "correct-horse-battery";

let counter = 0;
export function uniqueEmail(prefix = "user"): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}@example.test`;
}

/** Register a user (optionally into an organization) and return a signed-in client. */
export async function registerUser(
  ctx: TestContext,
  options: { organizationSlug?: string; email?: string; fullName?: string } = {},
): Promise<{ client: Client; email: string; userId: string }> {
  const client = new Client(ctx.app);
  const email = options.email ?? uniqueEmail();
  const response = await client.post("/api/v1/auth/register", {
    email,
    password: PASSWORD,
    fullName: options.fullName ?? "Test User",
    ...(options.organizationSlug ? { organizationSlug: options.organizationSlug } : {}),
  });
  if (response.statusCode !== 201) {
    throw new Error(`register failed: ${response.statusCode} ${response.body}`);
  }
  return { client, email, userId: response.json().user.id };
}

/** Register a user who creates an organization and is therefore its administrator. */
export async function createOrganizationWithAdmin(ctx: TestContext, slug: string) {
  const admin = await registerUser(ctx, { fullName: `Admin of ${slug}` });
  const response = await admin.client.post("/api/v1/organizations", {
    name: `Organization ${slug}`,
    slug,
    type: "COLLEGE",
  });
  if (response.statusCode !== 201) {
    throw new Error(`create organization failed: ${response.statusCode} ${response.body}`);
  }
  return { ...admin, organizationId: response.json().id as string, slug };
}

/**
 * Assert that a database call was rejected by PostgreSQL with a matching message.
 * Drizzle wraps driver errors, so the server's message is on the `cause` chain.
 */
export async function expectDatabaseRejection(
  operation: Promise<unknown>,
  pattern: RegExp,
): Promise<void> {
  let caught: unknown;
  try {
    await operation;
  } catch (error) {
    caught = error;
  }
  if (caught === undefined) throw new Error(`expected rejection matching ${pattern}, but it succeeded`);
  const messages: string[] = [];
  for (let current = caught, depth = 0; current instanceof Error && depth < 5; depth++) {
    messages.push(current.message);
    current = current.cause;
  }
  if (!messages.some((message) => pattern.test(message))) {
    throw new Error(`expected rejection matching ${pattern}, got: ${messages.join(" <- ")}`);
  }
}
