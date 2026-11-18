import { describe } from "vitest";
import type { Logger } from "@civicpulse/platform";
import {
  createOrganizationWithAdmin,
  registerUser,
  type Client,
  type TestContext,
} from "../helpers";

/** These suites need Redis, Kafka, OpenSearch and an S3 store: `docker compose -f docker-compose.deps.yml up -d`. */
export const integration = process.env.INTEGRATION ? describe : describe.skip;

export const URLS = {
  redis: process.env.TEST_REDIS_URL ?? "redis://localhost:6379",
  kafka: process.env.TEST_KAFKA_BROKERS ?? "localhost:9092",
  opensearch: process.env.TEST_OPENSEARCH_URL ?? "http://localhost:9200",
  s3: process.env.TEST_S3_ENDPOINT ?? "http://localhost:8333",
};

export const S3_CREDENTIALS = {
  accessKeyId: "civicpulse-dev-access",
  secretAccessKey: "civicpulse-dev-secret-key-change-me",
};

export const quietLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  trace() {},
  fatal() {},
} as unknown as Logger;

/** Poll until `check` returns a value, or fail with the last error. */
export async function eventually<T>(
  check: () => Promise<T | undefined | false>,
  timeoutMs = 20_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `condition not met within ${timeoutMs} ms${lastError ? `: ${String(lastError)}` : ""}`,
  );
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const api = "/api/v1";

/** An organization with an administrator, a citizen and a category id, ready to file reports. */
export async function setUpOrganization(ctx: TestContext, slug: string) {
  const admin = await createOrganizationWithAdmin(ctx, slug);
  const citizen = await registerUser(ctx, { organizationSlug: slug, fullName: "Priya Citizen" });
  const categories = (await citizen.client.get(`${api}/organizations/current/categories`)).json()
    .data as Array<{
    id: string;
    slug: string;
  }>;
  const category = (name: string) => categories.find((c) => c.slug === name)!.id;
  return { admin, citizen, category };
}

export async function fileComplaint(
  client: Client,
  categoryId: string,
  fields: Record<string, unknown> = {},
) {
  const response = await client.post(`${api}/complaints`, {
    categoryId,
    title: "Deep pothole at the main gate",
    description: "A pothole about half a metre wide has opened right at the main gate.",
    locationText: "Main gate, north side",
    ...fields,
  });
  if (response.statusCode !== 201)
    throw new Error(`report failed: ${response.statusCode} ${response.body}`);
  return response.json() as { id: string; trackingId: string };
}
