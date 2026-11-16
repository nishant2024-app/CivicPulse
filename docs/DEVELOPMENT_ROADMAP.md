# Development Roadmap and Status

Status labels:

- **tested** — implemented and exercised by automated tests or a recorded manual run
- **implemented-untested** — code exists, not yet verified
- **configured-not-deployed** — configuration exists and validates, never run against real infrastructure
- **mock/ephemeral** — demonstrated only with a fallback driver or a temporary environment
- **planned** — not started

This file is updated at the end of every phase. It is the honest ledger; the README
links here rather than repeating claims.

## Phase 0 — Architecture and planning

| Item | Status |
| ---- | ------ |
| Repository inspection, toolchain and compatibility check | done |
| Free-tier verification | done (November 2026; see PROJECT_PLAN.md §3) |
| PROJECT_PLAN, SYSTEM_DESIGN, DATABASE_DESIGN, API_SPECIFICATION, EVENT_DESIGN, SECURITY, INFRASTRUCTURE_DESIGN | done |

Compatibility findings:

| Finding | Decision |
| ------- | -------- |
| TypeScript 7.0 is `latest`; `typescript-eslint` 8 supports `<6.1` | Pin TypeScript 6.0.x |
| Prisma `latest` is 8.0.0-rc | Use Drizzle ORM |
| Zod 4 is current; `fastify-type-provider-zod` 7 requires Zod ≥4.1.5 | Zod 4 everywhere |
| Tailwind 4 uses CSS-first configuration | No `tailwind.config.js`; tokens in CSS |
| Next.js 16 requires Node ≥20.9 | Node 22 LTS, enforced via `engines` |

## Phase 1 — Application foundation

| Item | Status |
| ---- | ------ |
| pnpm monorepo, strict TypeScript, ESLint, Prettier | planned |
| Database schema, migrations, RLS, immutability triggers | planned |
| Config validation, logger | planned |
| Fastify API: error envelope, security headers, rate limiting, OpenAPI | planned |
| Auth: register, login, logout, me, sessions, password change/reset | planned |
| RBAC permission matrix + tenant context | planned |
| Web: landing, login, registration, authenticated shell | planned |
| Tests: unit, auth integration, tenant isolation | planned |

## Phase 2 — Core business features

Organizations, invitations, departments, categories, SLA policies, complaint reporting,
status machine, assignments, comments, attachments (local storage), public tracking,
feedback, citizen dashboard, staff dashboard, field worker view, audit log viewer.
**planned**

## Phase 3 — Distributed systems

Redis cache and rate limiting, BullMQ queues, outbox relay, Kafka broker adapter,
notification/search/analytics consumers, OpenSearch adapter, S3/R2 adapter, image
processing, SLA scheduler. **planned**

## Phase 4 — Observability

Prometheus metrics, OpenTelemetry tracing with context propagation through the outbox,
Grafana dashboards, Jaeger, failure drills. **planned**

## Phase 5 — DevOps

Dockerfiles, GitHub Actions (CI, images, infra validation, ephemeral cluster demo),
Terraform modules, Helm chart, Kubernetes manifests, Argo CD, ECS documentation.
**planned**

## Phase 6 — Production readiness

Security review, load test with recorded numbers, backup/restore drill, README,
deployment guide, zero-cost guide, troubleshooting guide, demonstration scenarios.
**planned**
