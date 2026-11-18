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

| Item                                                                                                                   | Status               | Evidence                                                                              |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------- |
| Complaint reporting, role-scoped list with full-text search, detail                                                    | tested               | `apps/api/test/complaints.test.ts`, `e2e/lifecycle.spec.ts`                           |
| Status machine with immutable history, SLA deadline at verification, reopen window                                     | tested               | same                                                                                  |
| Assignment, acceptance, reassignment; staff instructions hidden from reporters                                         | tested               | same                                                                                  |
| Comments with internal notes, feedback rating                                                                          | tested               | same                                                                                  |
| Photo upload: magic-byte check, re-encode (EXIF removed), size limit, signed URLs                                      | tested               | same (local disk storage driver)                                                      |
| Public tracking with privacy allow-list                                                                                | tested               | same                                                                                  |
| Departments, category routing, member roles, audit log                                                                 | tested               | same                                                                                  |
| Analytics computed from records (overview, departments, categories, trends, hotspots)                                  | tested               | same                                                                                  |
| Transactional outbox, in-process relay, idempotent consumers, retry, dead-letter                                       | tested               | same ("event processing" tests)                                                       |
| In-app notifications (event-driven)                                                                                    | tested               | same                                                                                  |
| Web: report form, lists, detail with actions, dashboards per role, departments, people, notifications, audit, tracking | tested               | 12 browser tests, desktop and mobile                                                  |
| Map pin on the report form (MapLibre + OpenFreeMap)                                                                    | implemented-untested | Tile host is not reachable from the build environment; the form works without the map |
| Hotspot **map** view                                                                                                   | planned              | API exists; no map visualization yet                                                  |
| Invitations by email, SLA policy editor, notification preferences UI                                                   | planned              | Tables exist; members are added by registering and being promoted                     |

Test totals at the end of Phase 2: 16 unit, 72 API/database integration, 12 end-to-end.

Pulled forward from Phase 3: the outbox, the in-process ("memory") event relay and the
notification consumer, because notifications are part of the core experience.

## Phase 3 — Distributed systems

| Item                                                                               | Status               | Evidence                                                                |
| ---------------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------- |
| Outbox relay (ordered, `SKIP LOCKED`, backoff) and idempotent consumers            | tested               | `apps/api/test/complaints.test.ts`, Kafka integration test              |
| Kafka producer and three consumer groups, dead-letter topic, redrive tool          | tested               | `kafka.integration.test.ts` against Apache Kafka 4.4.0; cluster drills  |
| Redis cache and shared rate limit (fail open)                                      | tested               | `redis.integration.test.ts`; Redis drill                                |
| BullMQ queues (mail, media, scheduler), retries, never blocks when Redis is down   | tested               | `redis.integration.test.ts`                                             |
| OpenSearch indexing, search API with highlights, PostgreSQL fallback, reindex tool | tested               | `opensearch.integration.test.ts`, browser search test, OpenSearch drill |
| S3-compatible storage (signed URLs) against SeaweedFS                              | tested               | `s3.integration.test.ts`                                                |
| Image processing and thumbnails via queue, SLA scheduler, retention                | tested               | API tests; scheduler runs in the cluster (not asserted individually)    |
| Email through the queue (SMTP to Mailpit in the cluster)                           | tested               | Mail provider drill                                                     |
| Neon, Upstash, Aiven, R2 as managed back ends                                      | implemented-untested | Configuration only; the design runs everything self-hosted              |

## Phase 4 — Observability

| Item                                                                  | Status               | Evidence                                                        |
| --------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------- |
| Prometheus metrics on the API and workers                             | tested               | Scraped in the cluster run; dashboards query them               |
| OpenTelemetry tracing with propagation through outbox, Kafka and jobs | tested               | `tracing.test.ts`; Jaeger trace check on Compose                |
| Six Grafana dashboards, provisioned and kept in sync by CI            | tested               | 49 queries valid; 39 return data (the rest have no data yet)    |
| Failure drills (5)                                                    | tested               | Compose and Kubernetes ("Cluster demo")                         |
| Alert rules and on-call routing                                       | planned              |                                                                 |
| Jaeger trace check inside the cluster                                 | implemented-untested | Verified on Compose; the cluster verifier checks the components |

## Phase 5 — DevOps

| Item                                                                 | Status                  | Evidence                                                                            |
| -------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------- |
| Multi-stage Dockerfile (api, workers, web), non-root, healthchecks   | tested                  | Built and run in CI and the cluster                                                 |
| CI: lint, types, unit, integration (real services), browser tests    | tested                  | `ci.yml`, green on the latest commit                                                |
| Helm charts (platform, application), values per environment          | tested                  | Lint (Helm 3 and 4), kubeconform, and deployed in the cluster run                   |
| Terraform: kind cluster, secrets, Traefik, Argo CD, root application | tested                  | `cluster-demo.yml`; `infra.yml` runs fmt and validate                               |
| Argo CD app-of-apps, sync waves, self-heal                           | tested                  | Cluster run: both applications Synced and Healthy                                   |
| Zero-downtime release, blocked bad release, rollback                 | tested                  | `rollout-demo.py`: 0 failed requests; the bad image is stopped at the migration job |
| Kubernetes failure drills                                            | tested                  | `drills.py kube` in the cluster run                                                 |
| Image publishing to GHCR                                             | configured-not-deployed | `images.yml` has never run: it triggers after CI passes on `main`                   |
| ECS Fargate module                                                   | configured-not-deployed | `terraform validate` only; never applied (needs a paid AWS account)                 |
| Automatic deploy on push (image tag bump in Git)                     | planned                 | Argo CD syncs Git; the tag is set by Terraform/values today                         |
| NetworkPolicies, TLS inside the cluster                              | planned                 | kind's default network plugin does not enforce NetworkPolicies                      |

## Phase 6 — Production readiness

| Item                                                   | Status       | Notes                                                           |
| ------------------------------------------------------ | ------------ | --------------------------------------------------------------- |
| README, Kubernetes, zero-cost, ECS, observability docs | done         |                                                                 |
| Troubleshooting guide                                  | done         |                                                                 |
| Security review of the new components                  | partial      | Known limitations are listed in SECURITY.md; no external review |
| Load test with recorded numbers                        | planned      | No performance figures are claimed                              |
| Backup and restore drill                               | planned      |                                                                 |
| Permanent public hosting                               | not possible | No free, card-less, always-on Kubernetes exists                 |

## Known limitations of the demonstration

- Every data service runs as a single replica with ephemeral storage in CI. This shows the
  design works; it is not a high-availability setup.
- The cluster workflow runs on a free GitHub runner and takes about 25 minutes.
- Two test fixes were needed while getting the cluster run green; all were test
  timing (a click before hydration, a slow first page load), not product behaviour.
