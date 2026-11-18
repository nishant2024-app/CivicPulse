# CivicPulse

**Report problems. Track progress. Build better communities.**

CivicPulse is a multi-tenant platform for community issue reporting: citizens report
problems such as potholes, broken streetlights or water leaks; organizations verify,
assign and resolve them; everyone can follow the progress.

It is built as a real distributed system, and every component of the
[Request Journey](docs/architecture/REQUEST_JOURNEY.md) diagram runs at **zero cost, with no credit
card**: Traefik, Fastify, BullMQ, Kafka, PostgreSQL, Redis, OpenSearch, S3-compatible storage,
OpenTelemetry, Prometheus, Grafana, Jaeger, Docker, GitHub Actions, Helm, Argo CD, Terraform
and Kubernetes. The one box that cannot be free, AWS ECS, is written and validated but never
deployed ([why](docs/deployment/ECS.md)).

## What is proven, and where

The honest ledger is [docs/DEVELOPMENT_ROADMAP.md](docs/DEVELOPMENT_ROADMAP.md). In short:

| Claim                                                                                             | Evidence                                                              |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Application features, tenant isolation, events, search, storage, queues                           | Unit, API and integration tests; 13 browser tests (CI workflow)       |
| Redis, Kafka, OpenSearch and S3 behave as designed                                                | Integration tests against the real services (CI "Integration" job)    |
| The whole stack runs in Kubernetes, deployed by Terraform → Argo CD, serving real browser traffic | "Cluster demo" workflow: kind cluster, 13 browser tests, 17 checks    |
| A bad release is stopped and rolled back with no failed request                                   | Same workflow: `scripts/rollout-demo.py`                              |
| Five failure drills (workers, Redis, OpenSearch, Kafka, mail provider down)                       | Same workflow: `scripts/drills.py kube`                               |
| Images published to GHCR                                                                          | **Not yet run:** `images.yml` only triggers after CI passes on `main` |
| ECS                                                                                               | Validated only; never applied                                         |
| Load test, backup/restore drill                                                                   | **Not done**                                                          |

## Ways to run it

| Mode               | Needs                         | You get                                                                               |
| ------------------ | ----------------------------- | ------------------------------------------------------------------------------------- |
| **Lite**           | Node 22, pnpm, PostgreSQL 15+ | The application, with in-process fallbacks for queue, events, search, storage         |
| **Compose stack**  | Docker, about 6 GB free RAM   | Every service as a container (`docker-compose.stack.yml`)                             |
| **Kubernetes**     | Docker, Terraform, 16 GB RAM  | The full GitOps path on a local kind cluster ([guide](docs/deployment/KUBERNETES.md)) |
| **GitHub Actions** | A fork of this public repo    | The Kubernetes mode on a free runner: run the **Cluster demo** workflow               |

Where it can run for free, and what cannot: [zero-cost guide](docs/deployment/ZERO_COST_GUIDE.md).
There is no free always-on hosting for a cluster; this project is demonstrable on demand.

### Lite mode

```bash
pnpm install
cp .env.example .env          # then set DATABASE_URL
pnpm db:migrate               # tables, policies, triggers
pnpm db:seed                  # optional: demo organization with one account per role
pnpm dev                      # API on :4000, web on :3000
```

Open <http://localhost:3000>. API docs: <http://localhost:4000/api/docs>.

Seeded accounts (password `civicpulse-demo-1`, or `SEED_PASSWORD` if you set it):

| Role               | Email                           |
| ------------------ | ------------------------------- |
| Super admin        | `superadmin@civicpulse.local`   |
| Organization admin | `admin@demo.civicpulse.local`   |
| Department manager | `manager@demo.civicpulse.local` |
| Field worker       | `worker@demo.civicpulse.local`  |
| Citizen            | `citizen@demo.civicpulse.local` |

### Compose stack

```bash
docker compose -f docker-compose.stack.yml up -d --build --wait
```

### Kubernetes (kind, Terraform, Argo CD)

See [docs/deployment/KUBERNETES.md](docs/deployment/KUBERNETES.md). In GitHub: Actions →
**Cluster demo** → Run workflow.

## What the application does

- **Citizens:** register, report an issue (category, description, location, photos), get a
  tracking ID, follow status, reopen, rate the resolution.
- **Administrators and managers:** triage, verify or reject, assign to a department and worker,
  internal notes, categories, roles, audit log, analytics from real records.
- **Field workers:** assigned work by deadline, accept, progress, evidence, resolve.
- **Public:** track any report by ID without an account; no personal data shown.
- **Search:** full-text search with highlights (OpenSearch, PostgreSQL fallback).
- **Platform:** tenant isolation by row-level security, append-only history, transactional
  outbox → Kafka, idempotent consumers with dead-lettering, SLA scheduler, email via queue.

## Verify it

```bash
pnpm typecheck && pnpm lint && pnpm format:check
pnpm test                 # needs TEST_DATABASE_URL (a database whose name contains "test")
pnpm test:integration     # needs `docker compose -f docker-compose.deps.yml up -d --wait`
pnpm build
pnpm test:e2e             # browser tests
```

Tests truncate tables, so they refuse to run against a database whose name does not contain `test`.

## Repository layout

```
apps/web            Next.js 16 UI
apps/api            Fastify 5 REST API
apps/workers        Outbox relay, Kafka consumers, BullMQ workers, scheduler, redrive tools
packages/shared     Contracts: Zod schemas, enums, status machine, permissions
packages/db         Drizzle schema, SQL migrations, tenant-scoped access
packages/platform   Config, logging, cache, queues, search, storage, metrics, tracing
packages/events     Outbox, relay, consumers, Kafka adapter, jobs
infrastructure/     Docker, Helm charts, Argo CD, Terraform (kind, GitOps, ECS), compose files
scripts/            Dashboards, cluster verification, rollout and failure drills
e2e                 Playwright tests
docs                Architecture, database, API, events, security, operations, deployment
```

## Documentation

| Document                                                                                                                    | Contents                                             |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| [Request journey](docs/architecture/REQUEST_JOURNEY.md)                                                                     | The diagram, box by box, with the proof for each     |
| [Decision 0001](docs/decisions/0001-zero-cost-full-stack.md)                                                                | Why everything is self-hosted in Kubernetes          |
| [System design](docs/architecture/SYSTEM_DESIGN.md)                                                                         | Architecture, request path, multi-tenancy            |
| [Event design](docs/architecture/EVENT_DESIGN.md)                                                                           | Outbox, Kafka, consumers, retries                    |
| [Observability](docs/operations/OBSERVABILITY.md)                                                                           | Metrics, traces, dashboards, failure drills          |
| [Kubernetes guide](docs/deployment/KUBERNETES.md)                                                                           | Terraform, Argo CD, rollout and rollback             |
| [Zero-cost guide](docs/deployment/ZERO_COST_GUIDE.md)                                                                       | Where it runs free, limits, what cannot              |
| [ECS](docs/deployment/ECS.md)                                                                                               | The alternative target, validated only               |
| [Troubleshooting](docs/deployment/TROUBLESHOOTING.md)                                                                       | Known problems and fixes                             |
| [Database](docs/database/DATABASE_DESIGN.md) · [API](docs/api/API_SPECIFICATION.md) · [Security](docs/security/SECURITY.md) | Reference                                            |
| [Roadmap and status](docs/DEVELOPMENT_ROADMAP.md)                                                                           | What is tested, untested, configured only or planned |
