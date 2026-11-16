# CivicPulse — Project Plan

> Report Problems. Track Progress. Build Better Communities.

CivicPulse is a multi-tenant platform where citizens report community infrastructure
problems, organizations triage and resolve them, and everyone can follow progress
through a public tracking ID.

## 1. Scope

| In scope (v1)                                                   | Out of scope (v1)                      |
| --------------------------------------------------------------- | -------------------------------------- |
| Multi-organization tenancy with database-level isolation        | Native mobile apps                     |
| Complaint lifecycle with enforced state machine and audit trail | Payments / billing                     |
| Departments, field workers, assignments, SLA targets            | SSO / SAML (design leaves room for it) |
| In-app + email notifications driven by domain events            | SMS / WhatsApp channels                |
| Full-text search, analytics from real records                   | ML-based duplicate detection           |
| Observability, CI/CD, Kubernetes/Helm/Argo CD configuration     | Permanently hosted Kubernetes cluster  |

## 2. Hard constraints and what they force

| Constraint                   | Consequence                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| 8 GB RAM, ~10 GB disk laptop | Laptop runs only editor, Node, web dev server, API dev server. No local Docker/Kafka/OpenSearch/K8s.    |
| No credit card, zero spend   | Every external dependency sits behind an adapter with a no-infrastructure fallback.                     |
| No dedicated server          | Workers can run embedded in the API process (`EMBEDDED_WORKERS=true`) for single-process free hosting.  |
| Free tiers change            | Nothing in the core flow (report → assign → resolve → track) depends on a service that might disappear. |

**The governing rule:** PostgreSQL is the only hard dependency. Redis, Kafka, OpenSearch,
R2, email and telemetry backends are each optional; when one is missing the application
degrades to a documented fallback instead of failing.

## 3. Free services (verified November 2026)

Pricing was checked at planning time. Free tiers change; re-verify before signing up.

| Need                | Service                                       | Free allowance (as found)                                                         | Card?                                                                                                               | Fallback built into the app                                          |
| ------------------- | --------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| PostgreSQL          | Neon Free                                     | 1 GB/project (older guides say 0.5 GB), 100 CU-h/month, scale-to-zero after 5 min | No                                                                                                                  | Any Postgres 15+ (local install)                                     |
| Redis               | Upstash Free                                  | 256 MB, 500K commands/month                                                       | No                                                                                                                  | In-memory rate limiter + cache; inline jobs                          |
| Kafka               | Aiven for Kafka Free                          | 5 topics, 2 partitions/topic, 250 KiB/s, 3-day retention                          | No                                                                                                                  | `memory` broker (in-process, outbox-backed)                          |
| Search              | Aiven for OpenSearch Free                     | 4 GB RAM, 20 GB disk, 2 shards                                                    | No                                                                                                                  | `postgres` driver (tsvector + GIN)                                   |
| Object storage      | Cloudflare R2                                 | 10 GB, 1M class-A / 10M class-B ops per month                                     | **Unclear** — official page says no card; several 2026 guides report a payment method is requested when enabling R2 | `local` driver (disk + HMAC-signed URLs); any S3-compatible endpoint |
| Metrics/traces      | Grafana Cloud Free                            | ~10K series, 50 GB logs, 50 GB traces, 14-day retention                           | No                                                                                                                  | `/metrics` endpoint + console exporters                              |
| Images, CI          | GitHub Actions + GHCR                         | Free for public repositories                                                      | No                                                                                                                  | —                                                                    |
| Kubernetes          | none permanently free without a card          | —                                                                                 | —                                                                                                                   | Ephemeral `kind` cluster inside GitHub Actions                       |
| Redpanda Serverless | 30-day trial only (not a permanent free tier) | —                                                                                 | No                                                                                                                  | Not used as a dependency                                             |

Known cost/limit risks:

- **Upstash + BullMQ.** BullMQ workers issue Redis commands while idle. An always-on
  worker fleet can exhaust 500K commands/month. Mitigations: two queues only, long
  `drainDelay`/`stalledInterval`, and workers that are not required to be always on.
- **Neon cold starts.** The first request after 5 idle minutes pays a wake-up delay.
  The API uses connection retries on boot and a readiness probe separate from liveness.
- **Aiven Kafka topic cap.** The event design uses three topics, inside the five-topic cap.
- **R2 payment method.** If Cloudflare asks for a card, do not add one — use the `local`
  storage driver. The app does not need R2 to function.

## 4. Local vs. remote responsibilities

| Runs on the laptop                  | Runs remotely (free tier)         | Runs only in CI (ephemeral)                    |
| ----------------------------------- | --------------------------------- | ---------------------------------------------- |
| Next.js dev server (`apps/web`)     | PostgreSQL (Neon)                 | Docker image builds                            |
| Fastify dev server (`apps/api`)     | Redis (Upstash)                   | `kind` cluster + Helm install + Argo CD demo   |
| Workers, optionally embedded in API | Kafka, OpenSearch (Aiven)         | Redpanda container for Kafka integration tests |
| Unit tests (Vitest)                 | Object storage (R2 or local disk) | Postgres/Redis service containers for tests    |
|                                     | Metrics/traces (Grafana Cloud)    | Prometheus/Grafana/Jaeger demo stack           |

## 5. Technology decisions

| Area         | Choice                                               | Why                                                                                 |
| ------------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Monorepo     | pnpm workspaces (no Turborepo)                       | Three apps and three packages do not need a build orchestrator; fewer dependencies. |
| Language     | TypeScript 6.0, strict                               | TypeScript 7.0 is released but `typescript-eslint` supports `<6.1` only.            |
| Web          | Next.js 16 App Router, React 19, Tailwind 4          | As specified. UI primitives follow shadcn/ui conventions (Radix + Tailwind).        |
| API          | Fastify 5 + Zod 4 + `fastify-type-provider-zod`      | One schema source for validation, types and OpenAPI.                                |
| ORM          | Drizzle ORM + drizzle-kit SQL migrations             | Stable (Prisma's current release line is an 8.0 RC), no engine binary, SQL-first.   |
| Auth         | Opaque server-side sessions, Argon2id                | Revocable, no JWT key management, works with httpOnly cookies.                      |
| Tenancy      | `organization_id` + PostgreSQL row-level security    | Isolation is enforced by the database, not only by application code.                |
| Events       | Transactional outbox → broker adapter (Kafka/memory) | No dual-write between Postgres and Kafka.                                           |
| Kafka client | `kafkajs`                                            | Pure JavaScript, no native build on an 8 GB laptop; speaks to Aiven and Redpanda.   |
| Jobs         | BullMQ (inline executor when Redis is absent)        | As specified; fallback keeps the app working without Redis.                         |
| Tests        | Vitest, Playwright, autocannon                       | Lightweight; integration tests run against real Postgres.                           |

Package layout adjusts the suggested structure: `packages/schemas`, `types` and `config`
are merged into `packages/shared` (contracts) and `packages/platform` (runtime adapters),
and the database lives in `packages/db`. Four tiny packages would add build wiring
without adding separation.

## 6. Phases and exit criteria

| Phase | Deliverable                                        | Exit criteria                                                                      |
| ----- | -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 0     | Architecture documents                             | Documents agree with each other on schema, events and API.                         |
| 1     | Monorepo, DB, auth, RBAC, tenancy, base UI         | Register/login works end to end; isolation tests pass; typecheck/lint/build green. |
| 2     | Organizations, departments, complaints, dashboards | Full complaint lifecycle through the UI with audit history.                        |
| 3     | Redis, BullMQ, Kafka, consumers, search, storage   | Each adapter tested against a real backend and its fallback.                       |
| 4     | Metrics, tracing, dashboards, failure drills       | A trace spans API → outbox → consumer; failure scenarios documented.               |
| 5     | Docker, CI/CD, Terraform, K8s, Helm, Argo CD       | Workflows pass; chart lints and installs on `kind`.                                |
| 6     | Security review, load test, guides                 | Acceptance checklist filled in with honest status per item.                        |

Status of every deliverable is tracked in [DEVELOPMENT_ROADMAP.md](./DEVELOPMENT_ROADMAP.md)
using four labels: **tested**, **implemented-untested**, **configured-not-deployed**, **mock/ephemeral**.
