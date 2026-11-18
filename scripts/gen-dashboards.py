#!/usr/bin/env python3
"""Generate the Grafana dashboards. The JSON is committed; edit this file and re-run to change it.

    python3 scripts/gen-dashboards.py
"""
import json
import pathlib

OUT = pathlib.Path(__file__).resolve().parent.parent / "infrastructure/helm/civicpulse-platform/files/grafana/dashboards"
DS = {"type": "prometheus", "uid": "prometheus"}
H = "civicpulse_http_request_duration_seconds"
JOB = 'civicpulse_job_duration_seconds'


def target(expr, legend, ref):
    return {"datasource": DS, "expr": expr, "legendFormat": legend, "refId": ref}


def panel(pid, title, queries, x, y, w=12, h=8, unit="short", kind="timeseries", desc="", thresholds=None, stack=False):
    p = {
        "id": pid,
        "type": kind,
        "title": title,
        "description": desc,
        "datasource": DS,
        "gridPos": {"x": x, "y": y, "w": w, "h": h},
        "targets": [target(e, l, chr(65 + i)) for i, (e, l) in enumerate(queries)],
        "fieldConfig": {"defaults": {"unit": unit, "color": {"mode": "palette-classic"}}, "overrides": []},
        "options": {},
    }
    if kind == "timeseries":
        p["fieldConfig"]["defaults"]["custom"] = {"lineWidth": 2, "fillOpacity": 12, "showPoints": "never", "stacking": {"mode": "normal" if stack else "none"}}
        p["options"] = {"legend": {"displayMode": "list", "placement": "bottom"}, "tooltip": {"mode": "multi"}}
    if kind == "stat":
        p["options"] = {"colorMode": "background", "graphMode": "none", "reduceOptions": {"calcs": ["lastNotNull"]}}
        steps = thresholds or [{"color": "green", "value": None}]
        p["fieldConfig"]["defaults"]["color"] = {"mode": "thresholds"}
        p["fieldConfig"]["defaults"]["thresholds"] = {"mode": "absolute", "steps": steps}
    return p


def dashboard(uid, title, panels, desc):
    return {
        "uid": uid,
        "title": title,
        "description": desc,
        "tags": ["civicpulse"],
        "timezone": "browser",
        "schemaVersion": 39,
        "version": 1,
        "refresh": "10s",
        "time": {"from": "now-30m", "to": "now"},
        "templating": {"list": []},
        "annotations": {"list": []},
        "panels": panels,
    }


def q(metric, svc='service="api"', rng="5m", pct=0.95, extra=""):
    return f'histogram_quantile({pct}, sum by (le) (rate({metric}_bucket{{{svc}{extra}}}[{rng}])))'


dashboards = {}

dashboards["api-performance"] = dashboard(
    "cp-api", "API performance", [
        panel(1, "Requests per second", [(f'sum(rate({H}_count{{service="api"}}[1m]))', "requests/s")], 0, 0, 8, 7, "reqps", "stat"),
        panel(2, "p95 latency", [(q(H), "p95")], 8, 0, 8, 7, "s", "stat", thresholds=[{"color": "green", "value": None}, {"color": "orange", "value": 0.5}, {"color": "red", "value": 1}]),
        panel(3, "In-flight requests", [('sum(civicpulse_http_active_requests{service="api"})', "active")], 16, 0, 8, 7, "short", "stat"),
        panel(4, "Request rate by route", [(f'sum by (route) (rate({H}_count{{service="api"}}[1m]))', "{{route}}")], 0, 7, 12, 9, "reqps", stack=True),
        panel(5, "Latency percentiles", [(q(H, pct=0.5), "p50"), (q(H, pct=0.95), "p95"), (q(H, pct=0.99), "p99")], 12, 7, 12, 9, "s"),
        panel(6, "p95 latency by route", [(f'histogram_quantile(0.95, sum by (le, route) (rate({H}_bucket{{service="api"}}[5m])))', "{{route}}")], 0, 16, 12, 9, "s"),
        panel(7, "Responses by status code", [(f'sum by (status_code) (rate({H}_count{{service="api"}}[1m]))', "{{status_code}}")], 12, 16, 12, 9, "reqps", stack=True),
        panel(8, "Cache hit ratio", [('sum(rate(civicpulse_cache_results_total{result="hit"}[5m])) / clamp_min(sum(rate(civicpulse_cache_results_total{result=~"hit|miss"}[5m])), 1e-9)', "hit ratio")], 0, 25, 12, 8, "percentunit"),
        panel(9, "Search latency p95 (OpenSearch)", [('histogram_quantile(0.95, sum by (le, operation) (rate(civicpulse_search_request_duration_seconds_bucket[5m])))', "{{operation}}")], 12, 25, 12, 8, "s"),
    ], "Throughput, latency and cache effectiveness of the HTTP API.")

dashboards["application-health"] = dashboard(
    "cp-health", "Application health", [
        panel(1, "Services up", [('count(up{job=~"civicpulse.*|kubernetes-pods"} == 1)', "up")], 0, 0, 6, 6, "short", "stat", thresholds=[{"color": "red", "value": None}, {"color": "green", "value": 2}]),
        panel(2, "Memory (RSS)", [('sum by (service) (civicpulse_process_resident_memory_bytes)', "{{service}}")], 6, 0, 9, 8, "bytes"),
        panel(3, "CPU", [('sum by (service) (rate(civicpulse_process_cpu_seconds_total[1m]))', "{{service}}")], 15, 0, 9, 8, "percentunit"),
        panel(4, "Event loop lag p99", [('max by (service) (civicpulse_nodejs_eventloop_lag_p99_seconds)', "{{service}}")], 0, 8, 12, 8, "s"),
        panel(5, "Heap used", [('sum by (service) (civicpulse_nodejs_heap_size_used_bytes)', "{{service}}")], 12, 8, 12, 8, "bytes"),
        panel(6, "Garbage collection time", [('sum by (service) (rate(civicpulse_nodejs_gc_duration_seconds_sum[1m]))', "{{service}}")], 0, 16, 12, 8, "s"),
        panel(7, "Open file handles", [('civicpulse_process_open_fds', "{{service}}")], 12, 16, 12, 8, "short"),
    ], "Process-level health of the API and the workers.")

dashboards["database"] = dashboard(
    "cp-db", "Database performance", [
        panel(1, "Queries per second", [('sum by (service) (rate(civicpulse_db_query_duration_seconds_count[1m]))', "{{service}}")], 0, 0, 12, 8, "ops", stack=True),
        panel(2, "Query latency p95", [(q("civicpulse_db_query_duration_seconds", svc='service=~".+"', extra=""), "p95 (all)")] + [(f'histogram_quantile(0.95, sum by (le, service) (rate(civicpulse_db_query_duration_seconds_bucket[5m])))', "{{service}}")], 12, 0, 12, 8, "s"),
        panel(3, "Failed queries", [('sum by (service) (rate(civicpulse_db_query_duration_seconds_count{outcome="error"}[1m]))', "{{service}}")], 0, 8, 12, 8, "ops"),
        panel(4, "Share of queries slower than 250 ms", [('1 - sum(rate(civicpulse_db_query_duration_seconds_bucket{le="0.25"}[5m])) / clamp_min(sum(rate(civicpulse_db_query_duration_seconds_count[5m])), 1e-9)', "slow share")], 12, 8, 12, 8, "percentunit"),
        panel(5, "Latency heat (all queries)", [('sum by (le) (increase(civicpulse_db_query_duration_seconds_bucket[1m]))', "{{le}}")], 0, 16, 24, 9, "short"),
    ], "PostgreSQL query rate, latency and errors as seen by the application.")

dashboards["background-processing"] = dashboard(
    "cp-jobs", "Background processing", [
        panel(1, "Jobs waiting", [('sum(civicpulse_queue_jobs{state="waiting"})', "waiting")], 0, 0, 6, 6, "short", "stat", thresholds=[{"color": "green", "value": None}, {"color": "orange", "value": 50}, {"color": "red", "value": 500}]),
        panel(2, "Failed jobs (stored)", [('sum(civicpulse_queue_jobs{state="failed"})', "failed")], 6, 0, 6, 6, "short", "stat", thresholds=[{"color": "green", "value": None}, {"color": "red", "value": 1}]),
        panel(3, "Emails sent / failed", [('sum by (outcome) (increase(civicpulse_emails_total[1h]))', "{{outcome}}")], 12, 0, 12, 6, "short", "stat"),
        panel(4, "Queue depth by state", [('sum by (queue, state) (civicpulse_queue_jobs)', "{{queue}} {{state}}")], 0, 6, 12, 9, "short"),
        panel(5, "Jobs processed per minute", [(f'sum by (queue, outcome) (rate({JOB}_count[1m])) * 60', "{{queue}} {{outcome}}")], 12, 6, 12, 9, "short", stack=True),
        panel(6, "Job duration p95", [(f'histogram_quantile(0.95, sum by (le, queue) (rate({JOB}_bucket[5m])))', "{{queue}}")], 0, 15, 12, 9, "s"),
        panel(7, "Email outcomes over time", [('sum by (outcome) (rate(civicpulse_emails_total[5m]))', "{{outcome}}")], 12, 15, 12, 9, "ops"),
    ], "BullMQ queues, worker throughput and email delivery.")

dashboards["event-streaming"] = dashboard(
    "cp-events", "Event streaming", [
        panel(1, "Outbox backlog", [('max(civicpulse_outbox_pending)', "pending")], 0, 0, 6, 6, "short", "stat", thresholds=[{"color": "green", "value": None}, {"color": "orange", "value": 20}, {"color": "red", "value": 200}]),
        panel(2, "Oldest unpublished event", [('max(civicpulse_outbox_oldest_pending_seconds)', "age")], 6, 0, 6, 6, "s", "stat", thresholds=[{"color": "green", "value": None}, {"color": "orange", "value": 10}, {"color": "red", "value": 60}]),
        panel(3, "Kafka consumer lag", [('sum(civicpulse_kafka_consumer_lag)', "lag")], 12, 0, 6, 6, "short", "stat", thresholds=[{"color": "green", "value": None}, {"color": "orange", "value": 20}, {"color": "red", "value": 500}]),
        panel(4, "Dead-lettered events", [('sum(civicpulse_events_dead_lettered_total) or vector(0)', "dead letters")], 18, 0, 6, 6, "short", "stat", thresholds=[{"color": "green", "value": None}, {"color": "red", "value": 1}]),
        panel(5, "Outbox published per second", [('sum by (outcome) (rate(civicpulse_outbox_published_total[1m]))', "{{outcome}}")], 0, 6, 12, 8, "ops", stack=True),
        panel(6, "Events handled per second", [('sum by (group, outcome) (rate(civicpulse_events_handled_total[1m]))', "{{group}} {{outcome}}")], 12, 6, 12, 8, "ops", stack=True),
        panel(7, "Kafka lag by consumer group", [('sum by (group) (civicpulse_kafka_consumer_lag)', "{{group}}")], 0, 14, 12, 8, "short"),
        panel(8, "Handled events by type", [('sum by (type) (rate(civicpulse_events_handled_total{outcome="processed"}[5m]))', "{{type}}")], 12, 14, 12, 8, "ops"),
    ], "Transactional outbox, Kafka consumer groups and dead letters.")

dashboards["errors"] = dashboard(
    "cp-errors", "Error monitoring", [
        panel(1, "5xx ratio", [(f'(sum(rate({H}_count{{service="api",status_code=~"5.."}}[5m])) / clamp_min(sum(rate({H}_count{{service="api"}}[5m])), 1e-9)) or vector(0)', "5xx")], 0, 0, 8, 7, "percentunit", "stat", thresholds=[{"color": "green", "value": None}, {"color": "orange", "value": 0.01}, {"color": "red", "value": 0.05}]),
        panel(2, "Server errors per second", [(f'sum(rate({H}_count{{service="api",status_code=~"5.."}}[1m])) or vector(0)', "5xx/s")], 8, 0, 8, 7, "reqps", "stat"),
        panel(3, "Client errors per second", [(f'sum by (status_code) (rate({H}_count{{service="api",status_code=~"4.."}}[1m]))', "{{status_code}}")], 16, 0, 8, 7, "reqps"),
        panel(4, "Errors by route", [(f'sum by (route, status_code) (rate({H}_count{{service="api",status_code=~"5.."}}[5m]))', "{{route}} {{status_code}}")], 0, 7, 12, 9, "reqps"),
        panel(5, "Failed jobs and dead letters", [('sum by (queue) (rate(civicpulse_job_duration_seconds_count{outcome="failed"}[5m]))', "job failures {{queue}}"), ('sum(rate(civicpulse_events_dead_lettered_total[5m]))', "dead letters")], 12, 7, 12, 9, "ops"),
        panel(6, "Dependency errors", [('sum by (service) (rate(civicpulse_db_query_duration_seconds_count{outcome="error"}[5m]))', "postgres {{service}}"), ('sum(rate(civicpulse_search_request_duration_seconds_count{outcome="error"}[5m]))', "opensearch"), ('sum(rate(civicpulse_cache_results_total{result="error"}[5m]))', "redis cache"), ('sum(rate(civicpulse_emails_total{outcome="failed"}[5m]))', "email")], 0, 16, 24, 9, "ops"),
    ], "Where requests, jobs and dependencies are failing.")

OUT.mkdir(parents=True, exist_ok=True)
for name, body in dashboards.items():
    (OUT / f"{name}.json").write_text(json.dumps(body, indent=2) + "\n")
print(f"wrote {len(dashboards)} dashboards to {OUT}")
