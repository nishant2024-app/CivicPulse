#!/usr/bin/env python3
"""Run every Grafana panel query against Prometheus and report the ones that fail to parse.

    python3 scripts/check-dashboards.py [prometheus-base-url]

A query that returns no series is reported but is not an error (a dashboard for failures is
empty while nothing fails). A query Prometheus rejects is an error and exits non-zero.
"""
import glob
import json
import pathlib
import sys
import urllib.parse
import urllib.request

base = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:9090").rstrip("/")
root = pathlib.Path(__file__).resolve().parent.parent / "infrastructure/helm/civicpulse-platform/files/grafana/dashboards"
bad = empty = ok = 0
for path in sorted(glob.glob(str(root / "*.json"))):
    dashboard = json.load(open(path))
    for panel in dashboard["panels"]:
        for target in panel["targets"]:
            url = f"{base}/api/v1/query?" + urllib.parse.urlencode({"query": target["expr"]})
            try:
                body = json.load(urllib.request.urlopen(url, timeout=20))
            except urllib.error.HTTPError as error:
                body = json.loads(error.read())
            label = f"{dashboard['title']} / {panel['title']}"
            if body.get("status") != "success":
                bad += 1
                print(f"ERROR  {label}: {body.get('error')}\n       {target['expr']}")
            elif not body["data"]["result"]:
                empty += 1
                print(f"empty  {label}")
            else:
                ok += 1
print(f"\n{ok} queries returned data, {empty} returned nothing, {bad} failed to parse")
sys.exit(1 if bad else 0)
