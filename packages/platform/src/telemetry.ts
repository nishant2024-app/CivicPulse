import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
  type Context,
  type Span,
} from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

export { SpanKind, SpanStatusCode, context, propagation, trace };
export type { Context, Span };

export interface Telemetry {
  enabled: boolean;
  shutdown(): Promise<void>;
}

/**
 * Start exporting traces to an OTLP/HTTP endpoint (OpenTelemetry Collector or Jaeger).
 * Spans are created explicitly by the code that owns each boundary (HTTP, database,
 * outbox, Kafka, jobs, external calls): explicit spans behave identically under ESM,
 * bundlers and tests, and carry only attributes chosen here.
 */
export function startTelemetry(options: {
  serviceName: string;
  version?: string;
  endpoint?: string;
}): Telemetry {
  if (!options.endpoint) return { enabled: false, shutdown: async () => {} };
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      "service.name": options.serviceName,
      "service.version": options.version ?? "0.0.0",
    }),
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({ url: `${options.endpoint.replace(/\/$/, "")}/v1/traces` }),
      ),
    ],
  });
  provider.register(); // global tracer, W3C trace-context propagator, async context manager
  return { enabled: true, shutdown: () => provider.shutdown() };
}

const tracer = () => trace.getTracer("civicpulse");

/** Run `fn` inside a span; records errors and always ends the span. */
export async function withSpan<T>(
  name: string,
  options: {
    kind?: SpanKind;
    attributes?: Record<string, string | number | boolean>;
    parent?: Context;
  },
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const span = tracer().startSpan(
    name,
    { kind: options.kind ?? SpanKind.INTERNAL, attributes: options.attributes },
    options.parent ?? context.active(),
  );
  try {
    return await context.with(trace.setSpan(options.parent ?? context.active(), span), () =>
      fn(span),
    );
  } catch (error) {
    span.recordException(error as Error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
    throw error;
  } finally {
    span.end();
  }
}

/** W3C trace context of the active span, ready to store next to an outbox row or Kafka message. */
export function currentTraceHeaders(): Record<string, string> {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier;
}

/** Continue the trace described by `headers` (traceparent / tracestate). */
export function contextFromHeaders(headers: Record<string, string | undefined>): Context {
  const carrier: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) if (value) carrier[key.toLowerCase()] = value;
  return propagation.extract(context.active(), carrier);
}

export function currentTraceId(): string | undefined {
  const id = trace.getActiveSpan()?.spanContext().traceId;
  return id && id !== "00000000000000000000000000000000" ? id : undefined;
}
