import fp from "fastify-plugin";
import {
  context,
  contextFromHeaders,
  SpanKind,
  SpanStatusCode,
  trace,
  type Span,
} from "@civicpulse/platform";

declare module "fastify" {
  interface FastifyRequest {
    otelSpan?: Span;
    startedAt?: bigint;
  }
}

const QUIET = /^\/(healthz|readyz|metrics)(\?|$)/;
// Looked up per request, never at import time: a tracer created before the SDK is started
// silently produces non-recording spans.
const getTracer = () => trace.getTracer("civicpulse-api");

/** HTTP metrics, one trace per request (continuing the caller's trace), and the /metrics endpoint. */
export const observabilityPlugin = fp(async (app) => {
  const { metrics } = app;

  app.addHook("onRequest", (request, _reply, done) => {
    if (QUIET.test(request.url)) return done();
    metrics.httpActive.inc();
    request.startedAt = process.hrtime.bigint();
    const parent = contextFromHeaders(request.headers as Record<string, string | undefined>);
    const span = getTracer().startSpan(
      request.method,
      {
        kind: SpanKind.SERVER,
        attributes: {
          "http.request.method": request.method,
          "url.path": request.url.split("?")[0] ?? "",
          "request.id": request.id,
        },
      },
      parent,
    );
    request.otelSpan = span;
    // Everything after this hook — handlers, database calls, queued work — runs in this trace.
    context.with(trace.setSpan(parent, span), done);
  });

  app.addHook("onError", async (request, _reply, error) => {
    request.otelSpan?.recordException(error);
  });

  app.addHook("onResponse", async (request, reply) => {
    const span = request.otelSpan;
    if (!span || request.startedAt === undefined) return;
    const route = request.routeOptions?.url ?? "unmatched";
    const seconds = Number(process.hrtime.bigint() - request.startedAt) / 1e9;
    metrics.httpActive.dec();
    metrics.httpDuration.observe(
      { method: request.method, route, status_code: String(reply.statusCode) },
      seconds,
    );
    span.updateName(`${request.method} ${route}`);
    span.setAttributes({ "http.route": route, "http.response.status_code": reply.statusCode });
    if (reply.statusCode >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();
  });

  app.get(
    "/metrics",
    { config: { rateLimit: false }, schema: { hide: true } },
    async (_request, reply) => {
      return reply
        .header("content-type", metrics.registry.contentType)
        .send(await metrics.registry.metrics());
    },
  );
});
