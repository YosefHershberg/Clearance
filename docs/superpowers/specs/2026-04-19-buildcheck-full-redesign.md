# BuildCheck AI — Full Redesign for the Clearance Codebase

**Date:** 2026-04-19
**Status:** Approved for implementation planning.
**Supersedes:** `2026-04-19-auth-roles-security-design.md` (which covered only the auth slice).

This spec is the canonical end-to-end design for rebuilding BuildCheck AI in the Clearance codebase. It covers every subsystem: identity, projects, file storage, DXF/PDF pipelines, compliance agents, chat, and the job queue. Implementation is phased (§13) but the design is unified.

---

## 1. Context

### 1.1 Source material

Derived from `C:\Users\yosefh\Downloads\PRD.md` (BuildCheck AI v2 PRD) and the working prototype at `C:\Users\yosefh\OneDrive - hms.co.il\Desktop\plan_analyzer_ai`. This spec departs from the PRD/prototype in several deliberate ways (see §2 for decisions, §3.12 for a change summary).

### 1.2 Codebase at spec time

Two git submodules under `clearance/`:
- **server** ([server/CLAUDE.md](../../../server/CLAUDE.md)): Express 5 + TypeScript, Prisma v7 + `@prisma/adapter-pg`, Zod, Helmet, `express-rate-limit`, morgan, winston. Layered Controller → Service → Data Access. Empty Prisma schema. Only a `/health` route exists.
- **client** ([client/CLAUDE.md](../../../client/CLAUDE.md)): React 19 + Vite 8 + Tailwind v4 + shadcn + base-ui + lucide. Routing, HTTP client, and server-state libraries not yet installed.

### 1.3 Product scope

BuildCheck is an Israeli building-permit compliance pre-checker. A user uploads a DXF (בקשת היתר) and a PDF (תב"ע / החלטה מרחבית); the system runs extraction pipelines, feeds the results to Claude, and produces a requirement-by-requirement compliance report. Four optional domain add-ons (fire / water / electricity / accessibility) run against domain-specific regulation documents. Users can chat against the uploaded files post-analysis.

All user-facing copy is Hebrew with RTL layout. Code, logs, and comments are English.

### 1.4 What this spec does NOT cover

Explicitly deferred, captured in §14 (Open Questions):
- Email flows (forgot-password, invite emails) — admin-reset is the only path
- Refresh tokens — 7-day cookie is the session
- Login history / user search UI
- S3 storage (design supports it; implementation stays local for v1)
- pgvector / RAG (Postgres is provisioned ready, but no vectorization in v1)
- 3D DXF entities (`3DSOLID`, `MESH`, `REGION`)
- Proxies from non-Autodesk CAD tools
- DWG files (users export to DXF)
- Shared-schema package between client and server (keep-in-sync comments for v1)
- Non-Hebrew תב"ע documents
- Mobile-first layouts

---

## 2. Decisions (locked during brainstorm)

### 2.1 Tenancy — dropped

**Decision:** No `Company` model. Single-tenant by design. `Project.ownerId → User.id` directly.

**Rationale:** The product is operated by one administrator, not a multi-company SaaS. Dropping tenancy removes the `companyId` FK from every downstream model, drops the `projectWhereClause(user)` transitive middleware, and simplifies authorization to "owner-or-admin."

### 2.2 Role model

Two roles, both immutable after creation.

| Role    | Creation path                    | Demotion | Promotion | Self-creation |
|---------|----------------------------------|----------|-----------|---------------|
| `ADMIN` | Env-seeded at server boot        | Never    | Never     | No            |
| `USER`  | Created only by an `ADMIN`       | Never    | Never     | No            |

Invariants:
- Exactly one admin in v1, seeded from env.
- `ADMIN` rows are managed only by the boot-time seeder.
- No API endpoint creates, modifies, deletes, or toggles active state on an `ADMIN`.
- No `role` field on any API request payload. Zod schemas use `.strictObject(...)`.
- No public registration endpoint.
- Seeder is the sole exception to role immutability; it can repair drift (USER→ADMIN) for the env-identified row.

### 2.3 Admin seeding

Env vars (validated in [server/src/utils/env.ts](../../../server/src/utils/env.ts)): `ADMIN_EMAIL`, `ADMIN_INITIAL_PASSWORD` (min 8), `JWT_SECRET` (min 32).

Boot-time idempotent seeder (`server/src/bootstrap/seed-admin.ts`, runs before `app.listen()`):
1. Look up by `ADMIN_EMAIL`.
2. Not found → bcrypt-hash (cost 10), insert `role=ADMIN isActive=true`, audit `admin.seeded`.
3. Found, correct role + active → no-op.
4. Found, drift → repair `role=ADMIN isActive=true`; warn-log.
5. Never overwrites `passwordHash`.
6. On any failure, exit 1.

Recovery (loss of password): manual `UPDATE "User" SET "passwordHash" = ...` via psql — documented in vault.

### 2.4 Session

HttpOnly cookie carrying a JWT. 7-day TTL.

Production cookie: `auth=<jwt>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800`.
Dev: `Secure` dropped when `NODE_ENV !== 'production'`.

JWT payload minimal: `{ sub, iat, exp }`. Role and `isActive` read from DB every request.

CORS: `cors({ origin: env.CORS_ORIGIN, credentials: true })`. Vite dev proxy keeps cookies same-origin.

### 2.5 Session invalidation — Approach 2

Auth middleware decodes cookie, then does a DB lookup per authenticated request. On missing user or `isActive=false`: 401 + clear cookie. Instant lockout on disable/delete.

Accepted tradeoff: password reset does NOT force-logout other sessions (the cookie remains valid until TTL). Rejected `tokenVersion` column as over-engineered for the actual threat model.

### 2.6 Password policy & brute-force defense

- bcrypt cost 10
- Min 8 chars, no complexity rules
- Generic `"Invalid credentials"` for all login failures
- Per-IP rate limit on `/api/auth/login`: 10 attempts / 15 min
- No per-email lockout in v1

### 2.7 File storage — object storage, metadata as entities

Never store file bytes in Postgres.

**Production:** S3-compatible object storage (Cloudflare R2 recommended — cheap, no egress fees; AWS S3 or any S3-compatible provider works). `StoredFile.store = S3`, `StoredFile.uri = s3://<bucket>/<kind>/<cuid>.<ext>`.

**Development:** MinIO in docker-compose (same S3 API, no cloud dependency) OR the `LOCAL` store with `uploads/<kind>/<cuid>.<ext>` on the developer's disk. Both paths exercise the same `storage.client.ts` interface; production tests against MinIO; LOCAL exists for the zero-infra onboarding case.

**`StoredFile` model** unifies metadata across DXF / תב"ע / addon docs / renders. Every file-bearing entity owns a 1:1 FK to `StoredFile`.

**`sha256` is the dedup / "changed?" signal.** Re-uploading identical bytes to the same project detects the match (no duplicate row, no duplicate object in the bucket, no re-extraction).

**Upload path is stream-through, not buffer-then-upload.** Multer receives the multipart body, pipes through a sha256 Transform stream, and feeds `@aws-sdk/lib-storage`'s multi-part `Upload` — the API instance never holds the whole file in memory or on disk. This is the stateless-friendly path and supports up to 100 MB DXFs without flinching.

### 2.8 Normalization policy

User-facing data is always normalized into relational tables. No JSON blobs for anything the user queries, filters, or displays. One JSON column is allowed: `DxfFile.rawExtractedData` — the full ezdxf extractor payload, machine-fuel for the agent's prompt construction and for re-running extraction with an updated classifier. It is never surfaced in the UI.

Normalized tables: `Viewport`, `ParsedValue`, `RenderedImage`, `Requirement`, `TavaPage`, `ComplianceResult`. See §3.

Rejected as a design trap: normalizing individual DXF entities (every `LINE`, `ARC`, `TEXT`) into rows. ~30 viewports × ~1k entities/viewport = 30k rows per upload with zero query benefit — the compliance agent consumes summaries, not entity-level rows.

### 2.9 History preservation

Re-uploading a DXF, תב"ע, or addon document creates a new row. Prior rows remain, pinned to their past analyses. `DxfFile`, `TavaFile`, `AddonDocument` are 1:N with `Project`. An `Analysis` records the exact `dxfFileId` and `tavaFileId` it consumed; an `AddonRun` records the exact `addonDocumentId`.

"Current" file for a project = latest by `createdAt` where `deletedAt IS NULL`. Re-upload soft-deletes the prior current via the upload pipeline.

### 2.10 Soft delete — only on `Project`

`Project.deletedAt DateTime?`. All other tables cascade-delete from Project. Project is the recovery unit; lower levels are not. Orphan files on disk are cleaned by a periodic job (not in v1).

### 2.11 Job queue — DB-backed from day one

The orchestrator polls a `Job` table (`WHERE status='PENDING' ORDER BY createdAt`). Workers transition rows through `PENDING → RUNNING → COMPLETED|FAILED|CANCELLED`. Same `JobRunner` interface can swap to BullMQ+Redis later without controller changes.

Boot-time recovery: any `Job` stuck in `RUNNING` older than 30 min (or with null heartbeat) is marked `FAILED` with message `"interrupted by server restart"`. Any `Analysis` / `AddonRun` tied to such a job is marked `FAILED` in the same pass.

### 2.12 Python as an HTTP sidecar

Not `execFile('python3 extractor.py ...')` per invocation. A FastAPI service in its own container/deployment exposes:
- `POST /extract` — body: `{ sourcePresignedUrl, reqId }`, returns `{ rawExtractedData, viewports[], parsedValues[] }`
- `POST /render` — body: `{ sourcePresignedUrl, destPresignedPuts: [{ key, putUrl }], reqId }`, returns `{ renders: [{ kind, key, sha256, sizeBytes, viewportBlock? }] }`
- `GET /health`

Sidecar fetches the DXF bytes from S3 using the presigned GET URL, writes to its own ephemeral `/tmp`, processes, and for renders — uploads each PNG via a pre-provided presigned PUT URL. `/tmp` is wiped per request. No shared volume between Node and the sidecar; both are stateless.

Node calls via `fetch` with `X-Request-Id` header. Warm interpreter (~20 ms per call vs ~500 ms cold-start), canonical UTF-8 over JSON HTTP (surrogate-pair-over-stdout bugs vanish), cancellable via HTTP abort, individually testable, horizontally scalable.

One new deployment, one integration adapter (`integrations/python-sidecar.client.ts`). Immediate payback.

### 2.13 DXF pipeline efficiency

Applied together in §7:
- sha256 dedup (skip extraction + render when bytes unchanged)
- Raw extraction cached in `DxfFile.rawExtractedData` (analysis re-runs never re-extract)
- Bulk inserts via Prisma `createMany` for normalized rows (600 rows = one round-trip)
- Best-effort renders — render failures never block analysis; render is its own job
- Analysis prompt built from normalized tables (`Viewport`, `ParsedValue`), not from JSON blob

### 2.14 Chat — per-Project

`ChatMessage.projectId` (FK Project). One continuous thread per project. Chat works before, during, or after analysis. Context assembled for each assistant reply pulls from (in order of inclusion): latest `Analysis.summary` + `ComplianceResult`s, latest `TavaFile.rawExtractedText` (truncated), latest `DxfFile` viewport summaries. No vector DB in v1.

Authorization: project owner OR admin.

### 2.15 Observability

- `requestId` middleware generates a cuid per request; attached to `req.id` and `X-Request-Id` response header
- Structured winston logs: `{ reqId, userId, route, event, ms, level, message, ... }` JSON
- The same `reqId` is forwarded to the Python sidecar as a header, so logs stitch together across services
- No metrics / tracing backend in v1

### 2.16 Prisma transactions

`prisma.$transaction(async tx => {...})` for every multi-step write. No "best-effort" multi-insert code paths. Audit-log writes are the deliberate exception (§2.17).

### 2.17 Audit log is best-effort

`audit-log.service.ts` is the only service that writes to `AuditLog`. It catches any insert failure, logs to winston at `error`, and returns — does not propagate. A log failure never blocks a user operation.

### 2.18 Error format & response shape

Per [server/CLAUDE.md](../../../server/CLAUDE.md):
- Success: `{ data: ... }`
- Error: `{ error, details? }` (Zod) or `{ message }` (HttpError via the existing handler in [server/src/middlewares.ts](../../../server/src/middlewares.ts))

### 2.19 Stateless servers

The API and the worker are both **fully stateless processes**. Any instance can be killed or replaced at any time with zero user-visible data loss.

**Hard rules (enforced by code review):**
- No writes to local disk except `/tmp` scratch space (ephemeral per request).
- No process-memory state shared across requests — rate-limit counters, session data, caches all live in a shared store.
- JWT session is already stateless (cookie is self-contained + DB lookup per request).

**Infrastructure this implies** (v1 production):
- **Postgres** — authoritative DB (Prisma Postgres is the v1 default).
- **S3-compatible object storage** — all file bytes (uploads + renders). Cloudflare R2 recommended.
- **Redis** — rate-limit counters (`rate-limit-redis`) and, in a later phase, BullMQ.
- **Python sidecar** — its own deployment, 1-N instances, S3-aware.
- **API deployment** — N instances behind an LB.
- **Worker deployment** — 1-N instances, same image as API but entrypoint is `src/worker.ts`.

**Dev infrastructure** (docker-compose): Postgres + Redis + MinIO + Python sidecar + Node API + Node worker. One `docker compose up` boots the whole stack.

**What this explicitly rules out:**
- Local disk writes for uploads, renders, logs, rate-limit state.
- Scheduling work in-memory (`setInterval` / `setTimeout` survive a restart? No — put it in the `Job` table).
- Any `express-session` usage.
- File transports for winston — all logs go to stdout; platform aggregates.

### 2.20 Chat streaming via SSE

Chat replies stream to the browser as Server-Sent Events (SSE), not as a single JSON blob after 8-10s of silence. Token-by-token rendering matches claude.ai UX and is table stakes for chat.

**Transport:** `POST /api/projects/:id/chat` with `Content-Type: application/json` request and `Accept: text/event-stream` response. Not `GET + EventSource` because we need a request body; not WebSocket because chat is one-directional.

**Event schema** (sent in order):
```
event: user-message
data: {"id":"cuid","content":"...","createdAt":"..."}

event: token
data: {"text":"שלום"}

event: token
data: {"text":" עולם"}

...

event: assistant-message
data: {"id":"cuid","content":"שלום עולם...","createdAt":"..."}
```

On error: `event: error\ndata: {"message":"..."}` then close. Client `AbortController` closes cleanly on tab-close.

**Server handles streaming without workers/pubsub** — chat is a single synchronous request-scoped operation. The handler:
1. Persists the `USER` `ChatMessage`, emits `user-message` event.
2. Calls the Anthropic SDK in streaming mode (`messages.stream(...)`), pipes each content delta into a `token` event.
3. On stream end, persists the `ASSISTANT` `ChatMessage` with the full content, emits `assistant-message` event, closes the response.

No `Job`, no worker, no Redis pub/sub. SSE is scoped to this one endpoint.

**Analysis-status live updates stay on polling** for v1. Polling at 2.5 s is acceptable for status that changes 4-5 times over 3 minutes. Migrating to SSE for analysis status is §14 open-question material.

---

## 3. Data Model

Full Prisma schema. All models use `cuid()` primary keys. Timestamps implicit: `createdAt` on every table, `updatedAt` on tables that get mutated.

### 3.1 Identity & audit

```prisma
enum UserRole { ADMIN USER }

model User {
  id            String     @id @default(cuid())
  email         String     @unique
  name          String
  passwordHash  String
  role          UserRole   @default(USER)
  isActive      Boolean    @default(true)
  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @updatedAt

  projects      Project[]

  @@index([email])
}

model AuditLog {
  id         String    @id @default(cuid())
  actorId    String?
  event      String
  entity     String?
  entityId   String?
  metadata   Json?
  createdAt  DateTime  @default(now())

  @@index([actorId, createdAt])
  @@index([entity, entityId])
}
```

### 3.2 Storage

```prisma
enum FileKind   { DXF TAVA ADDON RENDER }
enum FileStore  { LOCAL S3 }

model StoredFile {
  id            String    @id @default(cuid())
  kind          FileKind
  store         FileStore @default(LOCAL)
  uri           String              // "uploads/dxf/<cuid>.dxf" or "s3://bucket/dxf/<cuid>.dxf"
  originalName String
  sizeBytes    Int
  sha256       String
  createdAt    DateTime   @default(now())

  dxfFile       DxfFile?
  tavaFile      TavaFile?
  addonDocument AddonDocument?
  renderedImage RenderedImage?

  @@index([sha256])
}
```

### 3.3 Projects

```prisma
model Project {
  id           String     @id @default(cuid())
  ownerId      String
  owner        User       @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  name         String
  description  String?
  locality     String?
  deletedAt    DateTime?
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt

  dxfFiles        DxfFile[]
  tavaFiles       TavaFile[]
  addonDocuments  AddonDocument[]
  analyses        Analysis[]
  chatMessages    ChatMessage[]

  @@index([ownerId, createdAt])
  @@index([deletedAt])
}
```

### 3.4 DXF

```prisma
enum ExtractionStatus { PENDING EXTRACTING COMPLETED FAILED }

model DxfFile {
  id                 String            @id @default(cuid())
  projectId          String
  project            Project           @relation(fields: [projectId], references: [id], onDelete: Cascade)
  storedFileId       String            @unique
  storedFile         StoredFile        @relation(fields: [storedFileId], references: [id])

  extractionStatus   ExtractionStatus  @default(PENDING)
  extractionError    String?
  extractionJobId    String?
  rawExtractedData   Json?              // machine-fuel only; never surfaced in UI

  deletedAt          DateTime?
  createdAt          DateTime          @default(now())

  viewports          Viewport[]
  renders            RenderedImage[]
  analyses           Analysis[]

  @@index([projectId, createdAt])
}

enum ViewportType {
  INDEX_PAGE FLOOR_PLAN CROSS_SECTION ELEVATION
  PARKING_SECTION SURVEY SITE_PLAN ROOF_PLAN AREA_CALCULATION UNCLASSIFIED
}

model Viewport {
  id              String         @id @default(cuid())
  dxfFileId       String
  dxfFile         DxfFile        @relation(fields: [dxfFileId], references: [id], onDelete: Cascade)

  blockName       String                        // "VIEWPORT19"
  classification  ViewportType   @default(UNCLASSIFIED)
  label           String?                       // "קרקע"
  scale           String?                       // "1:100"
  confidence      Float?

  totalEntities   Int
  lineCount       Int            @default(0)
  polylineCount   Int            @default(0)
  arcCount        Int            @default(0)
  circleCount     Int            @default(0)
  insertCount     Int            @default(0)
  textCount       Int            @default(0)
  boundingBox     Json?                         // { xMin, xMax, yMin, yMax }

  parsedValues    ParsedValue[]

  @@index([dxfFileId, classification])
}

enum ParsedValueKind {
  HEIGHT DIMENSION PERCENTAGE SCALE LABEL
}

model ParsedValue {
  id           String          @id @default(cuid())
  viewportId   String
  viewport     Viewport        @relation(fields: [viewportId], references: [id], onDelete: Cascade)

  kind         ParsedValueKind
  value        String                    // "3.0", "8%", "קומת קרקע", "1:100"
  unit         String?                   // "m", "%", null
  x            Float?
  y            Float?
  raw          String?                   // original extracted string for provenance

  @@index([viewportId, kind])
}

enum RenderKind { PLAN_OVERVIEW PLAN_DETAIL VIEWPORT }

model RenderedImage {
  id            String     @id @default(cuid())
  dxfFileId     String
  dxfFile       DxfFile    @relation(fields: [dxfFileId], references: [id], onDelete: Cascade)
  storedFileId  String     @unique
  storedFile    StoredFile @relation(fields: [storedFileId], references: [id])

  kind          RenderKind
  viewportBlock String?                  // "VIEWPORT19" when kind=VIEWPORT
  createdAt     DateTime   @default(now())

  @@index([dxfFileId])
}
```

### 3.5 תב"ע (Tava) — zoning plan

```prisma
enum ExtractionMethod { PDF_TEXT TESSERACT_OCR }

model TavaFile {
  id                 String            @id @default(cuid())
  projectId          String
  project            Project           @relation(fields: [projectId], references: [id], onDelete: Cascade)
  storedFileId       String            @unique
  storedFile         StoredFile        @relation(fields: [storedFileId], references: [id])

  extractionStatus   ExtractionStatus  @default(PENDING)
  extractionMethod   ExtractionMethod?
  extractionError    String?
  extractionJobId    String?
  rawExtractedText   String?            // full text (no size cap)

  deletedAt          DateTime?
  createdAt          DateTime          @default(now())

  pages              TavaPage[]
  requirements       Requirement[]
  analyses           Analysis[]

  @@index([projectId, createdAt])
}

model TavaPage {
  id           String    @id @default(cuid())
  tavaFileId   String
  tavaFile     TavaFile  @relation(fields: [tavaFileId], references: [id], onDelete: Cascade)
  pageNumber   Int
  text         String                  // per-page text (empty string if blank)

  @@unique([tavaFileId, pageNumber])
  @@index([tavaFileId, pageNumber])
}

enum RequirementCategory {
  AREA HEIGHT SETBACK PARKING COVERAGE USE UNITS OTHER
}

model Requirement {
  id           String               @id @default(cuid())
  tavaFileId   String
  tavaFile     TavaFile             @relation(fields: [tavaFileId], references: [id], onDelete: Cascade)

  section      String                      // "סעיף 5.1"
  text         String                      // "מרווח חזית מינימלי"
  value        String?                     // "3.0" or "8%"
  unit         String?                     // "m", "%", null
  category     RequirementCategory
  pageNumber   Int?                        // if known from OCR layout

  @@index([tavaFileId, category])
}
```

### 3.6 Add-on documents

```prisma
enum AddonDomain { FIRE WATER ELECTRICITY ACCESSIBILITY }

model AddonDocument {
  id                String             @id @default(cuid())
  projectId         String
  project           Project            @relation(fields: [projectId], references: [id], onDelete: Cascade)
  storedFileId      String             @unique
  storedFile        StoredFile         @relation(fields: [storedFileId], references: [id])

  domain            AddonDomain
  extractionStatus  ExtractionStatus   @default(PENDING)
  extractionMethod  ExtractionMethod?
  extractionError   String?
  extractionJobId   String?
  rawExtractedText  String?

  deletedAt         DateTime?
  createdAt         DateTime           @default(now())

  addonRuns         AddonRun[]

  @@index([projectId, domain, createdAt])
}
```

### 3.7 Analyses

```prisma
enum AnalysisStatus {
  PENDING ANALYZING COMPLETED FAILED
}

model Analysis {
  id                 String             @id @default(cuid())
  projectId          String
  project            Project            @relation(fields: [projectId], references: [id], onDelete: Cascade)
  triggeredById      String
  triggeredBy        User               @relation(fields: [triggeredById], references: [id])

  dxfFileId          String
  dxfFile            DxfFile            @relation(fields: [dxfFileId], references: [id])
  tavaFileId         String
  tavaFile           TavaFile           @relation(fields: [tavaFileId], references: [id])

  status             AnalysisStatus     @default(PENDING)
  errorMessage       String?
  jobId              String?

  score              Int?
  passCount          Int?
  failCount          Int?
  warningCount       Int?
  cannotCheckCount   Int?
  summary            String?                     // Hebrew paragraph

  startedAt          DateTime?
  completedAt        DateTime?
  createdAt          DateTime           @default(now())

  results            ComplianceResult[]
  addonRuns          AddonRun[]

  @@index([projectId, createdAt])
  @@index([status])
}
```

### 3.8 Add-on runs

```prisma
enum AddonRunStatus { PENDING RUNNING COMPLETED FAILED }

model AddonRun {
  id                 String             @id @default(cuid())
  analysisId         String
  analysis           Analysis           @relation(fields: [analysisId], references: [id], onDelete: Cascade)
  domain             AddonDomain
  documentId         String
  document           AddonDocument      @relation(fields: [documentId], references: [id])

  status             AddonRunStatus     @default(PENDING)
  errorMessage       String?
  jobId              String?

  score              Int?
  passCount          Int?
  failCount          Int?
  warningCount       Int?
  cannotCheckCount   Int?
  summary            String?

  startedAt          DateTime?
  completedAt        DateTime?
  createdAt          DateTime           @default(now())

  results            ComplianceResult[]

  @@unique([analysisId, domain, createdAt])
  @@index([status])
}
```

### 3.9 Unified compliance results (polymorphic)

```prisma
enum ComplianceStatus { PASS FAIL WARNING CANNOT_CHECK }

model ComplianceResult {
  id              String             @id @default(cuid())
  analysisId      String?
  analysis        Analysis?          @relation(fields: [analysisId], references: [id], onDelete: Cascade)
  addonRunId      String?
  addonRun        AddonRun?          @relation(fields: [addonRunId], references: [id], onDelete: Cascade)

  requirement     String
  source          String                           // "תב"ע סעיף 5.1"
  status          ComplianceStatus
  details         String                           // Hebrew explanation
  dxfEvidence     String                           // citation pointer
  measuredValue   String?
  requiredValue   String?
  category        String                           // free-text; maps loosely to RequirementCategory

  createdAt       DateTime           @default(now())

  @@index([analysisId, status])
  @@index([addonRunId, status])
}
```

Exactly one of `analysisId` / `addonRunId` must be set. The service enforces this; a DB CHECK constraint (`CHECK ((analysisId IS NULL) <> (addonRunId IS NULL))`) is added via a migration.

### 3.10 Jobs

```prisma
enum JobType   {
  DXF_EXTRACTION DXF_RENDER TAVA_EXTRACTION ADDON_EXTRACTION
  CORE_ANALYSIS ADDON_RUN
}
enum JobStatus { PENDING RUNNING COMPLETED FAILED CANCELLED }

model Job {
  id             String     @id @default(cuid())
  type           JobType
  status         JobStatus  @default(PENDING)
  payload        Json
  errorMessage   String?
  attempts       Int        @default(0)
  heartbeatAt    DateTime?

  projectId      String?
  analysisId     String?
  addonRunId     String?
  dxfFileId      String?
  tavaFileId     String?
  addonDocumentId String?

  startedAt      DateTime?
  completedAt    DateTime?
  createdAt      DateTime   @default(now())

  @@index([status, createdAt])
  @@index([type, status])
}
```

Convenience FKs allow cheap "show me running jobs for this analysis." No relations defined — these are loose references so a `Job` survives deletion of its target (historical audit).

### 3.11 Chat

```prisma
enum ChatRole { USER ASSISTANT }

model ChatMessage {
  id           String     @id @default(cuid())
  projectId    String
  project      Project    @relation(fields: [projectId], references: [id], onDelete: Cascade)
  role         ChatRole
  content      String                        // Hebrew, free-form
  createdAt    DateTime   @default(now())

  @@index([projectId, createdAt])
}
```

### 3.12 Summary of changes from the PRD / prototype

| Area                     | PRD / Prototype                              | This design                                                       |
|--------------------------|----------------------------------------------|-------------------------------------------------------------------|
| Multi-tenancy            | `Company` + `companyId` on 4 tables          | Dropped (§2.1)                                                    |
| Admin model              | Per-company ADMIN, self-registration creates | Single env-seeded ADMIN, no registration (§2.2, §2.3)             |
| Session                  | JWT in Authorization header, localStorage    | HttpOnly cookie, SameSite=Strict (§2.4)                           |
| Disable lockout          | Bearer-token only; re-check on login         | DB lookup per authenticated request (§2.5)                        |
| File storage             | Path fields per file model                   | Unified `StoredFile` with `sha256` (§2.7, §3.2)                   |
| DXF viewports            | JSON blob on `DxfFile.extractedData`         | Normalized `Viewport` + `ParsedValue` (§3.4)                      |
| Requirements             | JSON array on `TavaFile.requirements`        | Normalized `Requirement` + `TavaPage` (§3.5)                      |
| Compliance results       | JSON arrays on Analysis/AddonRun             | Unified polymorphic `ComplianceResult` (§3.9)                     |
| Renders                  | `string[]` filenames in JSON                 | `RenderedImage` + `StoredFile` rows (§3.4)                        |
| Addon docs               | 1:1 per (project, domain), replace on re-up  | 1:N, `AddonRun` pins version (§2.9)                               |
| Project.status           | Stored enum                                  | Dropped (derive in service)                                       |
| Soft delete              | None                                         | `Project.deletedAt` (§2.10)                                       |
| Orchestrator             | In-process, per-request                      | `Job` table + polling worker (§2.11, §8)                          |
| Python                   | `execFile` per call                          | FastAPI sidecar container (§2.12, §7.1)                           |
| Chat                     | `ChatMessage.analysisId`                     | `ChatMessage.projectId` (§2.14)                                   |
| Audit                    | None                                         | `AuditLog` (§3.1)                                                 |
| Transactions             | Deliberately skipped in places               | Always used for multi-step writes (§2.16)                         |

---

## 4. API Surface

All routes under `/api`. Zod validation via existing `validate()` middleware. Responses: `{ data }` or `{ error, details? }`.

Per-route auth column:
- **P** = public
- **A** = authenticated (any role)
- **O** = owner or admin (Project-scoped)
- **X** = admin-only

### 4.1 Auth

| Auth | Method | Path                           | Request                         | Response                        |
|------|--------|--------------------------------|---------------------------------|---------------------------------|
| P    | POST   | `/api/auth/login`              | `{ email, password }`           | `{ data: { user } }` + cookie   |
| P    | POST   | `/api/auth/logout`             | —                               | `{ data: { ok: true } }`        |
| A    | GET    | `/api/auth/me`                 | —                               | `{ data: { user } }`            |
| A    | POST   | `/api/auth/change-password`    | `{ currentPassword, newPassword }` | `{ data: { ok: true } }`     |

`/api/auth/login` has a per-IP rate-limiter (10/15m).

### 4.2 Admin

| Auth | Method | Path                                      | Request                                  | Response                        |
|------|--------|-------------------------------------------|------------------------------------------|---------------------------------|
| X    | GET    | `/api/admin/users`                        | query `?q=&limit=&cursor=`               | `{ data: { users, nextCursor }}`|
| X    | POST   | `/api/admin/users`                        | `{ email, name, initialPassword }`       | `{ data: { user } }`            |
| X    | DELETE | `/api/admin/users/:id`                    | —                                        | `{ data: { ok: true } }`        |
| X    | POST   | `/api/admin/users/:id/reset-password`     | `{ newPassword }`                        | `{ data: { ok: true } }`        |
| X    | PATCH  | `/api/admin/users/:id/active`             | `{ isActive }`                           | `{ data: { user } }`            |
| X    | GET    | `/api/admin/stats`                        | —                                        | `{ data: { userCount, projectCount, analysisCount } }` |

Invariants (service-enforced, not just middleware):
- Any admin endpoint targeting a user with `role=ADMIN` returns **403** (`admin_target_forbidden`).
- Request schemas are `z.strictObject(...)` — `role` field in body 400s. Service hard-codes `role: 'USER'`.
- `DELETE` and `PATCH active(false)` reject `:id === req.user.id` with 403.
- Missing user → 404. Ordering in service: exists → is-admin-target → is-self-target → proceed.
- `POST /admin/users` returns 409 on email collision (`email_in_use`, from Prisma P2002).
- `initialPassword` and `newPassword` Zod-validated min 8.
- Every mutating admin endpoint writes `auditLog.record(...)` on success.

### 4.3 Projects

| Auth | Method | Path                           | Request                              | Response                        |
|------|--------|--------------------------------|--------------------------------------|---------------------------------|
| A    | GET    | `/api/projects`                | query `?limit=&cursor=`              | `{ data: { projects, nextCursor } }`|
| A    | POST   | `/api/projects`                | `{ name, description?, locality? }`  | `{ data: { project } }`         |
| O    | GET    | `/api/projects/:id`            | —                                    | `{ data: { project } }` (with current files, recent analyses) |
| O    | PATCH  | `/api/projects/:id`            | `{ name?, description?, locality? }` | `{ data: { project } }`         |
| O    | DELETE | `/api/projects/:id`            | —                                    | `{ data: { ok: true } }` (soft delete) |

Visibility: USER sees own projects (`ownerId === req.user.id AND deletedAt IS NULL`). ADMIN sees all non-deleted.

### 4.4 Uploads (multipart)

| Auth | Method | Path                                             | Form                                         | Response                   |
|------|--------|--------------------------------------------------|----------------------------------------------|----------------------------|
| O    | POST   | `/api/projects/:id/dxf`                          | `file` (.dxf)                                | `{ data: { dxfFile } }`    |
| O    | POST   | `/api/projects/:id/tava`                         | `file` (.pdf)                                | `{ data: { tavaFile } }`   |
| O    | POST   | `/api/projects/:id/addon-docs`                   | `file` (.pdf), `domain` (form field)         | `{ data: { addonDocument } }`|

Limits: DXF 100 MB, TAVA 50 MB, ADDON 30 MB. Multer uses streaming (not disk or memory storage) via a custom storage engine that pipes directly to S3. `decodeOriginalName` (latin1→utf8) helper applied at the middleware level (not per-route).

Upload behavior (stateless, stream-through to S3):
1. Multer receives the multipart body and opens one pipe: `req → sha256 Transform → @aws-sdk/lib-storage Upload` targeting `s3://<bucket>/<kind>/<cuid>.<ext>`. Bytes never land on disk, never buffer fully in Node memory.
2. When the upload finishes, the sha256 is captured; the `Upload` result gives size.
3. Dedup check: if any `StoredFile` with same `(sha256, kind)` is already referenced by a `DxfFile` / `TavaFile` / `AddonDocument` on **this project** (including soft-deleted) → abort the just-uploaded S3 object (`DeleteObject`), undelete the existing row if soft-deleted, return it. No new row, no extraction re-run. **Per-project on purpose** — two users with identical bytes get separate `StoredFile` rows.
4. Otherwise, inside `$transaction`: insert `StoredFile` (kind, store=S3 in prod, uri=`s3://...`, sha256, sizeBytes), insert `DxfFile` / `TavaFile` / `AddonDocument` (extractionStatus=PENDING, storedFileId), soft-delete the project's prior current file-of-same-kind, enqueue the extraction `Job`.
5. Return the created row with `extractionStatus=PENDING`.

UI polls (§4.5) to see status transitions.

**Failure during upload:** if the stream dies mid-way, `@aws-sdk/lib-storage` aborts the multipart upload and S3 cleans up. No dangling object. No DB row created (nothing committed). Client retries the whole upload.

### 4.5 Analyses

| Auth | Method | Path                                           | Request        | Response                         |
|------|--------|------------------------------------------------|----------------|----------------------------------|
| O    | POST   | `/api/projects/:id/analyze`                    | —              | `{ data: { analysis: {id, status: 'PENDING'} } }` |
| O    | GET    | `/api/analyses/:id`                            | —              | `{ data: { analysis } }` (full, with results, addon runs) |
| O    | GET    | `/api/analyses/:id/status`                     | —              | `{ data: { status, progress } }` (lightweight for polling) |
| O    | GET    | `/api/projects/:id/analyses`                   | query `?limit` | `{ data: { analyses } }`         |

`POST /analyze` preconditions: project has a current `DxfFile` with `extractionStatus=COMPLETED`, current `TavaFile` with `extractionStatus=COMPLETED`, no analysis currently in-flight for this project. Fails with 409 otherwise.

### 4.6 Add-on agents

| Auth | Method | Path                                                    | Request        | Response                         |
|------|--------|---------------------------------------------------------|----------------|----------------------------------|
| O    | GET    | `/api/analyses/:id/addons`                              | —              | `{ data: { addons: [4 cards] } }`|
| O    | POST   | `/api/analyses/:id/addons/:domain/run`                  | —              | `{ data: { addonRun } }`         |
| O    | GET    | `/api/addon-runs/:id`                                   | —              | `{ data: { addonRun } }`         |

Each card includes: domain, current `AddonDocument` (if any), latest `AddonRun` (if any), `canRun: boolean`.

`POST /addons/:domain/run` preconditions: parent analysis COMPLETED, `AddonDocument` for this (project, domain) exists and `extractionStatus=COMPLETED`, no in-flight addon run for this analysis+domain.

### 4.7 Chat

| Auth | Method | Path                         | Request                 | Response                            |
|------|--------|------------------------------|-------------------------|-------------------------------------|
| O    | GET    | `/api/projects/:id/chat`     | query `?limit=&cursor=` | `{ data: { messages, nextCursor } }`|
| O    | POST   | `/api/projects/:id/chat`     | `{ content }`           | `text/event-stream` (see §2.20)     |

`POST /chat` is a **streaming** endpoint. Response `Content-Type: text/event-stream`. Events emitted in order: `user-message` (after persisting the user's message), N × `token` (each Claude content-block delta), `assistant-message` (after persisting the assistant's reply), then connection close. On error: `event: error\ndata: {"message":"..."}` then close.

Rate-limited at 5 messages / minute per `(projectId, userId)` (Redis-backed, §2.19) to cap Claude spend.

Context assembled for the assistant: latest `Analysis.summary` + latest 20 `ComplianceResult`s + truncated `TavaFile.rawExtractedText` (first 4000 chars) + truncated viewport summaries. Prior `ChatMessage`s (last 20) included for conversational continuity.

Headers set on the SSE response:
```
Content-Type: text/event-stream
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```
Last header tells any downstream nginx/proxy not to buffer.

### 4.8 Renders

| Auth | Method | Path                                                | Response                          |
|------|--------|-----------------------------------------------------|-----------------------------------|
| O    | GET    | `/api/renders/:dxfFileId/:filename`                 | `302` → presigned S3 GET URL      |

**Change from PRD:** authenticated now (O — owner or admin), because there's no per-object capability layer from S3. The endpoint:
1. Validates cuid format on `:dxfFileId`, rejects `..` / `/` / `\` in `:filename`.
2. Finds the `RenderedImage` row joining `DxfFile → Project`; checks owner-or-admin access.
3. Generates a short-lived (5 min) presigned GET URL for the `StoredFile.uri`.
4. Returns `302 Location: <presignedUrl>`.

Browser `<img src>` follows the redirect automatically. Node never proxies the bytes — zero egress through the API.

### 4.9 Health

| Auth | Method | Path        | Response                  |
|------|--------|-------------|---------------------------|
| P    | GET    | `/health`   | `{ ok: true, ts }`        |

Unchanged, already exists.

### 4.10 What is NOT in the API

- `POST /api/auth/register`
- `POST /api/auth/forgot-password`
- `PATCH /api/admin/users/:id/role`
- `DELETE` that hard-deletes a project (delete is always soft)
- `GET /api/admin/audit-log` (deferred to post-v1 UI work)
- Direct read of `DxfFile.rawExtractedData` or `TavaFile.rawExtractedText` via API (internal machine-fuel only)

---

## 5. Server Structure

### 5.1 Folder layout

```
server/src/
├── api/
│   ├── controllers/
│   │   ├── auth.controller.ts
│   │   ├── admin-users.controller.ts
│   │   ├── admin-stats.controller.ts
│   │   ├── projects.controller.ts
│   │   ├── uploads.controller.ts
│   │   ├── analyses.controller.ts
│   │   ├── addon-runs.controller.ts
│   │   ├── chat.controller.ts
│   │   └── renders.controller.ts
│   ├── services/
│   │   ├── auth.service.ts
│   │   ├── admin-users.service.ts
│   │   ├── projects.service.ts
│   │   ├── uploads.service.ts
│   │   ├── dxf-extraction.service.ts
│   │   ├── tava-extraction.service.ts
│   │   ├── addon-extraction.service.ts
│   │   ├── core-analysis.service.ts
│   │   ├── addon-run.service.ts
│   │   ├── chat.service.ts
│   │   ├── audit-log.service.ts
│   │   └── compliance-agent.service.ts       # shared prompt assembly
│   ├── data-access/
│   │   ├── user.da.ts
│   │   ├── audit-log.da.ts
│   │   ├── project.da.ts
│   │   ├── stored-file.da.ts
│   │   ├── dxf-file.da.ts
│   │   ├── viewport.da.ts
│   │   ├── parsed-value.da.ts
│   │   ├── rendered-image.da.ts
│   │   ├── tava-file.da.ts
│   │   ├── tava-page.da.ts
│   │   ├── requirement.da.ts
│   │   ├── addon-document.da.ts
│   │   ├── analysis.da.ts
│   │   ├── addon-run.da.ts
│   │   ├── compliance-result.da.ts
│   │   ├── job.da.ts
│   │   └── chat-message.da.ts
│   ├── routes/
│   │   ├── auth.routes.ts
│   │   ├── admin.routes.ts
│   │   ├── projects.routes.ts
│   │   ├── uploads.routes.ts
│   │   ├── analyses.routes.ts
│   │   ├── addon-runs.routes.ts
│   │   ├── chat.routes.ts
│   │   ├── renders.routes.ts
│   │   └── index.ts
│   ├── schemas/              # Zod, one file per route group
│   └── webhooks/             # (empty placeholder for future)
├── integrations/
│   ├── auth-cookie.ts
│   ├── password.ts
│   ├── anthropic.client.ts
│   ├── python-sidecar.client.ts
│   └── storage.client.ts      # fs wrapper; same interface will back S3 later
├── jobs/
│   ├── runner.ts              # JobRunner interface + DB-polling implementation
│   ├── handlers/
│   │   ├── dxf-extraction.handler.ts
│   │   ├── dxf-render.handler.ts
│   │   ├── tava-extraction.handler.ts
│   │   ├── addon-extraction.handler.ts
│   │   ├── core-analysis.handler.ts
│   │   └── addon-run.handler.ts
│   └── recovery.ts            # boot-time stuck-job reaper
├── middlewares/
│   ├── index.ts
│   ├── request-id.middleware.ts
│   ├── auth.middleware.ts
│   ├── require-admin.middleware.ts
│   ├── require-project-access.middleware.ts
│   ├── upload.middleware.ts             # multer stream-through-to-S3 engine, decodeOriginalName
│   ├── validate.middleware.ts           # moved from middlewares.ts
│   ├── error-handler.middleware.ts      # moved
│   └── not-found.middleware.ts          # moved
├── bootstrap/
│   ├── seed-admin.ts
│   └── start-job-runner.ts
├── index.ts                              # API entrypoint — starts Express only
└── worker.ts                             # worker entrypoint — starts job runner only
```

**Two entrypoints, one codebase.** `index.ts` imports the HTTP stack but does NOT start the worker loop. `worker.ts` imports `jobs/runner.ts` + handlers and starts the loop; it does NOT import Express. Both call the shared bootstrap (env validation, Prisma connect, logger setup). `package.json` scripts: `npm start` → `node dist/index.js`; `npm run worker` → `node dist/worker.js`. Production runs these as two separate deployments.

### 5.2 Middleware pipeline

Global order in `app.ts`:

```
requestId → morgan → helmet → cors → rateLimiter → cookieParser → express.json → [routes] → notFound → errorHandler
```

Per-route chain example (`POST /api/projects/:id/dxf`):

```
auth → requireProjectAccess → upload.single('file') → validate → controller → service → data-access
```

### 5.3 Integrations layer contracts

```ts
// integrations/auth-cookie.ts
signToken(userId: string): string
verifyToken(token: string): { sub: string } | null
setAuthCookie(res: Response, userId: string): void
clearAuthCookie(res: Response): void

// integrations/password.ts
hash(plaintext: string): Promise<string>
compare(plaintext: string, hash: string): Promise<boolean>

// integrations/anthropic.client.ts
callClaude(opts: { system, user, model: 'opus'|'sonnet'|'haiku', maxTokens, reqId }): Promise<{ text, stopReason }>
streamClaude(opts: { system, user, model, maxTokens, reqId }): AsyncIterable<{ type: 'delta', text } | { type: 'stop', text, stopReason }>
parseJsonResponse<T>(raw: string): T   // fence-stripping + truncation repair

// integrations/python-sidecar.client.ts
extractDxf(opts: { sourcePresignedUrl, reqId }): Promise<PythonExtractionResult>
renderDxf(opts: { sourcePresignedUrl, destPresignedPuts: [{ key, putUrl }], reqId }): Promise<PythonRenderResult>

// integrations/storage.client.ts — S3-first, LOCAL for dev
uploadStream(kind: FileKind, ext: string, stream): Promise<{ uri, sha256, sizeBytes, key }>
presignGet(uri: string, ttlSeconds?: number): Promise<string>
presignPut(kind: FileKind, ext: string): Promise<{ uri, key, putUrl }>
deleteByUri(uri: string): Promise<void>

// integrations/redis.client.ts
redis: IORedis                            // shared instance; used by rate-limit-redis
```

### 5.4 Types

`server/src/types/express.d.ts` augments `Request`:

```ts
interface Request {
  id: string
  user?: { id, email, name, role }
  project?: { id, ownerId }   // set by requireProjectAccess
}
```

### 5.5 Dependencies added to `server/package.json`

- `bcryptjs` + `@types/bcryptjs`
- `jsonwebtoken` + `@types/jsonwebtoken`
- `cookie-parser` + `@types/cookie-parser`
- `multer` + `@types/multer`
- `@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, `@aws-sdk/s3-request-presigner`
- `ioredis`
- `rate-limit-redis`
- `@anthropic-ai/sdk`
- `cuid` (already implicit via Prisma)
- No `bullmq` — deferred (Job table is enough for v1)

### 5.6 Environment variables (added to [server/src/utils/env.ts](../../../server/src/utils/env.ts))

All validated at boot with Zod; server exits on missing/invalid.

```
# Existing
PORT
DATABASE_URL
DIRECT_URL
CORS_ORIGIN

# Auth
JWT_SECRET                     # ≥32 chars
ADMIN_EMAIL                    # valid email
ADMIN_INITIAL_PASSWORD         # ≥8 chars

# Object storage
S3_ENDPOINT                    # e.g. https://<account>.r2.cloudflarestorage.com
S3_REGION                      # e.g. auto (R2) or us-east-1 (S3)
S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY
S3_BUCKET
S3_FORCE_PATH_STYLE            # "true" for MinIO/R2-path-style, "false" for AWS

# Redis
REDIS_URL                      # e.g. redis://default:pw@host:6379

# Python sidecar
PYTHON_SIDECAR_URL             # e.g. http://python-sidecar:5000

# Anthropic
ANTHROPIC_API_KEY

# Local dev only — ignored in prod
STORAGE_BACKEND                # "S3" | "LOCAL", default "S3"
```

---

## 6. Client Structure

### 6.1 Dependencies added to `client/package.json`

- `axios`
- `@tanstack/react-query`
- `react-router-dom`
- `react-hook-form`
- `zod`
- `date-fns` (Hebrew locale friendly)

### 6.2 Folder layout

```
client/src/
├── api/
│   ├── client.ts                       # axios: baseURL '/api', withCredentials: true
│   ├── auth.api.ts
│   ├── admin-users.api.ts
│   ├── projects.api.ts
│   ├── uploads.api.ts
│   ├── analyses.api.ts
│   ├── addon-runs.api.ts
│   └── chat.api.ts                     # fetch-with-stream for POST /chat (SSE parser)
├── hooks/
│   ├── useAuth.ts
│   ├── useAdminUsers.ts
│   ├── useProjects.ts
│   ├── useProject.ts
│   ├── useUploads.ts
│   ├── useAnalysis.ts                  # polling hook
│   ├── useAddonRuns.ts
│   └── useChat.ts                       # streaming mutation: optimistic user msg, append token-by-token
├── components/
│   ├── layout/
│   │   ├── AppShell.tsx
│   │   └── Sidebar.tsx
│   ├── guards/
│   │   ├── ProtectedRoute.tsx
│   │   └── RequireRole.tsx
│   ├── compliance/
│   │   ├── ComplianceStatusBadge.tsx   # 4 states in Hebrew
│   │   └── ComplianceReport.tsx        # per-requirement list
│   ├── files/
│   │   ├── FileDropzone.tsx
│   │   └── ExtractionStatusPill.tsx
│   ├── dxf/
│   │   ├── DxfPreviewGrid.tsx
│   │   └── DxfPreviewLightbox.tsx
│   ├── addons/
│   │   └── AddonAgentCard.tsx
│   └── chat/
│       └── ChatPanel.tsx
├── pages/
│   ├── LoginPage.tsx
│   ├── HomePage.tsx                     # project dashboard for current user
│   ├── NewProjectPage.tsx               # 4-step wizard
│   ├── ProjectPage.tsx                  # files + run button + history
│   ├── AnalysisPage.tsx                 # core results + add-ons + renders + chat panel
│   ├── ChangePasswordPage.tsx
│   ├── AdminUsersPage.tsx
│   └── AdminStatsPage.tsx
└── providers/
    ├── QueryClientProvider.tsx
    └── RouterProvider.tsx
```

### 6.3 Routes

| Path                           | Gate     | Page                |
|--------------------------------|----------|---------------------|
| `/login`                       | public   | LoginPage           |
| `/`                            | auth     | HomePage            |
| `/projects/new`                | auth     | NewProjectPage      |
| `/projects/:id`                | O        | ProjectPage         |
| `/analyses/:id`                | O        | AnalysisPage        |
| `/change-password`             | auth     | ChangePasswordPage  |
| `/admin/users`                 | admin    | AdminUsersPage      |
| `/admin/stats`                 | admin    | AdminStatsPage      |

### 6.4 Server-state pattern

Every API call goes through a TanStack Query hook. No raw `axios` in components.

Polling: `useAnalysis(id)` uses `refetchInterval: 2500` while `status` is in-flight, disables polling once terminal.

### 6.5 Hebrew / RTL

`<html dir="rtl" lang="he">` in `index.html`. Tailwind is otherwise LTR-neutral; use logical properties (`ms-*`, `me-*`) where mirroring matters.

### 6.6 Dev environment

Vite proxy in [client/vite.config.ts](../../../client/vite.config.ts):
```ts
server: { proxy: { '/api': 'http://localhost:3001' } }
```
Cookies stay same-origin in dev.

### 6.7 Schemas

Client owns a copy of each Zod schema; top comment says "keep in sync with `server/src/api/schemas/<name>.ts`." Shared-schema package deferred until ≥3 schemas shared.

---

## 7. DXF Pipeline

### 7.1 Python sidecar service

**Container:** new compose service `python-sidecar`, FastAPI 0.115+, uvicorn, ezdxf ≥1.3, matplotlib ≥3.9, numpy, shapely. Same `uploads/` volume mounted at same path as the Node container. Listens on `python-sidecar:5000` (internal only — no host port).

**Endpoints:**
```
POST /extract     { storedFileUri }       → { raw, viewports[], parsedValues[] }
POST /render      { storedFileUri, outputDir } → { renders: [{ kind, filename, viewportBlock? }] }
GET  /health
```

Every request forwards `X-Request-Id` from Node's `req.id` into the sidecar's logs. Response time per extraction: <2s for typical files (warm), <3s for large; per render: 4-8s (up to 8 viewport renders).

**Extraction logic** implements PRD §9 knowledge:
- Iterate `doc.blocks` filtered to `VIEWPORT*` names (§9.1 central insight)
- `_combine_and_scrub_surrogates` helper on all extracted text (§9.4)
- ASCII-escape fallback on final JSON encode (§9.4)
- Classifier with the 10 rules from PRD §9.3, keyword lists explicitly listed in code
- Returns data shaped for direct bulk-insert into `Viewport` + `ParsedValue` tables

**Rendering logic** implements PRD §9.5-§9.6:
- Modelspace render if ≥20 entities (`plan_overview` 150 DPI, `plan_detail` 300 DPI)
- Otherwise iterate viewport blocks, render up to 8 with ≥20 entities each
- ACI color table, layer inheritance, supported entity types per PRD
- ASCII-only text filter (Hebrew labels skipped)
- Writes PNGs to `outputDir`, returns filenames

### 7.2 Node-side DXF upload flow (stream-through to S3)

`POST /api/projects/:id/dxf`:
1. Multer custom engine pipes the multipart body through a sha256 Transform into `@aws-sdk/lib-storage::Upload` targeting `s3://<bucket>/dxf/<cuid>.dxf`. Neither disk nor full memory buffering; sha256 falls out of the same pipe.
2. **Dedup check:** if a `StoredFile` with same `(sha256, kind=DXF)` already exists AND is referenced by a `DxfFile` on **this project** (including soft-deleted) → `DeleteObject` the just-uploaded S3 object, undelete the existing row if soft-deleted, return it. No new DB row. Per-project on purpose (§4.4).
3. Otherwise, inside `$transaction`:
   - Insert `StoredFile` (kind=DXF, store=S3, uri=`s3://...`, sha256, sizeBytes)
   - Insert `DxfFile` with `extractionStatus=PENDING`, `storedFileId`, `projectId`
   - Soft-delete prior current `DxfFile` on project (if any)
   - Enqueue `Job { type: DXF_EXTRACTION, dxfFileId }`
4. Return created row (UI polls for extraction completion).

### 7.3 DXF_EXTRACTION job handler

Runs in the **worker** process, not the API:

1. Transition `Job.status=RUNNING` + bump `DxfFile.extractionStatus=EXTRACTING`; `heartbeatAt=now`.
2. Generate a short-lived presigned GET URL for the `StoredFile.uri` (TTL 10 min — enough for the sidecar to fetch).
3. `POST <PYTHON_SIDECAR_URL>/extract` with `{ sourcePresignedUrl, reqId }` and a 60s timeout.
4. Sidecar downloads via the presigned URL to its `/tmp`, runs ezdxf, returns `{ rawExtractedData, viewports[], parsedValues[] }`.
5. On failure: `Job.status=FAILED`, `DxfFile.extractionStatus=FAILED`, `extractionError`, audit `dxf.extraction.failed`.
6. On success, inside `$transaction`:
   - `DxfFile.rawExtractedData=<raw>`, `extractionStatus=COMPLETED`
   - Bulk-insert `Viewport` rows with pre-generated cuid ids (so `ParsedValue` rows know the FK)
   - Bulk-insert `ParsedValue` rows
7. Enqueue `Job { type: DXF_RENDER, dxfFileId }` (best-effort, not awaited).
8. `Job.status=COMPLETED`.

### 7.4 DXF_RENDER job handler

1. Fetch `DxfFile.storedFile`.
2. Generate a source presigned GET URL (10 min TTL).
3. Pre-provision up to N presigned PUT URLs (one per expected render — the sidecar tells us in practice, so we over-provision to N=10 to be safe) for keys `renders/<dxfFileId>/<renderCuid>.png`.
4. `POST <PYTHON_SIDECAR_URL>/render` with `{ sourcePresignedUrl, destPresignedPuts, reqId }`. 120s timeout.
5. Sidecar renders matplotlib PNGs locally, then `PUT` each via its presigned URL. Returns `{ renders: [{ kind, key, sha256, sizeBytes, viewportBlock? }] }`.
6. On failure: log, mark `Job.status=FAILED` — but DO NOT propagate (renders never block analysis, §2.13).
7. On success, inside `$transaction`, for each returned render: insert `StoredFile` (kind=RENDER, uri=`s3://<bucket>/<key>`, sha256 echoed from sidecar) + `RenderedImage` row.
8. `Job.status=COMPLETED`.

### 7.5 DXF pipeline efficiency recap

- **Stateless end-to-end.** Neither API nor sidecar persists anything to local disk beyond `/tmp`.
- **No re-upload** on re-upload of identical bytes (sha256 dedup), no re-extraction either.
- **No re-extraction** across analysis re-runs (normalized tables cached).
- **No blocking renders** (own best-effort job, failure is absorbed).
- **Bulk-insert normalized rows** via Prisma `createMany` (hundreds of rows per upload, one round-trip per table).
- **Warm Python** via sidecar (no ~500 ms cold-start per call).
- **Canonical UTF-8** via JSON HTTP body (surrogate-pair stdout bugs eliminated).
- **Zero egress through Node** on reads — render endpoint redirects to a presigned S3 URL.

---

## 8. PDF / OCR Pipeline (תב"ע + add-on docs)

Runs inside the **worker** process (`pdftotext` and `tesseract` are system binaries in the worker image). The worker fetches the PDF bytes from S3 into its ephemeral `/tmp`, processes, then discards.

### 8.1 Flow (TAVA_EXTRACTION / ADDON_EXTRACTION job)

0. Download `StoredFile` bytes from S3 into `/tmp/<jobId>.pdf` (via presigned GET URL + `https` stream to file). After the job returns, the tmp file is deleted.
1. `execFile('pdftotext', ['-layout', tmpPath, '-'])`, capture stdout
2. If `stdout.trim().length > 100` → treat as digital PDF, `extractionMethod=PDF_TEXT`, raw text = stdout
3. Else → OCR fallback:
   - `execFile('pdftoppm', ['-tiff', '-r', '300', tmpPath, tmpBase])` — render all pages to 300 DPI TIFFs in `/tmp`
   - For each TIFF in parallel (concurrency=4): `execFile('tesseract', [tif, '-', '-l', 'heb+eng', '--psm', '1'])`
   - Prefix each page with `--- עמוד N ---`, concatenate
   - `extractionMethod=TESSERACT_OCR`
4. Split raw text into per-page rows for `TavaPage` (uses the `--- עמוד N ---` markers, or single page for PDF_TEXT)
5. For TavaFile: call `parseTavaRequirements(rawText)` → Claude Opus with `maxTokens=16000` → JSON-repair → `createMany` on `Requirement`
6. For AddonDocument: no requirement parsing needed (add-on agents read the raw text directly)
7. Inside `$transaction`:
   - `TavaFile/AddonDocument.rawExtractedText`, `extractionMethod`, `extractionStatus=COMPLETED`
   - `createMany` `TavaPage`, `createMany` `Requirement`

### 8.2 `parseTavaRequirements` critical settings

- `max_tokens=16000` (Hebrew tokenizes poorly; do not go below)
- `parseJsonResponse` in `integrations/anthropic.client.ts` handles:
  1. Strip ` ```json ` fence
  2. Strip trailing ` ``` `
  3. Find first `[` or `{`
  4. `JSON.parse`
  5. On parse error, if started with `[`, slice back to last `}` + append `]` (salvage truncated arrays)
- Warn-log when `stop_reason === 'max_tokens'` (signal to raise the cap)

### 8.3 Caching

Extraction runs once per `TavaFile` / `AddonDocument` row. Re-upload of identical bytes (sha256 match on the same project) short-circuits as in §7.2.

---

## 9. Agents

### 9.1 Core compliance agent

Triggered by `CORE_ANALYSIS` job. `core-analysis.service.ts::runCoreAnalysis(analysisId)`.

**Preflight:**
- Upload pipelines already populate `DxfFile` + `Viewport` + `ParsedValue` and `TavaFile` + `Requirement` + `TavaPage` via their own jobs. The analysis job assumes both are complete (the analyze endpoint refuses to enqueue otherwise, see §4.5).
- Status transitions: `PENDING` → `ANALYZING` → `COMPLETED | FAILED`. The PRD's `EXTRACTING_DXF` / `EXTRACTING_TAVA` states are eliminated because extraction is decoupled from the analysis lifecycle.

**Prompt assembly** (`compliance-agent.service.ts::buildCorePrompt`):
- Query `Requirement[]` for `tavaFileId`
- Query `Viewport[]` + `ParsedValue[]` for `dxfFileId`
- Group viewports into 6 buckets (floorPlans, crossSections, elevations, survey, parking, areaCalculation) per PRD §8.6
- For each bucket, build a plain-text summary: `Labels: …`, `Heights: …`, `Dimensions: …`, `Percentages: …`, `Geometry: …` — pulled from `ParsedValue` rows, not from the JSON blob
- Include first 8000 chars of `TavaFile.rawExtractedText` as fallback context
- System prompt: Hebrew, explicit PASS/FAIL/WARNING/CANNOT_CHECK instructions, `dxfEvidence` required for each result, `CANNOT_CHECK` must cite what's missing

**Call:** `callClaude({ model: 'opus', maxTokens: 16000, ... })`.

**Post:**
- `parseJsonResponse` → array of result objects
- `createMany` into `ComplianceResult` with `analysisId` set
- Aggregate counts into `Analysis.passCount|failCount|warningCount|cannotCheckCount`
- `score = round(100 * pass / (pass + fail + warning))`
- `status=COMPLETED`, `completedAt=now`, audit `analysis.completed`

### 9.2 Add-on agents

`base-addon-agent.ts` + 4 concrete files (`fire-addon.ts`, `water-addon.ts`, `electricity-addon.ts`, `accessibility-addon.ts`). Each overrides:
- `domain: AddonDomain`
- `displayName: string` (Hebrew)
- `systemPromptSuffix: string` (domain-specific instructions)

Base class:
1. Fetch `AddonDocument.rawExtractedText` (truncate 8000 chars)
2. Fetch `TavaFile.rawExtractedText` (truncate 3000 chars) for cross-reference
3. Fetch `Viewport` + `ParsedValue` summaries (same shape as core)
4. Assemble Hebrew prompt
5. `callClaude({ model: 'opus', maxTokens: 12000 })`
6. Parse + bulk-insert `ComplianceResult` with `addonRunId` set
7. Aggregate counts into `AddonRun`, `status=COMPLETED`

### 9.3 Chat agent (per-project, streaming via SSE)

`chat.controller.ts` holds the SSE response open; `chat.service.ts::respond(projectId, userContent, res)` drives it:

1. Inside a transaction: persist `ChatMessage { role: USER, content: userContent }`. Emit SSE `user-message` event with the persisted row.
2. Assemble context (same shape as before):
   - Last 20 `ChatMessage`s (conversational continuity, excluding the one just inserted)
   - Latest `Analysis.summary` + latest 20 `ComplianceResult`s across core + add-on runs
   - Latest `TavaFile.rawExtractedText` truncated to 4000 chars
   - Latest `DxfFile` viewport summary (same builder as §9.1)
3. `streamClaude({ model: 'opus', maxTokens: 4000, reqId, ... })` — consumes Anthropic SDK's streaming API.
4. For each `{ type: 'delta', text }` yielded by the stream: append to a running buffer AND emit SSE `token` event with `{ text }`.
5. On `{ type: 'stop', text, stopReason }`:
   - Persist `ChatMessage { role: ASSISTANT, content: text }` in a transaction.
   - Emit SSE `assistant-message` event with the persisted row.
   - End the response.
6. On any error mid-stream: emit SSE `event: error` with a safe message (no stack), then end the response. The partial assistant reply is NOT persisted (avoids half-garbled history).
7. Client-side disconnect (`req` emits `close`): the stream is aborted via `AbortController`; the controller logs `chat.aborted` and the partial reply is NOT persisted. User re-asks.

Typical total time: 3-8 s, but the first token arrives in ~300 ms. User perception is "instant."

### 9.4 Anthropic client details

`integrations/anthropic.client.ts` single choke point:
- One `Anthropic` instance from `@anthropic-ai/sdk`
- `callClaude({ system, user, model, maxTokens, reqId })` — non-streaming, returns `{ text, stopReason, inputTokens, outputTokens }`
- `streamClaude({ system, user, model, maxTokens, reqId, signal? })` — async-iterable yielding deltas then a final stop event
- Model shorthand → exact IDs: `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001` (as of 2026-04-19)
- Logs `{ reqId, model, inputTokens, outputTokens, ms, stopReason }` at info level
- Warn-log when `stopReason === 'max_tokens'`
- `parseJsonResponse<T>` exported alongside

---

## 10. Job Queue / Orchestrator

### 10.1 JobRunner interface

```ts
// jobs/runner.ts
interface JobRunner {
  enqueue(input: { type: JobType; payload: Json; [fkField]?: string }): Promise<Job>
  cancel(jobId: string): Promise<void>
  // worker loop is started by bootstrap/start-job-runner.ts
}
```

v1 implementation: DB-polling worker running as a **separate deployment** (`src/worker.ts` entrypoint). API processes DO NOT run the loop. Scale API and worker independently.

### 10.2 Worker loop

```
every 2s:
  tx = begin transaction
  job = SELECT * FROM Job WHERE status='PENDING' ORDER BY createdAt LIMIT 1 FOR UPDATE SKIP LOCKED
  if not job: commit, sleep
  set job.status='RUNNING', startedAt=now, heartbeatAt=now, attempts=attempts+1
  commit
  try:
    handler = handlers[job.type]
    await handler(job)
    set job.status='COMPLETED', completedAt=now
  catch err:
    set job.status='FAILED', errorMessage=err.message, completedAt=now
    // no automatic retry in v1; manual re-enqueue via admin UI later
```

`FOR UPDATE SKIP LOCKED` makes N worker instances safe. Scale horizontally by running more `worker.ts` processes against the same DB. Heartbeat update every 30 s during long handlers so the boot-time reaper knows the job is alive.

### 10.3 Handlers

One per `JobType` (see §5.1). Each handler receives the full `Job` row and does its work idempotently (safe to re-run if a prior attempt half-completed).

### 10.4 Boot-time recovery

`bootstrap/start-job-runner.ts` called from `src/worker.ts` before the worker loop starts:
1. `UPDATE Job SET status='FAILED', errorMessage='interrupted by server restart', completedAt=now WHERE status='RUNNING' AND (heartbeatAt IS NULL OR heartbeatAt < now - interval '30 seconds')`
2. `UPDATE Analysis SET status='FAILED', errorMessage='interrupted by server restart', completedAt=now WHERE status IN ('PENDING','ANALYZING') AND createdAt < now - interval '30 minutes'`
3. Same for `AddonRun`
4. Start the worker loop

The API process does NOT run this recovery (it's not managing jobs). Running it on both would race — leave it exclusively to workers. If you scale to 0 workers temporarily, stuck rows don't get reaped until a worker comes back; that's fine.

### 10.5 Swapping to BullMQ later

The `JobRunner` interface is the stable boundary. A `BullMqJobRunner` implementation would:
- `enqueue` → push to a BullMQ queue + insert a `Job` row (for audit + UI visibility)
- A BullMQ worker runs the same handlers, updating the same `Job` row's status fields
- `cancel` → BullMQ cancel + update row

Zero controller / service changes.

---

## 11. Testing

### 11.1 Unit (Jest, `npm test`)

- `integrations/*` — each client covered (roundtrip, error cases)
- Each `service` — happy path + every explicit invariant (one test per bullet in §4.x)
- Each `middleware` — allow / deny / error cases
- `bootstrap/seed-admin.ts` — create, no-op, drift repair
- `jobs/runner.ts` — pick-up, retry semantics, heartbeat
- `compliance-agent.service.ts::buildCorePrompt` — viewport grouping, requirement interleaving, truncation

### 11.2 Integration (`npm run test:integration`, real DB)

- Login → authed request → logout round-trip
- Admin create user → user login → admin disable → 401 on next request
- Upload DXF → job runs → DxfFile completed + Viewports + ParsedValues exist
- Upload identical DXF again → dedup kicks in, no new StoredFile
- Upload TAVA PDF (digital) → pdftotext path → Requirements populated
- Full `/analyze` → Analysis completed with ComplianceResults
- Addon run on FIRE domain → AddonRun completed
- Chat request → assistant message persists
- Server restart during a running job → boot recovery marks it FAILED

### 11.3 Client (Vitest)

- Hooks (`useAuth`, `useProjects`, `useAnalysis`) — happy paths + 401 invalidation
- Guards (`ProtectedRoute`, `RequireRole`) — redirect behavior
- ComplianceReport rendering of 4 status types

### 11.4 E2E (Playwright, smoke subset)

- Login → create project → upload DXF + TAVA → run analysis → see results + thumbnails
- Admin creates user → new user logs in

### 11.5 Fixtures

- One known-good Israeli permit DXF (anonymized) + matching TAVA PDF + one addon PDF (fire) in `fixtures/`
- Referenced by integration + Playwright tests; checked into git

---

## 12. Documentation (Knowledge Vault)

Per [CLAUDE.md](../../../CLAUDE.md), vault pages updated in the same PRs that deliver code. Pages added:

```
docs/vault/
├── 10-Architecture/
│   ├── System Overview.md              # updated
│   ├── Request Lifecycle.md            # updated
│   ├── Job Queue and Orchestrator.md   # new
│   └── Python Sidecar.md               # new
├── 20-Client/
│   ├── Auth State.md
│   ├── Polling Analysis.md
│   └── components/                     # per-component pages (skipping list here)
├── 30-Server/
│   ├── Auth - Login Flow.md
│   ├── Auth - Middleware Chain.md
│   ├── Auth - Admin Seeder.md
│   ├── Uploads - Dedup and Cache.md
│   ├── DXF Pipeline.md
│   ├── PDF OCR Pipeline.md
│   ├── Core Compliance Agent.md
│   ├── Addon Agents.md
│   └── Chat Agent.md
├── 35-API/
│   └── (one file per endpoint — ~30 files)
├── 40-Data/
│   └── (one file per model — ~17 files)
├── 50-Flows/
│   ├── Login and Session.md
│   ├── Admin Creates User.md
│   ├── Upload and Extract DXF.md
│   ├── Upload and OCR TAVA.md
│   ├── Run Core Analysis.md
│   ├── Run Addon Agent.md
│   └── Chat Against Project.md
└── 00-Index/
    └── (MOCs updated throughout)
```

Use `obsidian:obsidian-markdown` skill for frontmatter, wikilinks, callouts.

---

## 13. Implementation Phases

Feeds the `writing-plans` skill. Each phase is a reviewable checkpoint; each produces green `npm run typecheck` + `npm test` + integration tests (once they exist for that area).

**Phase 0 — Foundations (scaffolding, no feature logic).**
- `requestId` middleware, `cookieParser`, CORS `credentials: true`
- Split `middlewares.ts` → `middlewares/` folder
- `integrations/` folder skeleton with `auth-cookie.ts` + `password.ts` + `redis.client.ts`
- Env vars added to [server/src/utils/env.ts](../../../server/src/utils/env.ts) per §5.6 (auth + S3 + Redis + Python sidecar + Anthropic)
- `docker-compose.yml` at repo root: Postgres + Redis + MinIO + Python sidecar + Node API + Node worker
- Redis-backed `rate-limit-redis` wiring (global limiter + login-specific limiter)
- `src/worker.ts` entrypoint skeleton (runs nothing useful yet, just confirms it boots)

**Phase 1 — Auth + roles.**
- Prisma models: `User`, `AuditLog`; first migration
- `bootstrap/seed-admin.ts`
- Auth routes (login, logout, me, change-password) + middleware + service + tests
- Admin routes (list, create, delete, reset-password, active toggle, stats) + tests
- Client: login page, auth state hook, protected route, admin users page

**Phase 2 — Projects + S3 storage.**
- Prisma models: `StoredFile`, `Project`; migration
- `integrations/storage.client.ts` — S3 implementation via `@aws-sdk/client-s3` + `@aws-sdk/lib-storage`; LOCAL fallback for `STORAGE_BACKEND=LOCAL`
- Integration tests run against MinIO in docker-compose
- Project CRUD endpoints + tests
- Client: project list (HomePage), create-project page, project detail page

**Phase 3 — Jobs infrastructure + worker deployment.**
- Prisma model: `Job`; migration
- `jobs/runner.ts` + worker loop
- `bootstrap/start-job-runner.ts` + boot recovery
- `src/worker.ts` starts the loop; `src/index.ts` does NOT
- Integration test: spin up API-only and worker-only processes, confirm jobs flow
- No handlers yet

**Phase 4 — DXF upload + extraction + render.**
- Prisma models: `DxfFile`, `Viewport`, `ParsedValue`, `RenderedImage`; migration
- Python sidecar Dockerfile + FastAPI app + `/extract`, `/render`, `/health` — S3-aware (boto3 fetches via presigned GET, uploads via presigned PUT)
- `integrations/python-sidecar.client.ts` — passes presigned URLs
- `middlewares/upload.middleware.ts` — custom multer storage engine that streams to S3 with sha256 Transform
- Upload endpoint + `decodeOriginalName` + sha256 dedup (with S3 `DeleteObject` on dedup-hit)
- Handlers: `dxf-extraction.handler.ts`, `dxf-render.handler.ts`
- Renders route: 302 redirect to presigned GET URL
- Client: DXF upload in project page, DxfPreview grid + lightbox

**Phase 5 — TAVA upload + OCR + requirements.**
- Prisma models: `TavaFile`, `TavaPage`, `Requirement`; migration
- `services/tava-extraction.service.ts` — download from S3 to `/tmp`, `pdftotext` + `tesseract` parallel, delete `/tmp` file
- `parseTavaRequirements` via `integrations/anthropic.client.ts`
- Handler: `tava-extraction.handler.ts`
- Client: TAVA upload in project page

**Phase 6 — Core compliance agent.**
- Prisma models: `Analysis`, `ComplianceResult`; migration
- `compliance-agent.service.ts::buildCorePrompt` (reads normalized tables, NOT the raw JSON)
- `core-analysis.service.ts` + handler
- Analyze endpoint + analysis-status polling
- Client: AnalysisPage with results + score + thumbnails

**Phase 7 — Add-on agents.**
- Prisma models: `AddonDocument`, `AddonRun`; migration
- Base + 4 concrete agents
- Upload + run endpoints
- Client: AddonAgentCard × 4

**Phase 8 — Chat with SSE streaming.**
- Prisma model: `ChatMessage`; migration
- `chat.service.ts` with `streamClaude` integration
- `POST /api/projects/:id/chat` as SSE endpoint; `GET` as history
- Client: `chat.api.ts` with streaming parser (fetch + ReadableStream), `useChat.ts` optimistic hook, `ChatPanel.tsx` with token-by-token rendering
- Abort on unmount / tab close

**Phase 9 — Polish + docs.**
- Hebrew UI copy review
- All vault pages written/updated
- Playwright smoke
- `docker-compose.prod.yml` example, deploy script, reverse-proxy template

**Phase 10 — One-shot build prompt.**
- Final deliverable: a self-contained prompt that rebuilds the entire app from scratch. Lives at `docs/superpowers/prompts/build-from-scratch.md`.

---

## 14. Open Questions / Deferred

Captured so nothing is lost. None block v1.

1. Multi-admin support (seeder reads `ADMIN_EMAILS` list)
2. Audit-log UI for admins
3. Per-email login lockout on brute-force signal
4. Token-version column for forced-logout-on-password-reset
5. Refresh-token flow
6. Shared-schema package between client and server
7. Direct-to-S3 client uploads (two-phase presigned PUT) — replaces proxy uploads if bandwidth warrants
8. pgvector / RAG for chat (pull in past similar analyses)
9. BullMQ swap (Redis is already provisioned by §2.19)
10. SSE for analysis-status live updates (replaces 2.5s polling)
11. 3D DXF entity support
12. DWG file support (client-side export step in UI)
13. Periodic cleanup job for orphan S3 objects (rows deleted but object left behind, or vice versa)
14. Metrics / tracing backend (Prometheus, OTEL)
15. Rate limits on analyze endpoint (Claude spend cap)
16. CDN in front of the renders endpoint (currently Node generates presigned URLs per request)

---

## 15. Approval

Approved by the user during brainstorm on 2026-04-19. This document supersedes `2026-04-19-auth-roles-security-design.md`. Drift from this spec must be corrected either in code or in this file — not silently tolerated.

Next step: `superpowers:writing-plans` skill produces an implementation plan that maps directly to §13 phases.
