# Security Design

## 1. Threat model

| Asset | Threat | Primary control |
| ----- | ------ | --------------- |
| Accounts | Credential stuffing, brute force | Argon2id, per-IP and per-account rate limits, generic errors |
| Sessions | Theft, fixation, CSRF | Opaque random token, hashed at rest, httpOnly cookie, rotation on login, custom-header CSRF check |
| Tenant data | Cross-organization access (IDOR) | Active-organization scoping + PostgreSQL RLS; 404 for foreign IDs |
| Complaints | Unauthorized status manipulation | Transition table keyed by role and relationship; row lock; immutable history |
| Reporter privacy | Leakage through public tracking | Dedicated response schema with an allow-list of fields; unguessable IDs; rate limit |
| Uploads | Malware, oversized files, content sniffing | Magic-byte detection, size cap, re-encode with sharp, random keys, signed URLs |
| Secrets | Leakage via repo or logs | Env-only secrets, validated at boot, log redaction, secret scanning in CI |

## 2. Authentication

- **Passwords:** Argon2id (`@node-rs/argon2`; 19 MiB memory, 2 iterations, parallelism 1
  — the OWASP baseline, chosen to fit small containers). Minimum 10 characters, maximum
  128. Hashes are rehashed on login when parameters change.
- **Sessions:** 32 random bytes, base64url. The database stores only the SHA-256 digest,
  so a database leak does not yield usable sessions. 7-day sliding expiry, 30-day
  absolute. Login always creates a new session (no fixation). Password change or reset
  revokes all other sessions.
- **Cookie:** `cp_session`; `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production.
- **Enumeration:** login failure and password-reset request return the same response
  whether or not the account exists. Login verifies against a dummy hash for unknown
  emails to equalize timing.
- **Reset tokens / invitations:** random, hashed at rest, single use, 1 hour / 7 days.

## 3. Authorization

Two layers, both required:

1. **Role permission** — a static matrix in `packages/shared/src/permissions.ts`
   (`role → permission[]`), checked by a route guard.
2. **Relationship** — the service checks the actor's relation to the resource: a citizen
   only their own complaints, a field worker only complaints assigned to them, a
   department manager only their department.

Beneath both sits **row-level security** (see DATABASE_DESIGN.md §6). A bug in layer 1
or 2 cannot cross an organization boundary because the database refuses the rows.

Resources outside the caller's scope return `404`, not `403`, to avoid confirming that
an ID exists.

## 4. CSRF, CORS, headers

- Mutating requests require `X-Requested-With: civicpulse`; when `Origin` is present it
  must be in `ALLOWED_ORIGINS`. Combined with `SameSite=Lax` this blocks cross-site
  form posts and cross-site fetches.
- CORS is off by default (the web app proxies the API on its own origin). When enabled,
  origins come from `ALLOWED_ORIGINS`; wildcards are rejected when credentials are on.
- `@fastify/helmet` on the API; the web app sets a Content-Security-Policy,
  `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` and frame denial.

## 5. Input and output

- Every route declares Zod schemas for params, query and body; unknown keys are stripped.
- All SQL is parameterized through Drizzle. No string-built SQL from user input; search
  input goes through `websearch_to_tsquery` or the OpenSearch query DSL.
- React escapes output by default. No `dangerouslySetInnerHTML` on user content. Search
  highlights are returned as offsets/segments, not HTML.
- Response schemas are declared too, so a handler cannot accidentally serialize a
  column such as `password_hash`.

## 6. File uploads

1. Authenticated multipart upload to the API (not a raw presigned PUT, so the server can
   inspect content).
2. Size cap 8 MB per file, 5 files per complaint request; enforced while streaming.
3. Type determined from **magic bytes** (JPEG, PNG, WebP); the client-supplied MIME type
   and filename are ignored.
4. Image is decoded and re-encoded with sharp, which drops EXIF (including GPS) and
   neutralizes polyglot files; decode failure rejects the upload. Pixel limit guards
   against decompression bombs.
5. Stored under a random key `org/<orgId>/complaints/<complaintId>/<uuid>.webp`.
   Buckets are private.
6. Reads use signed URLs with a 5-minute TTL (S3 presign, or HMAC for the local driver),
   issued only after an authorization check.

## 7. Rate limiting

Redis-backed fixed window with an in-memory fallback. Keys combine route group and
IP (and user ID when authenticated). Limits are listed in API_SPECIFICATION.md.
Behind a proxy, `TRUST_PROXY` must be set correctly or all clients share one IP.

## 8. Logging and audit

- Structured JSON logs (pino) with request ID, user ID and organization ID.
- Redacted paths: `authorization`, `cookie`, `set-cookie`, `password`, `currentPassword`,
  `newPassword`, `token`, `*.passwordHash`, signed URLs.
- `audit_logs` records logins (success and failure), logouts, password changes, role and
  membership changes, invitations, organization and department changes, every complaint
  status change and assignment, and account deletion. The table is append-only.

## 9. Secrets and configuration

- All configuration is parsed by one Zod schema at process start; the process exits on
  invalid or missing values rather than running misconfigured.
- `.env` files are git-ignored; `.env.example` contains names and safe defaults only.
- Production refuses to start with development defaults for `SESSION_SECRET` /
  `STORAGE_SIGNING_SECRET`.
- Kubernetes: values come from `Secret` objects referenced by the Helm chart; the chart
  never contains secret values. CI uses GitHub Actions secrets; images contain none.

## 10. Public tracking

- Tracking IDs are `CP-` + 10 random Crockford base32 characters (50 bits). They are
  not sequential and cannot be enumerated at the permitted request rate.
- The endpoint returns a purpose-built DTO. Excluded: reporter name/email/phone, staff
  names, internal notes, exact coordinates, internal UUIDs, original photos from the
  reporter (only resolution evidence is shown).
- Organizations can disable public tracking entirely.

## 11. Data retention and account deletion

See DATABASE_DESIGN.md §8. Deletion anonymizes the user and revokes all access while
keeping the organization's complaint record intact. A daily job enforces retention.

## 12. Known limitations (v1)

- No multi-factor authentication.
- Email verification is not enforced before first login.
- `SET LOCAL ROLE`-based RLS guards against application bugs, not against an attacker
  who can run arbitrary SQL on the connection.
- Uploaded images are not virus-scanned; they are re-encoded, which removes non-image
  payloads.
