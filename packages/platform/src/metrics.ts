import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "prom-client";

const SECONDS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

/** Every metric the platform exports. One registry per process. */
export function createMetrics(service: string) {
  const registry = new Registry();
  registry.setDefaultLabels({ service });
  collectDefaultMetrics({ register: registry, prefix: "civicpulse_" });
  const histogram = (name: string, help: string, labelNames: string[]) =>
    new Histogram({
      name: `civicpulse_${name}`,
      help,
      labelNames,
      buckets: SECONDS,
      registers: [registry],
    });
  const counter = (name: string, help: string, labelNames: string[]) =>
    new Counter({ name: `civicpulse_${name}`, help, labelNames, registers: [registry] });
  const gauge = (name: string, help: string, labelNames: string[] = []) =>
    new Gauge({ name: `civicpulse_${name}`, help, labelNames, registers: [registry] });

  return {
    registry,
    httpDuration: histogram("http_request_duration_seconds", "HTTP request latency", [
      "method",
      "route",
      "status_code",
    ]),
    httpActive: gauge("http_active_requests", "Requests currently being handled"),
    dbQuery: histogram("db_query_duration_seconds", "PostgreSQL query latency", ["outcome"]),
    eventsHandled: counter("events_handled_total", "Domain events handled by a consumer", [
      "group",
      "type",
      "outcome",
    ]),
    eventsDeadLettered: counter(
      "events_dead_lettered_total",
      "Events moved to the dead-letter table",
      ["group"],
    ),
    outboxPublished: counter("outbox_published_total", "Outbox rows published to the broker", [
      "outcome",
    ]),
    outboxPending: gauge("outbox_pending", "Outbox rows waiting to be published"),
    outboxOldestSeconds: gauge(
      "outbox_oldest_pending_seconds",
      "Age of the oldest unpublished outbox row",
    ),
    jobDuration: histogram("job_duration_seconds", "Background job processing time", [
      "queue",
      "name",
      "outcome",
    ]),
    queueDepth: gauge("queue_jobs", "Jobs in each queue by state", ["queue", "state"]),
    kafkaLag: gauge("kafka_consumer_lag", "Messages a consumer group is behind", [
      "group",
      "topic",
    ]),
    cacheResults: counter("cache_results_total", "Cache lookups", ["result"]),
    searchDuration: histogram("search_request_duration_seconds", "OpenSearch request latency", [
      "operation",
      "outcome",
    ]),
    emailsSent: counter("emails_total", "Emails handed to the mail provider", ["outcome"]),
  };
}

export type Metrics = ReturnType<typeof createMetrics>;
