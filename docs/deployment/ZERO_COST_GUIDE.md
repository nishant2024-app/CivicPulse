# Running everything at zero cost, without a credit card

The whole Request Journey runs on open-source software. What costs money elsewhere is the
_hosting_ of it, so this guide is about where the cluster can run for free.

## Where it can run

| Place                                  | What runs                                                                                                         | Cost                                                                                                                                                   | Limits                                                                                                                                            |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GitHub Actions** (public repository) | The full cluster, for the length of a workflow run (`cluster-demo.yml`)                                           | Free                                                                                                                                                   | Standard hosted runners are free for public repositories; the run is ephemeral. Check the runner's CPU and RAM in the first lines of the run log. |
| **GitHub Codespaces**                  | The same cluster, interactively, with port forwarding                                                             | Free allowance for personal accounts, counted in core-hours (120/month on the free plan per GitHub's billing docs: about 30 hours of a 4-core machine) | Time-boxed; stops when idle. Confirm the allowance on GitHub's billing page.                                                                      |
| **A machine with 16 GB RAM or more**   | The same cluster with Docker + kind, or `docker-compose.stack.yml`                                                | Free                                                                                                                                                   | Needs about 6 GB free for the full platform.                                                                                                      |
| **Your 8 GB laptop**                   | The _lite_ profile: web + API + PostgreSQL. Redis, Kafka, OpenSearch, S3, tracing fall back to in-process drivers | Free                                                                                                                                                   | No Kafka, search engine or observability stack. Everything else works.                                                                            |

There is **no free, always-on, card-less Kubernetes**. This project does not pretend otherwise:
it is demonstrable on demand and reproducible by anyone, not a permanently hosted site.

## Free managed alternatives (optional)

The application reads every endpoint from environment variables, so any of these can replace
the in-cluster service without code changes. Limits as verified in November 2026; re-check
before relying on them.

| Need             | Service       | Free allowance                                                                   | Card                                                   |
| ---------------- | ------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------ |
| PostgreSQL       | Neon          | 1 GB per project, 100 compute-hours/month, scales to zero                        | No                                                     |
| Redis            | Upstash       | 256 MB, 500K commands/month. BullMQ polls, so a 24/7 worker can use this quickly | No                                                     |
| Kafka            | Aiven         | 5 topics, 2 partitions each, 250 KiB/s                                           | No                                                     |
| OpenSearch       | Aiven         | 4 GB RAM, 20 GB disk, one service                                                | No                                                     |
| Object storage   | Cloudflare R2 | 10 GB, 1M writes + 10M reads/month                                               | Reported to ask for a payment method — skip if it does |
| Metrics / traces | Grafana Cloud | about 10K series, 50 GB traces, 14-day retention                                 | No                                                     |

## What cannot run free

| Item                  | Why                                                                            | What the project does instead                                                                |
| --------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| AWS ECS, ALB, NAT, S3 | Need an AWS account with a payment method                                      | `modules/ecs-service` is validated but never applied, behind a `confirm_paid_resources` gate |
| LocalStack for ECS    | Requires an account and token since March 2026; ECS reported as a paid feature | Not used                                                                                     |
| MinIO                 | Community images discontinued                                                  | SeaweedFS (S3 API)                                                                           |
| ingress-nginx         | Retired by Kubernetes in March 2026                                            | Traefik                                                                                      |

## Resource budget of the full platform

Requests, from `values.yaml`: PostgreSQL 256 Mi, Redis 96 Mi, Kafka 640 Mi, OpenSearch 1 Gi,
SeaweedFS 192 Mi, Mailpit 32 Mi, Collector 128 Mi, Jaeger 128 Mi, Prometheus 192 Mi,
Grafana 128 Mi, API 192 Mi, workers 192 Mi, web 128 Mi, Traefik 64 Mi, Argo CD about 450 Mi —
roughly 4 GiB requested, 6 GiB with limits. Measured locally with Docker: the stack's
containers together stayed within a few GiB.

## Guardrails

- No step needs a credit card, and no workflow creates billable resources.
- Terraform never applies anything outside the throwaway kind cluster; the AWS environment will
  not even plan without `-var confirm_paid_resources=true`.
- Images are published to GitHub Container Registry, which is free for public repositories.
