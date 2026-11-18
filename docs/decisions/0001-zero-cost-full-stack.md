# ADR 0001 — Run the whole "Request Journey" stack at zero cost

Status: accepted · Date: 2026-11-18

## Context

The target architecture is the "Request Journey" diagram: user → load balancer →
backend with a queue and Kafka → PostgreSQL, Redis, OpenSearch and S3, observed by
Prometheus, Grafana, OpenTelemetry and Jaeger, shipped by CI/CD → Helm → Argo CD onto
ECS or Kubernetes, packaged by Docker and provisioned by Terraform.

Constraints: no credit card, no paid service, an 8 GB / 10 GB developer laptop.

Every managed version of these services either needs a card or has a free tier far too
small to run them together (verified November 2026: Aiven Kafka and OpenSearch free
tiers exist but are single-service demos; Upstash Redis allows 500K commands/month;
Cloudflare R2 may ask for a payment method; AWS ECS, ALB and S3 need an AWS account
with a card). So the decision is to **self-host every component inside Kubernetes** and
provide the cluster from places that are free without a card.

## Decision

1. **Everything in the diagram runs as open-source software inside one Kubernetes
   cluster.** Managed services are not used. The application still reads every endpoint
   from environment variables, so pointing it at Neon, Upstash, Aiven or R2 later needs no
   code change.
2. **Where the cluster runs.** A cluster holding the full stack needs roughly 6–7 GB, which
   does not fit next to a development environment on an 8 GB laptop. It runs in:
   - **GitHub Actions** (free for public repositories): an ephemeral `kind` cluster created
     by Terraform, bootstrapped by Argo CD, verified by a scripted end-to-end check, then
     destroyed. This is the primary, automated proof.
   - **GitHub Codespaces** (free allowance for personal accounts, measured in core-hours):
     the same cluster for interactive exploration.
   - **A developer machine with 16 GB or more**, using the same Terraform.
   - The laptop itself runs the **lite** profile: the application with PostgreSQL only,
     where every other component falls back to its in-process driver.
3. **Nothing permanent is hosted for free.** There is no free, card-less, always-on
   Kubernetes. The project is demonstrable on demand; it is not a public SaaS URL.

## Mapping of the diagram

| Diagram box    | Implementation                                                                                                      | Cost               |
| -------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------ |
| User           | Browser → Next.js                                                                                                   | free               |
| Load balancer  | **Traefik** ingress (ingress-nginx reached end of life in March 2026)                                               | free               |
| Backend        | Fastify API, plus a separate workers process                                                                        | free               |
| Queue          | **BullMQ** on Redis                                                                                                 | free               |
| Kafka          | **Apache Kafka** (KRaft, single broker), real producer and consumer groups                                          | free               |
| PostgreSQL     | PostgreSQL 16 StatefulSet                                                                                           | free               |
| Redis          | Redis 7                                                                                                             | free               |
| OpenSearch     | OpenSearch 3 single node                                                                                            | free               |
| Amazon S3      | **SeaweedFS** S3 gateway (MinIO's community images were discontinued); same AWS SDK code as real S3                 | free               |
| Prometheus     | Prometheus with annotation-based scraping                                                                           | free               |
| Grafana        | Grafana with provisioned datasources and dashboards                                                                 | free               |
| OpenTelemetry  | OpenTelemetry SDK in the app → Collector                                                                            | free               |
| Jaeger         | Jaeger v2                                                                                                           | free               |
| CI/CD          | GitHub Actions                                                                                                      | free (public repo) |
| Docker / Image | Multi-stage Dockerfiles → GitHub Container Registry                                                                 | free (public repo) |
| Helm           | Charts for the platform and for the application                                                                     | free               |
| Argo CD        | Argo CD in the cluster, app-of-apps, automated sync and self-heal                                                   | free               |
| Kubernetes     | `kind` (in Actions, Codespaces or a local machine)                                                                  | free               |
| Terraform      | Provisions the kind cluster and bootstraps Argo CD (kind and helm providers)                                        | free               |
| ECS            | **Terraform module that is validated and planned, never applied.** ECS, ALB and NAT need an AWS account with a card | not run            |

ECS is the one box that cannot run at zero cost. It is delivered as reviewed
infrastructure code that proves the same images and configuration deploy there, with the
cost stated, and is clearly labelled "configured, not deployed".

## Consequences

- One image set and one Helm chart serve every environment; only values files differ.
- The full stack is verified automatically on every run of the cluster workflow, so claims
  in the status ledger point at a workflow run, not at intent.
- Self-hosted data services are demonstration-grade (single replica, ephemeral storage in
  CI). Production guidance (replication, backups, managed services) is documented rather
  than claimed.
- Aiven, Upstash, Neon and R2 stay valid optional back ends through configuration.

## Rejected alternatives

| Option                              | Why not                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------- |
| Managed free tiers for each service | Five accounts, quotas that BullMQ and Kafka exhaust, one may ask for a card |
| Oracle Cloud Always Free            | Needs a card at sign-up                                                     |
| MinIO                               | Community images and binaries were discontinued; unmaintained               |
| ingress-nginx                       | Retired by Kubernetes in March 2026                                         |
| LocalStack for ECS                  | Requires an account and token since March 2026; ECS reported as paid        |
| Redpanda                            | Free serverless tier is a trial; Apache Kafka is the product in the diagram |
