# Deploying to Kubernetes (kind, or any cluster)

## What is deployed

| Chart                                     | Contents                                                                                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `infrastructure/helm/civicpulse-platform` | PostgreSQL, Redis, Kafka (KRaft), OpenSearch, SeaweedFS (S3), Mailpit, OpenTelemetry Collector, Jaeger, Prometheus, Grafana, and their ingresses. No secrets. |
| `infrastructure/helm/civicpulse`          | API, workers, web, migration job (pre-install/upgrade hook), optional seed job, ingress, HPA and disruption budgets (off in the demo).                        |
| `infrastructure/argocd/root`              | One Argo CD Application that points at the next chart.                                                                                                        |
| `infrastructure/argocd/apps`              | The AppProject and the two Applications: platform (sync wave 0) then application (wave 1).                                                                    |

Secrets come from one Kubernetes Secret, `civicpulse-secrets`, created outside Git.

## Run it on your machine (16 GB RAM, Docker, Terraform)

```bash
# 1. images
for t in api workers web; do docker build -f infrastructure/docker/Dockerfile --target $t -t civicpulse-$t:local .; done

# 2. cluster
cd infrastructure/terraform/environments/kind-cluster
terraform init && terraform apply
export KUBECONFIG=$(terraform output -raw kubeconfig_path)
for t in api workers web; do kind load docker-image civicpulse-$t:local --name civicpulse; done

# 3. secrets, ingress, Argo CD, root application
cd ../gitops-demo
terraform init && terraform apply \
  -var kubeconfig_path=$KUBECONFIG \
  -var repo_revision=<a pushed commit or branch> -var image_tag=local -var image_prefix=civicpulse
```

Argo CD then syncs the platform and the application from Git. Open:

|                                      |                                                                      |
| ------------------------------------ | -------------------------------------------------------------------- |
| App                                  | <http://civicpulse.localtest.me:8080>                                |
| Argo CD                              | <http://argocd.localtest.me:8080>                                    |
| Grafana · Jaeger · Prometheus · Mail | `grafana.` / `jaeger.` / `prometheus.` / `mail.` `localtest.me:8080` |

Demo accounts (seed job): see the README; the password is in the `seed-password` key of the Secret.

## How a change reaches the cluster

```
git push → CI (lint, types, tests, integration, browser) → image build → GHCR
        → image tag in Git → Argo CD notices → Helm renders → Kubernetes rolls out
```

Argo CD pulls; CI never holds cluster credentials. The migration job runs first (PreSync) and
retries until the database is reachable. `maxUnavailable: 0` keeps the old version serving
while the new one starts.

## Rollback

GitOps rollback is a revert of the desired state:

```bash
git revert <bad commit> && git push        # Argo CD syncs the previous version
```

`scripts/rollout-demo.py` demonstrates it: it releases a non-existent image, shows the old
version still serving while Argo CD reports the problem, restores the good tag and checks that
no request failed during the whole exercise.

## Production notes

The demo values are not production. For a real cluster:

- use `values-prod.yaml` (replicas, autoscaling, disruption budgets, TLS) and managed or
  replicated data services (PostgreSQL with backups, Kafka and OpenSearch with replication
  and authentication — the demo turns OpenSearch security off because it is namespace-internal);
- create secrets with an external secrets manager instead of Terraform-generated values;
- enable NetworkPolicies (kind's default network plugin does not enforce them);
- pin images by digest and scan them.
