# API Specification

Base path `/api/v1`. JSON over HTTPS. The authoritative, always-current reference is the
generated OpenAPI document served by the API at `/api/docs` (UI) and
`/api/docs/json` — it is produced from the same Zod schemas that validate requests.
This document describes the conventions and the endpoint map.

## 1. Conventions

**Authentication.** Session cookie `cp_session` (httpOnly, `SameSite=Lax`, `Secure` in
production). No bearer tokens in v1.

**CSRF.** State-changing requests must carry the header `X-Requested-With: civicpulse`
and, when an `Origin` header is present, it must match an allowed origin. Browsers do
not let cross-site forms set custom headers.

**Active organization.** Tenant-scoped endpoints act on the session's active
organization. `POST /auth/switch-organization` changes it. There is no
`organizationId` request parameter to tamper with.

**Errors.**

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid request",
             "details": [{ "path": "email", "message": "Invalid email" }],
             "requestId": "req_01J..." } }
```

| HTTP | `code` |
| ---- | ------ |
| 400 | `VALIDATION_ERROR`, `BAD_REQUEST` |
| 401 | `UNAUTHENTICATED` |
| 403 | `FORBIDDEN`, `CSRF_REJECTED` |
| 404 | `NOT_FOUND` (also returned for resources in another organization) |
| 409 | `CONFLICT`, `INVALID_STATUS_TRANSITION` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 415 | `UNSUPPORTED_MEDIA_TYPE` |
| 429 | `RATE_LIMITED` |
| 500 | `INTERNAL_ERROR` (no internals leaked) |
| 503 | `SERVICE_UNAVAILABLE` |

**Pagination.** `?page=1&pageSize=20` (max 100). Response:
`{ "data": [...], "pagination": { "page", "pageSize", "total", "totalPages" } }`.

**Filtering and sorting.** Explicit, whitelisted query parameters per endpoint;
`sort=createdAt|updatedAt|priority|slaDueAt`, `order=asc|desc`.

**Rate limits.** Global 300 requests/min per IP; auth endpoints 10/min per IP;
public tracking 30/min per IP; uploads 20/min per user.

## 2. Roles

`SA` super admin · `OA` organization admin · `DM` department manager ·
`FW` field worker · `CZ` citizen · `—` public.

## 3. Endpoints

### Auth

| Method | Path | Access | Notes |
| ------ | ---- | ------ | ----- |
| POST | `/auth/register` | — | Citizen registration into an organization that allows it, or with an invitation token |
| POST | `/auth/login` | — | Generic error on failure; rotates session |
| POST | `/auth/logout` | any | Revokes the current session |
| GET | `/auth/me` | any | User, memberships, active organization, permissions |
| POST | `/auth/switch-organization` | any | Must be a member |
| POST | `/auth/password/forgot` | — | Always 202; never reveals whether the email exists |
| POST | `/auth/password/reset` | — | Single-use token; revokes all sessions |
| POST | `/auth/password/change` | any | Requires current password |
| GET | `/auth/sessions` | any | List own sessions |
| DELETE | `/auth/sessions/:id` | any | Revoke one of own sessions |

### Users / profile

| Method | Path | Access |
| ------ | ---- | ------ |
| PATCH | `/users/me` | any |
| DELETE | `/users/me` | any (password confirmation; anonymizes) |
| GET/PUT | `/users/me/notification-preferences` | any |

### Organizations

| Method | Path | Access |
| ------ | ---- | ------ |
| GET | `/organizations/public` | — (id, name, slug, type of organizations open for registration) |
| POST | `/organizations` | SA, or any authenticated user when self-service creation is enabled (creator becomes OA) |
| GET | `/organizations` | SA: all · others: own memberships |
| GET | `/organizations/:id` | members, SA |
| PATCH | `/organizations/:id` | OA, SA |
| GET | `/organizations/current/members` | OA, DM (own department) |
| PATCH | `/organizations/current/members/:memberId` | OA (role, department, status) |
| DELETE | `/organizations/current/members/:memberId` | OA |
| GET/POST | `/organizations/current/invitations` | OA |
| DELETE | `/organizations/current/invitations/:id` | OA |
| GET | `/invitations/:token` | — (organization name and role only) |
| GET/POST | `/organizations/current/categories` | read: members · write: OA |
| GET/PUT | `/organizations/current/sla-policies` | OA |

### Departments

| Method | Path | Access |
| ------ | ---- | ------ |
| GET | `/departments` | members |
| POST | `/departments` | OA |
| GET | `/departments/:id` | OA, DM, FW |
| PATCH | `/departments/:id` | OA |
| DELETE | `/departments/:id` | OA (soft delete; refused while open complaints are assigned) |
| GET | `/departments/:id/workers` | OA, DM of that department |

### Complaints

| Method | Path | Access | Notes |
| ------ | ---- | ------ | ----- |
| POST | `/complaints` | CZ and staff | Returns `trackingId` |
| GET | `/complaints` | any | Scope is forced by role: CZ own · FW assigned · DM department · OA all |
| GET | `/complaints/:id` | per scope | 404 outside scope |
| PATCH | `/complaints/:id` | reporter while `REPORTED`; OA/DM (priority, category) | |
| POST | `/complaints/:id/status` | per transition table | Body `{ status, note }` |
| POST | `/complaints/:id/assign` | OA, DM | `{ departmentId, workerId?, note? }` |
| POST | `/complaints/:id/assignment/accept` | assigned FW | |
| GET/POST | `/complaints/:id/comments` | per scope | `isInternal` only for staff; citizens never see internal notes |
| GET/POST | `/complaints/:id/attachments` | per scope | multipart, images only |
| GET | `/complaints/:id/attachments/:attachmentId/url` | per scope | Short-lived signed URL |
| POST | `/complaints/:id/reopen` | reporter, OA | Within the reopen window |
| POST | `/complaints/:id/feedback` | reporter | Once, after `RESOLVED`/`CLOSED` |
| GET | `/complaints/:id/history` | per scope | |

### Tracking (public)

| Method | Path | Notes |
| ------ | ---- | ----- |
| GET | `/tracking/:trackingId` | Returns status, category, organization and department **names**, coarse location text, public timeline, resolution photo URLs. Never returns reporter identity, internal notes, staff names, exact coordinates or internal IDs. |

### Notifications

| Method | Path |
| ------ | ---- |
| GET | `/notifications` (`?unread=true`) |
| GET | `/notifications/unread-count` |
| POST | `/notifications/:id/read` |
| POST | `/notifications/read-all` |

### Search, analytics, audit

| Method | Path | Access |
| ------ | ---- | ------ |
| GET | `/search/complaints` | OA, DM, FW (scoped) — `q`, `status`, `categoryId`, `departmentId`, `priority`, `near=lat,lng`, `radiusKm`, paging, highlights |
| GET | `/analytics/overview` | OA, DM (own department) |
| GET | `/analytics/departments` | OA |
| GET | `/analytics/categories` | OA, DM |
| GET | `/analytics/trends` | OA, DM — `?months=12` |
| GET | `/analytics/hotspots` | OA, DM — grid-aggregated coordinates |
| GET | `/audit-logs` | OA (own organization), SA |

### Operations (outside `/api/v1`)

| Path | Purpose |
| ---- | ------- |
| `/healthz` | Liveness — process is up |
| `/readyz` | Readiness — database reachable; reports optional dependencies without failing on them |
| `/metrics` | Prometheus exposition (network-restricted in production) |
| `/api/docs` | Swagger UI (disabled in production unless `API_DOCS_ENABLED=true`) |
