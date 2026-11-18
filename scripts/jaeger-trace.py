#!/usr/bin/env python3
"""Find a distributed trace in Jaeger (v2 API) that crosses the API and the workers.

    python3 scripts/jaeger-trace.py [jaeger-base-url] [--require-services api,workers]

Prints the spans of the richest trace and exits non-zero when none spans both services.
Used by the verification workflow; also handy for looking at a trace from the terminal.
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone

base = next((a for a in sys.argv[1:] if a.startswith("http")), "http://localhost:16686").rstrip("/")
now = datetime.now(timezone.utc)
query = urllib.parse.urlencode(
    {
        "query.service_name": "civicpulse-api",
        "query.start_time_min": (now - timedelta(hours=1)).isoformat().replace("+00:00", "Z"),
        "query.start_time_max": (now + timedelta(minutes=5)).isoformat().replace("+00:00", "Z"),
        "query.search_depth": "100",
    }
)
raw = urllib.request.urlopen(f"{base}/api/v3/traces?{query}", timeout=30).read().decode()

# The v3 API streams one JSON object per line.
spans_by_trace = defaultdict(list)
for line in raw.splitlines():
    if not line.strip():
        continue
    payload = json.loads(line).get("result", {})
    for resource in payload.get("resourceSpans", []):
        service = next(
            (a["value"].get("stringValue") for a in resource["resource"].get("attributes", []) if a["key"] == "service.name"),
            "?",
        )
        for scope in resource.get("scopeSpans", []):
            for span in scope.get("spans", []):
                spans_by_trace[span["traceId"]].append((service, span))

best = None
for trace_id, spans in spans_by_trace.items():
    services = {s for s, _ in spans}
    names = {sp["name"] for _, sp in spans}
    if {"civicpulse-api", "civicpulse-workers"} <= services and any(n.startswith("consume ") for n in names):
        if best is None or len(spans) > len(spans_by_trace[best]):
            best = trace_id

print(f"{len(spans_by_trace)} traces in the last hour")
if not best:
    print("no trace spans both civicpulse-api and civicpulse-workers")
    sys.exit(1)

spans = sorted(spans_by_trace[best], key=lambda item: int(item[1]["startTimeUnixNano"]))
print(f"trace {best}: {len(spans)} spans across {sorted({s for s, _ in spans})}")
for service, span in spans:
    ms = (int(span["endTimeUnixNano"]) - int(span["startTimeUnixNano"])) / 1e6
    print(f"  {service:18} {span['name'][:62]:62} {ms:8.1f} ms")
