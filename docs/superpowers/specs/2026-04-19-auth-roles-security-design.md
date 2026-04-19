# Auth, Roles, and Security Foundation — Design

**Date:** 2026-04-19
**Scope:** Slice 1 of a phased BuildCheck rebuild in the Clearance codebase. Foundation layer: authentication, authorization, user lifecycle, and security primitives.
**Status:** Approved for implementation planning.

---

## 1. Context

### 1.1 Source material

This design derives from `C:\Users\yosefh\Downloads\PRD.md` — the BuildCheck AI v2 PRD — re-planned for the Clearance codebase. The PRD is large (seven independent subsystems: auth/tenancy, projects+uploads, DXF pipeline, PDF/OCR pipeline, core compliance agent, add-on agents, chat+admin+renders). We are splitting the rebuild into phased specs. **This spec covers only slice 1: auth + roles + security.**

### 1.2 Codebase state at spec time

Clearance is an early scaffold. Two git submodules:

- **server**: Express 5 + TypeScript, Prisma v7 + `@prisma/adapter-pg`, Zod, Helmet, `express-rate-limit`, morgan, winston. Layered architecture per [server/CLAUDE.md](../../../server/CLAUDE.md): Controller → Service → Data Access. The Prisma schema ([server/prisma/schema.prisma](../../../server/prisma/schema.prisma)) is empty (generator + datasource only). The only route is `/health`.
- **client**: React 19 + Vite 8 + Tailwind v4 + shadcn + base-ui + lucide. No routing, HTTP client, or server-state library installed yet.

This spec introduces the first real feature surface into both.

### 1.3 Non-goals for slice 1

Explicit out of scope, deferred to later specs:

- `Company` / multi-tenancy (removed entirely — see §2.1)
- Self-registration (removed entirely)
- `Project`, `DxfFile`, `TavaFile`, `AddonDocument`, `Analysis`, `AddonRun`, `ChatMessage` models
- File uploads, multer integration
- Python DXF pipeline and PDF/OCR pipeline
- Anthropic integration, compliance agent, add-on agents
- Hebrew / RTL UI (this slice's UI is admin-facing and minimal)
- Email flows (no forgot-password email; admin reset is the only path)
- Refresh tokens, token-version, login history, search, audit log UI
- Job queue (`BullMQ`), Python HTTP sidecar, S3 storage

Some of the above are recorded in §9 (Target Architecture) as the north star for later slices. They are **not implemented in slice 1**.

---

## 2. Decisions (locked during brainstorm)

Each sub-section records a decision, the alternatives considered, and the rationale. This is the canonical record — if implementation diverges, update this document.

### 2.1 Tenancy model — dropped

**Decision:** No `Company` table. No multi-tenancy. The system has one tenant.

**Alternatives considered:**
- PRD default: self-service registration creates a `Company`, user is its `ADMIN`, invites `MEMBER`s scoped to that company.
- Global super-admin + per-company admins (three tiers).
- Per-company admins only, with seeded first admin (no self-registration).

**Rationale:** User intent is a single built-in administrator, not a SaaS with customer companies. Dropping tenancy removes the `companyId` foreign key from every downstream model, removes the transitive `projectWhereClause(user)` middleware, and simplifies authorization to "owner or admin." Multi-tenancy is a non-trivial change to bolt back on; we accept that cost if BuildCheck ever pivots to SaaS.

### 2.2 Role model

**Decision:** Two roles, both immutable after creation.

| Role    | Creation path                          | Demotion | Promotion | Self-creation |
|---------|----------------------------------------|----------|-----------|---------------|
| `ADMIN` | Env-seeded at server boot              | Never    | Never     | No            |
| `USER`  | Created only by an `ADMIN` via the API | Never    | Never     | No            |

**Invariants:**
- Exactly one admin in v1 (seeded from env).
- `ADMIN` rows are managed only by the boot-time seeder. No API endpoint creates, deletes, modifies, or toggles active state on an `ADMIN`.
- No `role` field on any API request payload. Zod schemas use `.strictObject(...)` to reject unknown fields.
- No public registration endpoint (`POST /api/auth/register` does not exist).

**Alternatives considered:**
- Per-company ADMIN/MEMBER (PRD default) — rejected with §2.1.
- Promotable role (user can become admin later) — rejected; "hardcoded admin" semantics chosen.
- Multiple admins from a config list — rejected for v1; single admin is enough. Revisit if an operational deputy is ever needed (§9).

### 2.3 Admin seeding

**Decision:** Boot-time idempotent create from environment variables.

**Env vars (added to [server/src/utils/env.ts](../../../server/src/utils/env.ts) Zod schema):**
- `ADMIN_EMAIL` (required, valid email format)
- `ADMIN_INITIAL_PASSWORD` (required, min 8 chars)
- `JWT_SECRET` (required, min 32 chars of entropy)

**Seeder behavior** (`server/src/bootstrap/seed-admin.ts`, runs before `app.listen()`):

1. Look up user by `ADMIN_EMAIL`.
2. **If not found:** bcrypt-hash `ADMIN_INITIAL_PASSWORD` (cost 10), insert with `role=ADMIN`, `isActive=true`. Write `auditLog('admin.seeded', { entityId: newUser.id })`.
3. **If found and `role=ADMIN` and `isActive=true`:** no-op.
4. **If found but `role!=ADMIN` or `isActive=false`:** repair drift — update to `role=ADMIN`, `isActive=true`. Log `admin_seeder.drift_repaired` at warn level. Note: this is the **only** place in the system that mutates a user's `role`; the role-immutability invariant in §2.2 applies to API flows. The seeder is the sole exception and only in this repair direction (USER → ADMIN for the env-identified row).
5. **Never** overwrites `passwordHash` of an existing row. Rotating `ADMIN_INITIAL_PASSWORD` in env has no effect after first boot. The admin rotates their password via `POST /api/auth/change-password`.
6. On any failure: exit 1 (container restart). Running without a confirmed admin is never desirable.

**Recovery procedure** (loss of admin password) documented in `docs/vault/30-Server/Auth - Admin Seeder.md`:
1. SSH to box, `docker exec -it postgres psql`.
2. Pre-compute a bcrypt hash (e.g., in a Node REPL or via `npx bcrypt-cli`).
3. `UPDATE "User" SET "passwordHash" = '$2b$10$...' WHERE email = '<admin-email>';`.

### 2.4 Session strategy

**Decision:** HttpOnly cookie carrying a JWT. 7-day TTL.

**Cookie (production):**
```
Set-Cookie: auth=<jwt>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800
```

**Cookie (dev, `NODE_ENV !== 'production'`):** `Secure` flag omitted so local HTTP works. All other flags identical.

**JWT payload** — minimal, identity-anchor only:
```ts
{ sub: userId, iat, exp }
```
No role, no email, no isActive — those are read fresh from the DB on every authenticated request (see §2.5).

**Alternatives considered:**
- `Authorization: Bearer <token>` + localStorage (PRD default) — rejected; XSS-exfiltration risk is the dominant threat and cookies close it.
- Short-lived access + refresh token split — rejected as over-engineered for v1. Can be added later without changing the cookie-based client contract.

**CSRF:** `SameSite=Strict` neutralizes CSRF for first-party flows. No anti-CSRF token needed. If we ever add a third-party embed or a public share link, revisit.

**CORS** ([server/src/app.ts](../../../server/src/app.ts)): `cors({ origin: env.CORS_ORIGIN, credentials: true })`. Dev must name the exact client origin (e.g., `http://localhost:5173`) — wildcard `*` is incompatible with `credentials: true`. Dev proxy via Vite keeps cookies same-origin (see §6.5).

### 2.5 Session invalidation

**Decision:** Approach 2 — auth middleware does a DB lookup per authenticated request.

**Middleware flow** (`server/src/middlewares/auth.middleware.ts`):
1. Read `req.cookies.auth`. Missing → 401.
2. `jwt.verify(cookie, JWT_SECRET)`. Expired or invalid signature → 401.
3. `usersDa.findById(payload.sub)`. Missing → 401 + clear cookie.
4. If `user.isActive === false` → 401 + clear cookie.
5. Attach `req.user = { id, email, name, role }` and proceed.

**Consequence accepted:** password reset does **not** force-log-out other sessions of that user. The new password works immediately on next login; the old cookie keeps working until its 7-day TTL. Rejected: adding a `tokenVersion` column (Approach 3) — scoped out of v1 because the realistic threat model (admin rotating a lost password for a trusted employee, not a hostile takeover) doesn't justify the extra complexity.

**Consequence delivered:** `admin.user.delete` and `admin.user.active(false)` are **instant** — the next request from that user's browser fails at step 3 or 4, and the cookie is cleared. No 7-day wait.

### 2.6 Password policy and brute-force defense

- Bcrypt cost **10** (per PRD; adequate security, tolerable latency at login).
- Minimum password length **8 chars**. No complexity rules (NIST SP 800-63B — length beats complexity; users pick worse passwords when forced into complexity rules).
- **Generic `"Invalid credentials"`** for all login failures: unknown email, wrong password, disabled account. No email enumeration.
- **Per-IP rate limit on `/api/auth/login`**: 10 attempts / 15 minutes, keyed on `req.ip`. Separate `express-rate-limit` instance from the global limiter. Returns 429 on exceed.
- **No per-email lockout** in v1 (rejected Approach C). Revisit if logs show distributed brute-force patterns.

### 2.7 Admin operations — the complete surface

**Admin can:** list users, create user (role always USER), delete user (blocks ADMIN and self), reset user's password (blocks ADMIN), toggle user active state (blocks ADMIN and self).

**Admin cannot** (hard-coded, not just missing endpoint): promote users, demote admins, change user emails/names, edit their own profile via admin endpoints.

**User can:** change their own password.

**User cannot:** change their email or name, change their own active state, view other users.

**Explicitly dropped:** login history, user search, email change, soft-delete of users.

### 2.8 Data — files as entities, bytes on disk

Not used in slice 1 directly, but the decision is recorded here because it shapes slice 2 (`Project`, `DxfFile`, `TavaFile`).

**Decision:** File bytes go to disk (`uploads/<kind>/...` locally, `s3://...` later). DB stores metadata only, via a single `StoredFile` model (§9.2). Never store raw bytes in Postgres.

**Rationale:** DXF up to 100 MB and PDF up to 50 MB rule out bytea. On-disk storage plays nicely with `sendfile()` for thumbnail serving, streams for multer uploads, and trivial S3 migration via a `store` column.

---

## 3. Data Model

### 3.1 Prisma schema additions

To [server/prisma/schema.prisma](../../../server/prisma/schema.prisma):

```prisma
enum UserRole {
  ADMIN
  USER
}

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  name         String
  passwordHash String
  role         UserRole @default(USER)
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([email])
}

model AuditLog {
  id        String   @id @default(cuid())
  actorId   String?
  event     String
  entity    String?
  entityId  String?
  metadata  Json?
  createdAt DateTime @default(now())

  @@index([actorId, createdAt])
  @@index([entity, entityId])
}
```

**Design notes:**

- `cuid()` over `uuid()` — sortable, Prisma-native, smaller. No existing code depends on UUID v4 format.
- `email @unique` enforces collision at the DB level; the service layer does not race.
- The `@@index([email])` alongside `@unique` is belt-and-suspenders for read patterns.
- `AuditLog.actorId` is nullable to record events with no actor (e.g., `admin.seeded`, system-triggered).
- `AuditLog.metadata Json?` holds free-form context (IP, target entity id, redacted diff).
- No foreign key from `AuditLog.actorId` to `User.id` — audit rows outlive users. The application enforces the relationship loosely.

**Migrations:** `npm run db:migrate` against a dev DB. CI uses `prisma migrate deploy` (CI already handles the `DIRECT_URL` quirk per [server/CLAUDE.md](../../../server/CLAUDE.md)).

### 3.2 Audit events emitted in slice 1

Exhaustive list — slice 1's observability surface:

| Event                         | Actor         | Entity      | Metadata keys         |
|-------------------------------|---------------|-------------|-----------------------|
| `admin.seeded`                | `null`        | user id     | `email`               |
| `user.login`                  | user id       | user id     | `ip`                  |
| `user.login.failed`           | `null`        | —           | `email` (as attempted), `ip` |
| `user.logout`                 | user id       | user id     | `ip`                  |
| `user.change_password`        | self          | self        | `ip`                  |
| `admin.user.create`           | admin id      | new user id | `email`, `name`       |
| `admin.user.delete`           | admin id      | user id     | `email`               |
| `admin.user.reset_password`   | admin id      | user id     | `email`               |
| `admin.user.set_active`       | admin id      | user id     | `isActive`            |

Writes are best-effort: `audit-log.service.ts` catches any insert failure, logs to winston at `error` level, and returns — does not propagate. An audit write failure must never block a user operation.

---

## 4. API Surface

All routes under `/api`. Request bodies validated with Zod via the existing `validate()` middleware. Response shape: `{ data: ... }` on success, `{ error, details? }` on failure (per [server/CLAUDE.md](../../../server/CLAUDE.md)).

### 4.1 Public (unauthenticated)

| Method | Path                | Request                          | Response                                  |
|--------|---------------------|----------------------------------|-------------------------------------------|
| POST   | `/api/auth/login`   | `{ email, password }`            | `{ data: { user } }` + `Set-Cookie: auth` |
| POST   | `/api/auth/logout`  | —                                | `{ data: { ok: true } }` + cookie cleared |

- `POST /api/auth/login` has its own rate limiter instance (10/15m per IP).
- `POST /api/auth/logout` is idempotent and works without a cookie (returns 200).

### 4.2 Authenticated (any role)

| Method | Path                          | Request                                 | Response                                                   |
|--------|-------------------------------|-----------------------------------------|------------------------------------------------------------|
| GET    | `/api/auth/me`                | —                                       | `{ data: { user: { id, email, name, role } } }`            |
| POST   | `/api/auth/change-password`   | `{ currentPassword, newPassword }`      | `{ data: { ok: true } }`                                   |

- `change-password` verifies `currentPassword`; 401 on mismatch.
- `newPassword` Zod-validated for min 8 chars.
- Does **not** rotate the cookie (see §2.5).

### 4.3 Admin-only (`auth` then `requireAdmin`)

| Method | Path                                         | Request                          | Response                         |
|--------|----------------------------------------------|----------------------------------|----------------------------------|
| GET    | `/api/admin/users`                           | query `?q=&limit=&cursor=`       | `{ data: { users, nextCursor } }`|
| POST   | `/api/admin/users`                           | `{ email, name, initialPassword }` | `{ data: { user } }`           |
| DELETE | `/api/admin/users/:id`                       | —                                | `{ data: { ok: true } }`         |
| POST   | `/api/admin/users/:id/reset-password`        | `{ newPassword }`                | `{ data: { ok: true } }`         |
| PATCH  | `/api/admin/users/:id/active`                | `{ isActive: boolean }`          | `{ data: { user } }`             |

**Service-enforced invariants** (duplicated here for clarity, also in §2.7):

1. Any admin endpoint targeting a user with `role=ADMIN` returns **403** with message `"admin_target_forbidden"`. This is enforced in the service, not middleware — so even a malformed call path cannot bypass it.
2. Request schemas use `z.strictObject(...)` — a `role` field in the body 400s. Even if it didn't, the service hard-codes `role: 'USER'` on insert.
3. `admin.delete` rejects `:id === req.user.id` with 403.
4. `admin.active(false)` rejects `:id === req.user.id` with 403.
5. Every mutating admin endpoint calls `auditLog.record(...)` on success, before the response is sent.
6. `DELETE`, `reset-password`, and `active-toggle` all return **404** if `:id` does not resolve to any user (before the admin-target check). The admin-target check precedes self-target check in the service — order: exists → is-admin-target → is-self-target → proceed.
7. `POST /api/admin/users` returns **409** if `email` already exists (the admin's email included — the DB's `@unique` constraint surfaces as a 409 via Prisma error code `P2002`; the service catches and rethrows as `HttpError(409, 'email_in_use')`).
8. `POST /api/admin/users` validates `initialPassword` with min 8 chars via Zod (same rule as user passwords generally). `POST /api/admin/users/:id/reset-password` applies the same validation to `newPassword`.

**Pagination:** `GET /admin/users` returns a cursor-paginated list. Default `limit=50`, max `limit=200`. Cursor is the last item's `createdAt + id`. Works fine for small user counts and scales if the admin seat count grows.

### 4.4 Error format

Unchanged from existing middlewares ([server/src/middlewares.ts:39](../../../server/src/middlewares.ts)):
```json
{ "error": "Invalid data", "details": [{ "message": "body.email is Invalid email" }] }
```
`HttpError` throws still produce `{ message: "..." }` with the appropriate status code.

### 4.5 Endpoints explicitly NOT in slice 1

- `POST /api/auth/register` — no self-registration
- `POST /api/auth/forgot-password` — no email flow
- `PATCH /api/admin/users/:id/role` — roles are immutable
- `GET /api/admin/audit-log` — admin-facing audit UI deferred to a later spec

---

## 5. Server Structure

### 5.1 Folder layout

New additions under `server/src/`:

```
server/src/
├── api/
│   ├── controllers/
│   │   ├── auth.controller.ts
│   │   └── admin-users.controller.ts
│   ├── services/
│   │   ├── auth.service.ts
│   │   ├── admin-users.service.ts
│   │   └── audit-log.service.ts
│   ├── data-access/
│   │   ├── user.da.ts
│   │   └── audit-log.da.ts
│   ├── routes/
│   │   ├── auth.routes.ts
│   │   ├── admin-users.routes.ts
│   │   └── index.ts                    # mounts both under /api
│   └── schemas/
│       ├── auth.schema.ts
│       └── admin-users.schema.ts
├── integrations/                       # NEW layer
│   ├── auth-cookie.ts
│   └── password.ts
├── middlewares/                        # refactor of middlewares.ts into folder
│   ├── index.ts                        # re-exports (back-compat)
│   ├── auth.middleware.ts
│   ├── require-admin.middleware.ts
│   ├── request-id.middleware.ts
│   ├── validate.middleware.ts          # moved
│   ├── error-handler.middleware.ts     # moved
│   └── not-found.middleware.ts         # moved
└── bootstrap/
    └── seed-admin.ts
```

The refactor of `middlewares.ts → middlewares/` preserves import paths through `middlewares/index.ts` (the existing `import * as middlewares from './middlewares'` in [server/src/app.ts](../../../server/src/app.ts) keeps working).

### 5.2 Integrations layer

Thin adapters over external primitives. Services import from here; they never reach directly for `jsonwebtoken`, `bcryptjs`, `cookie-parser`.

```ts
// integrations/auth-cookie.ts
export function signToken(userId: string): string;
export function verifyToken(token: string): { sub: string } | null;
export function setAuthCookie(res: Response, userId: string): void;
export function clearAuthCookie(res: Response): void;

// integrations/password.ts
export function hash(plaintext: string): Promise<string>;
export function compare(plaintext: string, hash: string): Promise<boolean>;
```

`setAuthCookie` reads `NODE_ENV` to toggle the `Secure` flag; services do not repeat this check.

### 5.3 Middleware pipeline

Global order in [server/src/app.ts](../../../server/src/app.ts):

```
requestId              (NEW — generates cuid, attaches to req.id and X-Request-Id header)
morgan                 (updated format to include :req[id])
helmet
cors({ credentials: true })
rateLimiter (global)
cookieParser           (NEW)
express.json()
[routes]
notFound
errorHandler
```

Per-route chain for a typical admin endpoint:

```
auth → requireAdmin → validate(schema) → controller
                                             └─ service → data-access
```

Login route prefixes the chain with its dedicated rate-limiter instance; `auth` and `requireAdmin` are not present on the login route.

### 5.4 Types

`server/src/types/express.d.ts` (or extend the existing [server/src/types/](../../../server/src/types/)):

```ts
declare global {
  namespace Express {
    interface Request {
      id: string;
      user?: {
        id: string;
        email: string;
        name: string;
        role: 'ADMIN' | 'USER';
      };
    }
  }
}
```

An `AuthenticatedRequest` alias used by controllers that run after `auth` avoids `req.user!` assertions.

### 5.5 Dependencies added

To `server/package.json`:
- `bcryptjs`, `@types/bcryptjs`
- `jsonwebtoken`, `@types/jsonwebtoken`
- `cookie-parser`, `@types/cookie-parser`

---

## 6. Client Structure

### 6.1 Dependencies added

To [client/package.json](../../../client/package.json):
- `axios`
- `@tanstack/react-query`
- `react-router-dom`
- `react-hook-form`
- `zod` (for client-side form schemas)

### 6.2 Folder additions

Under [client/src/](../../../client/src/):

```
client/src/
├── api/
│   ├── client.ts                 # axios instance: baseURL '/api', withCredentials: true
│   ├── auth.api.ts               # login, logout, me, changePassword
│   └── admin-users.api.ts        # list, create, delete, resetPassword, setActive
├── hooks/
│   ├── useAuth.ts                # useQuery(me) + login/logout mutations
│   └── useAdminUsers.ts          # list + mutation hooks
├── components/
│   ├── ProtectedRoute.tsx
│   └── RequireRole.tsx
├── pages/
│   ├── LoginPage.tsx
│   ├── AdminUsersPage.tsx
│   ├── ChangePasswordPage.tsx
│   └── HomePage.tsx
└── providers/
    └── QueryClientProvider.tsx
```

### 6.3 Auth state pattern

`useAuth()` is the only source of "who is the current user":

```ts
const meQuery = useQuery({
  queryKey: ['auth', 'me'],
  queryFn: () => authApi.me(),
  retry: false,
  staleTime: 5 * 60 * 1000,
});
```

- No token ever touches client state. The cookie is the session.
- axios response interceptor: on 401, invalidate `['auth', 'me']` and redirect to `/login`.
- Login mutation success: `queryClient.setQueryData(['auth', 'me'], user)`.
- Logout mutation success: `queryClient.clear()` + navigate to `/login`.
- `useAuth().user?.role === 'ADMIN'` gates admin UI. Real enforcement stays server-side.

### 6.4 Routes

| Path                | Gate                 | Page                   |
|---------------------|----------------------|------------------------|
| `/login`            | public               | `LoginPage`            |
| `/`                 | authenticated        | `HomePage`             |
| `/change-password`  | authenticated        | `ChangePasswordPage`   |
| `/admin/users`      | admin-only           | `AdminUsersPage`       |

### 6.5 Dev environment

Vite proxy in [client/vite.config.ts](../../../client/vite.config.ts):
```ts
server: { proxy: { '/api': 'http://localhost:3001' } }
```
Cookies stay same-origin in dev; `SameSite=Strict` works without special handling. Production is already same-origin via the nginx plan.

### 6.6 Shared schemas

Client and server each own their own Zod schema for every endpoint. Each client schema file carries a comment:

```ts
// Keep in sync with server/src/api/schemas/auth.schema.ts
```

Extraction into a shared submodule is deferred until ≥3 schemas are shared, or until drift causes a real bug — whichever comes first.

---

## 7. Testing

Matches the existing Jest pattern ([server/src/api/controllers/healthCheck.controller.test.ts](../../../server/src/api/controllers/healthCheck.controller.test.ts)).

### 7.1 Unit tests (Jest, `npm test`)

- `integrations/password.ts` — hash/compare roundtrip.
- `integrations/auth-cookie.ts` — sign/verify roundtrip, reject tampered signature, reject expired token.
- `services/auth.service.ts` — login happy path; unknown-email, wrong-password, disabled-user, and malformed-input all produce the same generic 401.
- `services/admin-users.service.ts` — covers each invariant in §4.3: admin target rejected, `role` field ignored, self-delete rejected, self-disable rejected.
- `middlewares/auth.middleware.ts` — missing cookie / expired / tampered / disabled user / deleted user each return 401 and clear cookie.
- `bootstrap/seed-admin.ts` — no-op when admin exists, creates when missing, repairs drift.

### 7.2 Integration tests (`npm run test:integration`, existing jest.integration.config.js)

- Full login + authenticated request + logout round-trip with a real DB.
- Admin creates user → user logs in → admin disables → user's next request is rejected.
- Admin delete → user row gone, audit row present.
- Rate limiter on `/api/auth/login` → 11th request in window returns 429.

### 7.3 Client tests (Vitest — configured in `client/package.json`)

- `useAuth` hook — sets query data on login, clears on logout.
- `ProtectedRoute` — redirects when `me` returns 401.
- `RequireRole` — blocks rendering when role mismatches.
- Integration / Playwright coverage deferred; can be added as smoke tests post-implementation.

---

## 8. Documentation — Knowledge Vault

Per the project [CLAUDE.md](../../../CLAUDE.md), vault pages must be updated in the same change. New or updated pages under `docs/vault/`:

```
docs/vault/
├── 30-Server/
│   ├── Auth - Login Flow.md
│   ├── Auth - Middleware Chain.md
│   └── Auth - Admin Seeder.md
├── 35-API/
│   ├── POST api_auth_login.md
│   ├── POST api_auth_logout.md
│   ├── GET  api_auth_me.md
│   ├── POST api_auth_change-password.md
│   ├── GET  api_admin_users.md
│   ├── POST api_admin_users.md
│   ├── DELETE api_admin_users_id.md
│   ├── POST api_admin_users_id_reset-password.md
│   └── PATCH api_admin_users_id_active.md
├── 40-Data/
│   ├── Model - User.md
│   └── Model - AuditLog.md
├── 50-Flows/
│   ├── Login and Session.md
│   └── Admin Creates User.md
└── 00-Index/
    ├── API MOC.md            # updated
    ├── Data MOC.md           # updated
    ├── Server MOC.md         # updated
    └── Home.md               # updated
```

All pages written with `obsidian:obsidian-markdown` conventions — frontmatter (title, type, tags), wikilinks between related pages, callouts where relevant.

---

## 9. Target Architecture (context for later slices)

Recorded here so later specs can reference decisions made during this brainstorm. **Not implemented in slice 1** — only the pieces called out in §9.5.

### 9.1 Normalize JSON blobs in future models

The PRD stores `TavaFile.requirements`, `Analysis.coreResults`, `AddonRun.results`, `DxfFile.renderedImages` as JSONB arrays. Future specs will pull them into normal tables:
- `Requirement` (FK → `TavaFile`)
- `ComplianceResult` (FK → `Analysis` or `AddonRun` via discriminator)
- `RenderedImage` (FK → `DxfFile`)

Keep `extractedText` and `extractedData` as JSON (write-once read-once).

### 9.2 Unified file storage

Single `StoredFile` model (recorded here, implemented in the projects/uploads slice):

```prisma
enum FileKind   { DXF TAVA ADDON RENDER }
enum FileStore  { LOCAL S3 }

model StoredFile {
  id           String    @id @default(cuid())
  kind         FileKind
  store        FileStore @default(LOCAL)
  uri          String
  originalName String
  sizeBytes    Int
  sha256       String
  createdAt    DateTime  @default(now())

  @@index([sha256])
}
```

`Project`, `AddonDocument`, `DxfFile.renders` all reference `StoredFile`. Switching to S3 is a `store + uri` change, not a migration sweep. `sha256` enables "skip re-extract if unchanged."

### 9.3 Job abstraction from day one

The PRD's in-process orchestrator becomes a `JobRunner` interface:

```ts
interface JobRunner {
  enqueue(type: string, payload: Json): Promise<{ jobId: string }>;
  getStatus(jobId: string): Promise<JobStatus>;
  cancel(jobId: string): Promise<void>;
}
```

v1 implementation: DB-backed `Job` table + Node polling worker. v2: swap to BullMQ+Redis without touching controllers. The abstraction must exist from the first analysis spec.

### 9.4 Python as an HTTP sidecar

Instead of `execFile('python3 extractor.py ...')` per analysis: a small FastAPI service (own container) exposes `POST /extract` and `POST /render`. Node calls via `fetch`. Warm interpreter, canonical UTF-8 over HTTP, cancellable, testable. Resolves the surrogate-pair-over-stdout class of bug entirely.

### 9.5 Slices of §9 delivered in slice 1

- `AuditLog` table and `audit-log.service.ts` (we log auth + admin events immediately).
- `request-id.middleware.ts` (correlation IDs used by every service from day one).
- `integrations/` folder with `auth-cookie.ts` + `password.ts` (establishes the adapter pattern before more integrations exist).

`StoredFile`, `JobRunner`, Python sidecar, integrations for `anthropic.client.ts` and `python-sidecar.client.ts` — all deferred.

### 9.6 Other conventions adopted

- **Prisma interactive transactions** (`prisma.$transaction(async tx => {...})`) for any multi-step write. Slice 1 has no multi-step writes; convention established for later specs.
- **Structured winston logs** — `{ reqId, userId, route, event, ms }` JSON shape. `request-id.middleware.ts` sets up the correlation; services and middlewares log with it.
- **Client server-state** — every API call goes through TanStack Query. No raw `axios` calls inside components.

---

## 10. Open Questions / Future Work

Explicitly deferred, tracked here so they don't get lost:

1. Multi-admin support (reconcile multiple emails from `ADMIN_EMAILS`). Trivial extension of the seeder.
2. Audit-log UI for the admin page (read-only table, filterable by event/actor/entity).
3. Per-email login lockout after N failures, if logs show distributed brute-force signal.
4. Token version / epoch column for forced-logout-on-password-reset, if the threat model tightens.
5. Refresh token flow if session length requirements diverge from fixed 7-day.
6. Shared-schema package between client and server once ≥3 schemas are shared.
7. Playwright end-to-end smoke covering login → admin-create-user → new-user-login → admin-disable.

---

## 11. Approval

Design approved by the user during the brainstorming session on 2026-04-19. This document is the canonical record. Drift from this spec must be corrected either in code or in this file — not silently tolerated.

Next step: produce an implementation plan via the `superpowers:writing-plans` skill, breaking this design into discrete, reviewable tasks.
