#!/usr/bin/env python3
"""GitOps rollout and rollback without downtime.

Points the application at an image that does not exist (a bad release), shows that
Kubernetes keeps the previous version serving while Argo CD reports the problem, then restores
the good version (the equivalent of `git revert`) and shows the release becoming healthy.
A background probe counts failed requests the whole time; the demo fails if there is any.

    python3 scripts/rollout-demo.py --tag <good-tag> --prefix civicpulse
"""
import argparse
import json
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

ap = argparse.ArgumentParser()
ap.add_argument("--tag", required=True)
ap.add_argument("--prefix", default="civicpulse")
ap.add_argument("--namespace", default="civicpulse")
ap.add_argument("--url", default="http://civicpulse.localtest.me:8080/api/v1/organizations/public")
args = ap.parse_args()


def k(*a, ns=None):
    cmd = ["kubectl"] + (["-n", ns] if ns else []) + list(a)
    done = subprocess.run(cmd, capture_output=True, text=True)
    if done.returncode != 0:
        print(f"   kubectl {' '.join(a[:3])} failed: {done.stderr.strip()[:300]}")
    return done.stdout.strip()


def dump(reason):
    """Print what the cluster actually looks like, so a failed step explains itself."""
    print(f"   --- state after: {reason}")
    for line in (
        k("get", "application", "civicpulse-root", "-o", "jsonpath={.spec.source.helm.parameters}", ns="argocd"),
        k("get", "application", "civicpulse", "-o", "jsonpath={.spec.source.helm.parameters}", ns="argocd"),
        k("get", "application", "civicpulse", "-o", "jsonpath={.status.sync.status} {.status.health.status} {.status.operationState.message}", ns="argocd"),
        k("get", "deploy", "api", "-o", "jsonpath={.spec.template.spec.containers[0].image} {.status.conditions[*].message}", ns=args.namespace),
        k("get", "pods", "-l", "app.kubernetes.io/name=api", "-o", "wide", ns=args.namespace),
    ):
        print("   ", line)


def set_tag(tag):
    app = json.loads(k("get", "application", "civicpulse-root", "-o", "json", ns="argocd"))
    params = app["spec"]["source"]["helm"]["parameters"]
    index = next(i for i, p in enumerate(params) if p["name"] == "imageTag")
    patch = json.dumps([{"op": "replace", "path": f"/spec/source/helm/parameters/{index}/value", "value": tag}])
    k("patch", "application", "civicpulse-root", "--type", "json", "-p", patch, ns="argocd")
    refresh()


def refresh():
    """Ask Argo CD to re-read Git now instead of waiting for its poll interval.

    The change travels root Application -> child Application -> workloads, so each level is
    refreshed in turn, twice, to give the child time to be re-rendered with the new parameter.
    """
    for _ in range(2):
        for name in ("civicpulse-root", "civicpulse"):
            k("annotate", "application", name, "argocd.argoproj.io/refresh=hard", "--overwrite", ns="argocd")
            time.sleep(5)


def health():
    return json.loads(k("get", "application", "civicpulse", "-o", "json", ns="argocd"))["status"]["health"]["status"]


def wait(check, timeout, label):
    end = time.time() + timeout
    while time.time() < end:
        if check():
            return True
        time.sleep(3)
    print(f"  timed out waiting for: {label}")
    dump(label)
    return False


codes = []
stop = threading.Event()


def probe():
    while not stop.is_set():
        try:
            with urllib.request.urlopen(args.url, timeout=5) as r:
                codes.append(r.status)
        except urllib.error.HTTPError as e:
            codes.append(e.code)
        except Exception:
            codes.append(0)
        time.sleep(0.4)


thread = threading.Thread(target=probe, daemon=True)
thread.start()
ok = True
try:
    print(f"1. Releasing a bad version (image tag 'does-not-exist')")
    set_tag("does-not-exist")
    broken = wait(lambda: "ImagePull" in k("get", "pods", "-l", "app.kubernetes.io/name=api", "-o", "jsonpath={.items[*].status.containerStatuses[*].state.waiting.reason}", ns=args.namespace) or "ErrImageNeverPull" in k("get", "pods", "-l", "app.kubernetes.io/name=api", "-o", "jsonpath={.items[*].status.containerStatuses[*].state.waiting.reason}", ns=args.namespace), 240, "new pod to fail to start")
    ready = k("get", "deploy", "api", "-o", "jsonpath={.status.readyReplicas}", ns=args.namespace)
    print(f"   new pods cannot start: {broken}; old version still ready replicas: {ready or 0}; Argo CD health: {health()}")
    ok &= broken and int(ready or 0) >= 1
    time.sleep(5)

    print(f"2. Rolling back to the good version ({args.tag})")
    set_tag(args.tag)
    healthy = wait(lambda: health() == "Healthy" and "ImagePull" not in k("get", "pods", "-l", "app.kubernetes.io/name=api", "-o", "jsonpath={.items[*].status.containerStatuses[*].state.waiting.reason}", ns=args.namespace), 300, "application to become healthy again")
    print(f"   Argo CD health: {health()}")
    ok &= healthy
finally:
    stop.set()
    thread.join()

failures = [c for c in codes if c != 200]
print(f"3. Availability during the whole exercise: {len(codes)} requests, {len(failures)} failed")
ok &= len(failures) == 0
print("PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
