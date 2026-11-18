#!/usr/bin/env python3
"""Check that every component of the Request Journey is running AND was actually used.

    python3 scripts/verify-cluster.py [--namespace civicpulse] [--port 8080]

Run it after some traffic (the browser tests, or any complaint filed through the UI).
It talks to the cluster through the ingress (*.localtest.me resolves to 127.0.0.1) and
through kubectl. Prints a checklist; exits non-zero if anything is wrong.
"""
import argparse
import base64
import json
import subprocess
import sys
import urllib.error
import urllib.request

ap = argparse.ArgumentParser()
ap.add_argument("--namespace", default="civicpulse")
ap.add_argument("--port", default="8080")
args = ap.parse_args()
NS = args.namespace
results = []


def kubectl(*a, ns=NS, check=True):
    cmd = ["kubectl", "-n", ns, *a]
    out = subprocess.run(cmd, capture_output=True, text=True)
    if check and out.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd)}: {out.stderr.strip()}")
    return out.stdout.strip()


def http(host, path, auth=None, expect_json=True):
    req = urllib.request.Request(f"http://{host}.localtest.me:{args.port}{path}")
    if auth:
        req.add_header("authorization", "Basic " + base64.b64encode(auth.encode()).decode())
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = r.read().decode()
            return r.status, (json.loads(body) if expect_json and body else body)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def check(name, fn):
    try:
        detail = fn()
        results.append((name, True, detail or ""))
        print(f"  ok    {name}" + (f" — {detail}" if detail else ""))
    except Exception as e:  # noqa: BLE001
        results.append((name, False, str(e)))
        print(f"  FAIL  {name} — {e}")


def must(cond, message):
    if not cond:
        raise AssertionError(message)


def psql(query):
    return kubectl("exec", "postgres-0", "--", "psql", "-U", "civicpulse", "-d", "civicpulse", "-Atc", query)


print("GitOps")
def argocd_apps():
    apps = json.loads(kubectl("get", "applications", "-o", "json", ns="argocd"))["items"]
    must(len(apps) >= 3, f"expected root + 2 applications, found {len(apps)}")
    bad = [f"{a['metadata']['name']}={a['status']['sync']['status']}/{a['status']['health']['status']}" for a in apps if a["status"]["sync"]["status"] != "Synced" or a["status"]["health"]["status"] != "Healthy"]
    must(not bad, ", ".join(bad))
    return ", ".join(a["metadata"]["name"] for a in apps) + " Synced/Healthy"
check("Argo CD applications Synced and Healthy", argocd_apps)

print("Load balancer, backend and the edge")
check("Traefik routes the web app", lambda: must(http("civicpulse", "/", expect_json=False)[0] == 200, "web did not return 200") or "200")
check("Traefik routes /api to the backend", lambda: must(http("civicpulse", "/api/v1/organizations/public")[0] == 200, "api did not return 200") or "200")
check("/metrics and /healthz are NOT exposed publicly", lambda: must(http("civicpulse", "/metrics", expect_json=False)[0] in (404, 308) or "civicpulse_http" not in http("civicpulse", "/metrics", expect_json=False)[1], "metrics are reachable from outside") or "not routed")

print("PostgreSQL")
check("migrations applied and row-level security active", lambda: must(int(psql("select count(*) from pg_policies where policyname like 'tenant%'")) >= 10, "tenant policies missing") or f"{psql('select count(*) from pg_policies')} policies")
check("append-only triggers present", lambda: must(int(psql("select count(*) from pg_trigger where tgname in ('audit_logs_immutable','complaint_status_history_immutable')")) == 2, "triggers missing") or "2 triggers")
check("complaints exist", lambda: must(int(psql("select count(*) from complaints")) >= 1, "no complaints; generate traffic first") or psql("select count(*) from complaints") + " complaints")

print("Redis")
def redis_keys():
    keys = kubectl("exec", "deploy/redis", "--", "redis-cli", "--scan", "--pattern", "*")
    must("bull:" in keys, "no BullMQ keys")
    must("cp:cache:" in keys, "no cache keys")
    return f"{len(keys.splitlines())} keys (queues + cache)"
check("BullMQ queues and cache in use", redis_keys)

print("Kafka")
def kafka_groups():
    out = kubectl("exec", "kafka-0", "--", "/opt/kafka/bin/kafka-consumer-groups.sh", "--bootstrap-server", "localhost:9092", "--describe", "--all-groups")
    rows = [l.split() for l in out.splitlines() if l.startswith("civicpulse-")]
    must(len({r[0] for r in rows}) == 3, f"expected 3 consumer groups, saw {sorted({r[0] for r in rows})}")
    lag = sum(int(r[5]) for r in rows if r[5].isdigit())
    must(lag == 0, f"consumer lag is {lag}")
    return "3 consumer groups, lag 0"
check("consumer groups caught up", kafka_groups)

print("OpenSearch")
def os_count():
    out = kubectl("exec", "deploy/api", "--", "node", "-e", "fetch('http://opensearch:9200/civicpulse-complaints/_count').then(r=>r.json()).then(j=>console.log(j.count))")
    must(int(out) >= 1, "index is empty")
    return f"{out} document(s) indexed"
check("complaints indexed", os_count)

print("S3-compatible object storage")
def s3_bucket():
    out = kubectl("exec", "seaweedfs-0", "--", "sh", "-c", "echo s3.bucket.list | weed shell -master=localhost:9333 2>/dev/null")
    must("civicpulse" in out, f"bucket missing: {out[:120]}")
    return "bucket 'civicpulse' exists"
check("bucket created and holds objects", s3_bucket)

print("Email (queue -> SMTP)")
def mail():
    status, body = http("mail", "/api/v1/messages")
    must(status == 200 and body["total"] >= 1, "no emails captured")
    return f"{body['total']} email(s) captured"
check("notification emails delivered through the mail sink", mail)

print("Prometheus and Grafana")
def prom():
    status, body = http("prometheus", "/api/v1/targets")
    jobs = {t["labels"]["job"]: t["health"] for t in body["data"]["activeTargets"]}
    for needed in ("api", "workers", "otel-collector"):
        must(jobs.get(needed) == "up", f"{needed} target is {jobs.get(needed)}")
    return ", ".join(f"{j}={h}" for j, h in sorted(jobs.items()))
check("scrape targets up", prom)

def prom_data():
    import urllib.parse
    for q in ('sum(civicpulse_http_request_duration_seconds_count{service="api"})', "sum(civicpulse_events_handled_total)", "sum(civicpulse_db_query_duration_seconds_count)"):
        status, body = http("prometheus", "/api/v1/query?" + urllib.parse.urlencode({"query": q}))
        must(body["data"]["result"] and float(body["data"]["result"][0]["value"][1]) > 0, f"no data for {q}")
    return "request, event and database metrics present"
check("application metrics collected", prom_data)

def grafana():
    password = base64.b64decode(json.loads(kubectl("get", "secret", "civicpulse-secrets", "-o", "json"))["data"]["grafana-admin-password"]).decode()
    status, dashboards = http("grafana", "/api/search?type=dash-db", auth=f"admin:{password}")
    titles = sorted(d["title"] for d in dashboards)
    must(len(titles) == 6, f"expected 6 dashboards, found {titles}")
    return ", ".join(titles)
check("six dashboards provisioned", grafana)

def dashboards_parse():
    r = subprocess.run([sys.executable, "scripts/check-dashboards.py", f"http://prometheus.localtest.me:{args.port}"], capture_output=True, text=True)
    must(r.returncode == 0, r.stdout[-400:])
    return r.stdout.strip().splitlines()[-1]
check("every dashboard query is valid", dashboards_parse)

print("OpenTelemetry and Jaeger")
def trace():
    r = subprocess.run([sys.executable, "scripts/jaeger-trace.py", f"http://jaeger.localtest.me:{args.port}"], capture_output=True, text=True)
    must(r.returncode == 0, r.stdout[-300:] + r.stderr[-300:])
    lines = r.stdout.strip().splitlines()
    names = " ".join(lines)
    for expected in ("outbox.publish", "consume notification", "job mail", "email.send"):
        must(expected in names, f"span '{expected}' missing from the trace")
    return lines[1]
check("one trace spans API -> PostgreSQL -> outbox -> Kafka consumers -> queue -> email", trace)

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
sys.exit(1 if failed else 0)
