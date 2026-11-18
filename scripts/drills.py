#!/usr/bin/env python3
"""Failure drills: break one dependency at a time and check the system degrades, then recovers.

    python3 scripts/drills.py docker --api http://localhost:4000
    python3 scripts/drills.py kube   --api http://civicpulse.localtest.me:8080 --namespace civicpulse

Each drill states what it expects. Exit code is non-zero if any drill fails.
"""
import argparse
import http.cookiejar
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

parser = argparse.ArgumentParser()
parser.add_argument("mode", choices=["docker", "kube"])
parser.add_argument("--api", default="http://localhost:4000")
parser.add_argument("--host", default="", help="Host header (ingress routing)")
parser.add_argument("--namespace", default="civicpulse")
parser.add_argument("--only", default="")
args = parser.parse_args()


# ---------- controlling the environment ----------
def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


class Docker:
    project = "civicpulse"

    def stop(self, svc):
        run(["docker", "compose", "-f", "docker-compose.stack.yml", "stop", svc])

    def start(self, svc):
        run(["docker", "compose", "-f", "docker-compose.stack.yml", "start", svc])

    def sql(self, query):
        out = run(["docker", "exec", "civicpulse-postgres-1", "psql", "-U", "civicpulse", "-d", "civicpulse", "-Atc", query])
        return out.stdout.strip()

    def exec_workers(self, *cmd):
        return run(["docker", "exec", "civicpulse-workers-1", *cmd])


class Kube:
    def stop(self, svc):
        kind = "statefulset" if svc in ("kafka", "opensearch", "postgres", "seaweedfs") else "deployment"
        run(["kubectl", "-n", args.namespace, "scale", kind, svc, "--replicas=0"])
        run(["kubectl", "-n", args.namespace, "wait", "--for=delete", "pod", "-l", f"app.kubernetes.io/name={svc}", "--timeout=120s"])

    def start(self, svc):
        kind = "statefulset" if svc in ("kafka", "opensearch", "postgres", "seaweedfs") else "deployment"
        run(["kubectl", "-n", args.namespace, "scale", kind, svc, "--replicas=1"])
        run(["kubectl", "-n", args.namespace, "rollout", "status", f"{kind}/{svc}", "--timeout=300s"])

    def sql(self, query):
        out = run(["kubectl", "-n", args.namespace, "exec", "postgres-0", "--", "psql", "-U", "civicpulse", "-d", "civicpulse", "-Atc", query])
        return out.stdout.strip()

    def exec_workers(self, *cmd):
        return run(["kubectl", "-n", args.namespace, "exec", "deploy/workers", "--", *cmd])


env = Docker() if args.mode == "docker" else Kube()


# ---------- talking to the API ----------
class Client:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def call(self, method, path, body=None, retries=0):
        data = json.dumps(body).encode() if body is not None else None
        headers = {"content-type": "application/json", "x-requested-with": "civicpulse"}
        if args.host:
            headers["host"] = args.host
        req = urllib.request.Request(args.api + path, data=data, method=method, headers=headers)
        try:
            with self.opener.open(req, timeout=20) as r:
                text = r.read().decode()
                return r.status, (json.loads(text) if text else None)
        except urllib.error.HTTPError as e:
            text = e.read().decode()
            try:
                return e.code, json.loads(text)
            except ValueError:
                return e.code, text
        except Exception as e:  # connection errors
            return 0, str(e)


PASSWORD = "correct-horse-battery"
suffix = uuid.uuid4().hex[:8]
admin, citizen = Client(), Client()
state = {}


def setup():
    slug = f"drill-{suffix}"
    s, _ = admin.call("POST", "/api/v1/auth/register", {"email": f"admin-{suffix}@example.test", "password": PASSWORD, "fullName": "Drill Admin"})
    assert s == 201, f"register admin: {s}"
    s, org = admin.call("POST", "/api/v1/organizations", {"name": f"Drill Org {suffix}", "slug": slug, "type": "COLLEGE"})
    assert s == 201, f"create org: {s} {org}"
    s, _ = citizen.call("POST", "/api/v1/auth/register", {"email": f"citizen-{suffix}@example.test", "password": PASSWORD, "fullName": "Drill Citizen", "organizationSlug": slug})
    assert s == 201, f"register citizen: {s}"
    s, cats = citizen.call("GET", "/api/v1/organizations/current/categories")
    state["category"] = cats["data"][0]["id"]
    state["admin_id"] = admin.call("GET", "/api/v1/auth/me")[1]["user"]["id"]


def report(title):
    s, body = citizen.call("POST", "/api/v1/complaints", {"categoryId": state["category"], "title": title, "description": "Created by a failure drill to check recovery.", "locationText": "Drill location"})
    return s, body


def wait(check, timeout=120, interval=2):
    end = time.time() + timeout
    while time.time() < end:
        try:
            if check():
                return True
        except Exception:
            pass
        time.sleep(interval)
    return False


def pending():
    return int(env.sql("select count(*) from outbox_events where published_at is null") or 0)


def admin_notifications(title_part):
    return int(env.sql(f"select count(*) from notifications where user_id = '{state['admin_id']}' and body like '%{title_part}%'") or 0)


def search_finds(word):
    s, body = admin.call("GET", f"/api/v1/search/complaints?q={word}")
    return s, body


results = []


def drill(name):
    def deco(fn):
        def run_it():
            if args.only and args.only not in name:
                return
            started = time.time()
            print(f"\n▶ {name}")
            try:
                fn()
                results.append((name, True, time.time() - started))
                print(f"  PASS ({time.time() - started:.0f}s)")
            except AssertionError as e:
                results.append((name, False, time.time() - started))
                print(f"  FAIL: {e}")
            finally:
                for svc in ("workers", "redis", "opensearch", "kafka", "mailpit"):
                    pass
        return run_it
    return deco


@drill("workers down: reports still saved; events wait in the outbox, then drain")
def workers_down():
    token = f"workersdown{suffix}"
    env.stop("workers")
    try:
        s, body = report(f"Report during workers outage {token}")
        assert s == 201, f"API must keep accepting reports, got {s}"
        assert pending() >= 1, "the event should be waiting in the outbox"
        assert admin_notifications(token) == 0, "nobody can be notified while workers are down"
    finally:
        env.start("workers")
    assert wait(lambda: pending() == 0, 120), "the outbox should drain after workers return"
    assert wait(lambda: admin_notifications(token) == 1, 60), "the administrator should be notified exactly once"


@drill("redis down: API keeps serving (cache and rate limit fail open)")
def redis_down():
    env.stop("redis")
    try:
        s, _ = citizen.call("GET", "/api/v1/auth/me")
        assert s == 200, f"authenticated request failed: {s}"
        s, body = admin.call("GET", "/api/v1/analytics/overview")
        assert s == 200, f"analytics (cache miss path) failed: {s}"
        s, body = report(f"Report during redis outage {suffix}")
        assert s == 201, f"report failed: {s}"
        s, _ = Client().call("POST", "/api/v1/auth/login", {"email": f"citizen-{suffix}@example.test", "password": PASSWORD})
        assert s == 200, f"login failed: {s}"
    finally:
        env.start("redis")
    assert wait(lambda: pending() == 0, 90), "events should still flow after redis returns"


@drill("opensearch down: search falls back to PostgreSQL, indexing is repaired by redrive")
def opensearch_down():
    token = f"searchdown{suffix}"
    env.stop("opensearch")
    try:
        s, body = report(f"Report during search outage {token}")
        assert s == 201
        s, body = search_finds(token)
        assert s == 200 and body["meta"]["degraded"] is True, f"expected a degraded 200, got {s} {body if s != 200 else body['meta']}"
        assert body["pagination"]["total"] >= 0
    finally:
        env.start("opensearch")
    # Indexing attempts for the outage-time event were dead-lettered after their retries.
    assert wait(lambda: int(env.sql("select count(*) from dead_letter_events where consumer_group='search-index' and resolved_at is null") or 0) >= 1, 60), "a search-index dead letter should exist"
    assert wait(lambda: search_finds("test")[0] == 200 and search_finds("test")[1]["meta"]["degraded"] is False, 120), "OpenSearch should answer again"
    r = env.exec_workers("node", "dist/redrive.js", "search-index")
    assert r.returncode == 0, f"redrive failed: {r.stdout} {r.stderr}"

    def indexed():
        time.sleep(1.5)
        s, b = search_finds(token)
        return s == 200 and b["meta"]["engine"] == "opensearch" and b["pagination"]["total"] >= 1

    assert wait(indexed, 60), "the report should be searchable in OpenSearch after redrive"


@drill("kafka down: reports still saved; the outbox holds events until Kafka returns")
def kafka_down():
    token = f"kafkadown{suffix}"
    env.stop("kafka")
    try:
        s, _ = report(f"Report during kafka outage {token}")
        assert s == 201, f"API must keep accepting reports, got {s}"
        time.sleep(4)
        assert pending() >= 1, "events should be waiting in the outbox"
    finally:
        env.start("kafka")
    assert wait(lambda: pending() == 0, 180), "the outbox should drain after Kafka returns"
    assert wait(lambda: admin_notifications(token) == 1, 90), "the administrator should be notified exactly once"


@drill("mail provider down: notification emails are retried and delivered after recovery")
def mail_down():
    token = f"maildown{suffix}"
    env.stop("mailpit")
    try:
        s, _ = report(f"Report during mail outage {token}")
        assert s == 201
        assert wait(lambda: admin_notifications(token) == 1, 60), "the in-app notification must not depend on email"
        time.sleep(3)
    finally:
        env.start("mailpit")
    assert wait(lambda: env.sql(f"select email_status from notifications where user_id='{state['admin_id']}' and body like '%{token}%'") == "SENT", 150), "the email should be delivered by a retry"


try:
    setup()
except AssertionError as e:
    print("setup failed:", e)
    sys.exit(2)
for fn in (workers_down, redis_down, opensearch_down, kafka_down, mail_down):
    fn()
print("\n== Summary")
for name, ok, seconds in results:
    print(f"  {'PASS' if ok else 'FAIL'}  {name} ({seconds:.0f}s)")
sys.exit(0 if all(ok for _, ok, _ in results) else 1)
