import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ALL_HANDLERS, createMemoryBroker, createRelay } from "@civicpulse/events";
import { outboxEvents } from "@civicpulse/db";
import { api, fileComplaint, quietLogger, setUpOrganization } from "./integration/support";
import { createTestContext, resetDatabase, type TestContext } from "./helpers";

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
let ctx: TestContext;

beforeAll(async () => {
  provider.register();
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
  await provider.shutdown();
});
beforeEach(async () => {
  await resetDatabase(ctx.db);
  exporter.reset();
});

const spans = () => exporter.getFinishedSpans();

describe("distributed tracing", () => {
  it("creates one server span per request with the database calls as its children", async () => {
    await ctx.app.inject("/api/v1/organizations/public");
    const server = spans().find((s) => s.name === "GET /api/v1/organizations/public");
    expect(server).toBeDefined();
    expect(server!.attributes["http.response.status_code"]).toBe(200);
    const queries = spans().filter((s) => s.name.startsWith("pg "));
    expect(queries.length).toBeGreaterThan(0);
    for (const query of queries) {
      expect(query.spanContext().traceId).toBe(server!.spanContext().traceId);
      expect(query.parentSpanContext?.spanId).toBeDefined();
    }
  });

  it("continues a trace sent by the caller", async () => {
    const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    await ctx.app.inject({
      method: "GET",
      url: "/api/v1/organizations/public",
      headers: { traceparent: `00-${traceId}-00f067aa0ba902b7-01` },
    });
    const server = spans().find((s) => s.name.startsWith("GET /api/v1/organizations/public"))!;
    expect(server.spanContext().traceId).toBe(traceId);
    expect(server.parentSpanContext?.spanId).toBe("00f067aa0ba902b7");
  });

  it("carries the trace from the request through the outbox into the consumers", async () => {
    const { citizen, category } = await setUpOrganization(ctx, "trace-org");
    exporter.reset();
    await fileComplaint(citizen.client, category("roads"));
    const request = spans().find((s) => s.name === "POST /api/v1/complaints")!;
    expect(request).toBeDefined();

    // The event row remembers which trace caused it.
    const [row] = await ctx.db.withSystem((tx) => tx.select().from(outboxEvents));
    expect(row!.headers.traceparent).toContain(request.spanContext().traceId);

    const relay = createRelay(
      ctx.db,
      createMemoryBroker({ ...ctx.app.eventDeps, logger: quietLogger }, ALL_HANDLERS),
      quietLogger,
    );
    await relay.drain();
    const names = spans()
      .filter((s) => s.spanContext().traceId === request.spanContext().traceId)
      .map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "POST /api/v1/complaints",
        "outbox.publish",
        "consume notification",
        "consume analytics-cache",
      ]),
    );
    void api;
  });
});
