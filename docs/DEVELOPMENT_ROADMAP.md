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

| Item                                                                                                           | Status                                       |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Repository inspection, toolchain and compatibility check                                                       | done                                         |
| Free-tier verification                                                                                         | done (November 2026; see PROJECT_PLAN.md §3) |
| PROJECT_PLAN, SYSTEM_DESIGN, DATABASE_DESIGN, API_SPECIFICATION, EVENT_DESIGN, SECURITY, INFRASTRUCTURE_DESIGN | done                                         |

Compatibility findings:

| Finding                                                             | Decision                               |
| ------------------------------------------------------------------- | -------------------------------------- |
| TypeScript 7.0 is `latest`; `typescript-eslint` 8 supports `<6.1`   | Pin TypeScript 6.0.x                   |
| Prisma `latest` is 8.0.0-rc                                         | Use Drizzle ORM                        |
| Zod 4 is current; `fastify-type-provider-zod` 7 requires Zod ≥4.1.5 | Zod 4 everywhere                       |
| Tailwind 4 uses CSS-first configuration                             | No `tailwind.config.js`; tokens in CSS |
| Next.js 16 requires Node ≥20.9                                      | Node 22 LTS, enforced via `engines`    |

## Phase 1 — Application foundation

| Item                                                                                        | Status               | Evidence                                                                       |
| ------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------ |
| pnpm monorepo, strict TypeScript, ESLint, Prettier                                          | tested               | `pnpm typecheck`, `pnpm lint`, `pnpm format:check` clean                       |
| Database schema (22 tables) and migrations                                                  | tested               | Applied to PostgreSQL 16; re-running is a no-op                                |
| Row-level security and append-only triggers                                                 | tested               | `apps/api/test/tenancy.test.ts` (12 database-level tests)                      |
| Config validation, structured logging with redaction                                        | tested               | `packages/platform/src/config.test.ts`; redaction list is implemented-untested |
| API: error envelope, security headers, CSRF, rate limiting, OpenAPI                         | tested               | `apps/api/test/auth.test.ts`                                                   |
| Auth: register, login, logout, me, sessions, password change/reset, account deletion        | tested               | `apps/api/test/auth.test.ts` (27 tests)                                        |
| RBAC permission matrix, tenant context, organization endpoints                              | tested               | `packages/shared/src/*.test.ts`, `apps/api/test/tenancy.test.ts`               |
| Web: landing, login, registration, password reset, dashboard, settings, create organization | tested               | `e2e/*.spec.ts` (10 browser tests, desktop and mobile)                         |
| Production builds (API bundle, Next.js standalone)                                          | tested               | `pnpm build`                                                                   |
| Seed script                                                                                 | tested               | Run manually against the development database                                  |
| CI workflow                                                                                 | configured           | `.github/workflows/ci.yml`; see the phase report for its first run             |
| Password reset **email delivery**                                                           | mock/ephemeral       | Only the `log` mailer exists; real delivery arrives in Phase 3                 |
| Neon as the database                                                                        | implemented-untested | Developed against local PostgreSQL 16 only                                     |

Test totals at the end of Phase 1: 16 unit, 51 API/database integration, 10 end-to-end.

Deviations from the Phase 0 documents, corrected in those documents:

- RLS is enabled but not `FORCE`d. Policies target the restricted `civicpulse_app` role;
  forcing them on the owner would block the privileged paths (authentication, workers).
- Password-reset and invitation emails are sent as direct commands, not domain events,
  so single-use tokens never enter the event stream.
- Registration answers `409` for an email that is already registered. This reveals that
  the address has an account; it is listed as a known limitation in SECURITY.md.

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
