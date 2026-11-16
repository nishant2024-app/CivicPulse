# CivicPulse

**Report problems. Track progress. Build better communities.**

CivicPulse is a multi-tenant platform for community issue reporting: citizens report
problems such as potholes, broken streetlights or water leaks; organizations verify,
assign and resolve them; everyone can follow the progress.

> **Project status: Phases 0–2 of 6 complete.** The product works end to end on
> PostgreSQL alone: report → verify → assign → work → resolve → confirm, with
> notifications, public tracking and live analytics. Redis, Kafka, OpenSearch, R2,
> observability and deployment are not built yet. The itemized ledger is
> [docs/DEVELOPMENT_ROADMAP.md](docs/DEVELOPMENT_ROADMAP.md).

## What works today

- **Citizens:** register, report an issue (category, description, location, map pin,
  photos), get a tracking ID, follow status, reply, reopen, rate the resolution.
- **Administrators and department managers:** triage queue, verify/reject, assign to a
  department and worker, set priority, internal notes, departments, category routing,
  member roles, audit log, dashboard with real figures.
- **Field workers:** assigned work ordered by deadline, accept, progress, upload evidence, resolve.
- **Public:** track any report by ID without an account; no personal data is shown.
- **Platform:** multi-tenant isolation by PostgreSQL row-level security, append-only
  history, transactional outbox with retries and dead-lettering, OpenAPI docs at `/api/docs`.

## Requirements

- Node.js 22 and pnpm 10 (`corepack enable`)
- A PostgreSQL 15+ database — a free [Neon](https://neon.com) project, or a local install

Nothing else. No Docker, Redis or Kafka is needed to run what exists today.

## Run it

```bash
pnpm install
cp .env.example .env          # then set DATABASE_URL
pnpm db:migrate               # create tables, policies, triggers
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

**Using Neon:** copy the _pooled_ connection string into `DATABASE_URL`. The database
role must be allowed to create a role (`civicpulse_app`), which the default Neon owner
role is. This has been tested against local PostgreSQL 16, not yet against Neon itself.

## Verify it

```bash
pnpm typecheck
pnpm lint
pnpm test        # needs TEST_DATABASE_URL: a database whose name contains "test"
pnpm build
pnpm test:e2e    # browser tests; starts the app if it is not running
```

Integration tests truncate tables, so they refuse to run against a database whose name
does not contain `test`. Default:
`postgres://civicpulse:civicpulse@localhost:5432/civicpulse_test`.

## Repository layout

```
apps/web            Next.js 16 UI
apps/api            Fastify 5 REST API (modules under src/modules)
apps/workers        Background workers (Phase 3)
packages/shared     Contracts: Zod schemas, enums, status machine, permission matrix
packages/db         Drizzle schema, SQL migrations, tenant-scoped database access
packages/platform   Config validation, logging, tokens, mailer
e2e                 Playwright tests
docs                Architecture, database, API, events, security, infrastructure
```

## Documentation

| Document                                                   | Contents                                                              |
| ---------------------------------------------------------- | --------------------------------------------------------------------- |
| [Project plan](docs/PROJECT_PLAN.md)                       | Scope, constraints, verified free-tier services, technology decisions |
| [System design](docs/architecture/SYSTEM_DESIGN.md)        | Architecture, request path, multi-tenancy, failure behaviour          |
| [Database design](docs/database/DATABASE_DESIGN.md)        | ER diagram, tables, indexes, row-level security, retention            |
| [API specification](docs/api/API_SPECIFICATION.md)         | Conventions and endpoint map                                          |
| [Event design](docs/architecture/EVENT_DESIGN.md)          | Outbox, Kafka topics, consumers, retries                              |
| [Security](docs/security/SECURITY.md)                      | Threat model and controls                                             |
| [Infrastructure](docs/deployment/INFRASTRUCTURE_DESIGN.md) | Containers, CI/CD, Kubernetes, Terraform, observability               |
| [Roadmap and status](docs/DEVELOPMENT_ROADMAP.md)          | What is tested, untested, configured only, or planned                 |
