# BuildCheck AI — Full Redesign for the Clearance Codebase

**Date:** 2026-04-19 (original), **revised 2026-04-20** for v3 DXF pipeline, **revised 2026-04-21** for v3.1 visual-bridge codegen
**Status:** Approved for implementation planning. Phases 0 + 1a + 1b + 2 + 3 + 4a already merged into `integration/buildcheck`; v3.1 pipeline applies to Phase 4b onward.
**Supersedes:** `2026-04-19-auth-roles-security-design.md` (which covered only the auth slice).

This spec is the canonical end-to-end design for rebuilding BuildCheck AI in the Clearance codebase. It covers every subsystem: identity, projects, file storage, DXF/PDF pipelines, compliance agents, chat, and the job queue. Implementation is phased (§13) but the design is unified.

### Revision note — 2026-04-21 (v3.1 visual-bridge codegen)

v3 (2026-04-20) fed Claude a text-only `explorationJson` and leaned on an elaborate system prompt embedding a Hebrew keyword table, a dual-viewport heuristic, and spatial-correlation rules. Ongoing testing surfaced a deeper problem: Israeli DXFs encode Hebrew in at least four different ways (Unicode escapes, raw UTF-8, SHX-font Latin substitution like `"eu cbhhi"` for `"קו בניין"`, and CP862/Windows-1255 legacy code pages). The ~40% SHX case contains zero Hebrew bytes — any decoder catalog breaks on the next architect whose font mapping differs. Hardcoded encoding logic cannot generalize.

v3.1 keeps the four-phase pipeline shape but adds a **visual bridge** so Claude can resolve encoding per-file from the drawings themselves instead of from hardcoded decoders. Changes:

- **New generic script:** `dxf_sheet_renderer.py` emits one PNG per sheet with numbered red dots overlaid at each sampled text position. Dot `N` in the PNG ↔ `text_samples[N-1]` in the exploration JSON (hard ordering invariant).
- **Explorer changes:** samples carry both `raw` (byte-exact, no decoding) and `decoded?` (best-effort Hebrew, nullable). Sampling spans `TEXT | MTEXT | ATTRIB | ATTDEF`. New encoding-signal flags per block: `hasUnicodeEscapes`, `hasNativeHebrew`, `hasPossibleShx`, `hasHighBytes`. Sample cap per block raised 30 → 50.
- **Codegen becomes multimodal:** `anthropic.generateExtractionScript()` sends `{explorationJson, thumbnails[]}`; Claude classifies sheets visually, correlates dot positions to architectural features, and emits a script that matches **raw** strings (e.g. `LABELS["building_line"] = "eu cbhhi"`) rather than decoded Hebrew. System prompt shrinks: no Hebrew keyword table, no hardcoded dual-viewport heuristic, no spatial-rule block — those become contract/shape constraints, not recognition rules.
- **Model choice (v1):** `claude-opus-4-7` + vision stays. Sonnet 4.6 + vision is a deferred A/B optimization (§14) — telemetry first. `ExtractionScript.generatedByModel` already supports the switch.
- **New sidecar endpoint `POST /render-thumbnails`** (separate from `/explore` so the cache-hit path can short-circuit before rendering). `/explore` stays fingerprint-only; `/render-thumbnails` runs only on a cache miss and writes transient PNGs. Thumbnails are deleted at the end of the handler and never persisted as `StoredFile`.
- **Matplotlib** re-enters the sidecar container (only for `/render-thumbnails`; final per-sheet SVGs still come from the generated execution script at `/execute`).
- **Phase 4a migration:** existing `DxfFile.explorationJson` + `structuralHash` are nulled on non-COMPLETED rows on Phase 4b deploy. Completed rows (none expected at this point) are untouched.

Sections affected: §2.12 (sidecar contract); §2.13 (efficiency); §2.20 (full rewrite); §3.4 (explorer output shape note); §3.12 (change-summary row); §7.1 (both endpoints); §7.3 (handler state machine); §7.4 (codegen prompts); §7.5 (efficiency recap); §13 (Phase 4b scope expanded); §14 (Sonnet A/B + visual-bridge open questions).

### Revision note — 2026-04-20 (v3 DXF pipeline)

The original 2026-04-19 spec described a v2-style DXF pipeline: a FastAPI sidecar with hardcoded `/extract` + `/render` endpoints, normalized `Viewport` + `ParsedValue` tables, and PNG renders. External testing across multiple architects' files proved the hardcoded extractor breaks on each new architect — block names, layer conventions, coordinate scales, and sheet organization vary too much for static code.

This revision adopts the v3 pipeline: a generic `dxf_explorer.py` produces a structural fingerprint; Claude Opus writes a file-specific extraction script; the script executes and emits a structured `compliance_data.json` + SVG renders per sheet; a self-correction loop re-prompts Claude with the traceback when generated code crashes. Key consequences:

- Dropped models: `Viewport`, `ParsedValue`, `RenderedImage`, plus enums `ViewportType`, `ParsedValueKind`, `RenderKind`.
- New models: `SheetRender` (per-sheet metadata + SVG), `ExtractionScript` (global structural-hash cache). `StoredFile.kind` gains `EXTRACTION_SCRIPT`.
- `DxfFile` fields change: `rawExtractedData → explorationJson`, new `complianceData` + `extractionTrace` + `structuralHash`.
- Sidecar contract changes: `/extract` + `/render` replaced by `/explore` + `/execute`. Sidecar no longer calls Claude; Node owns all Anthropic calls.
- `DXF_RENDER` job type removed. Renders are a side-effect of `/execute` and persist in the same transaction as `complianceData`.
- Core + add-on agents consume `complianceData` JSON + `SheetRender` list (pass-through) instead of viewport-summary strings. `ComplianceResult.sheetRenderId?` links citations to sheets.
- Phase 4 splits into 4a (sidecar + upload + explore), 4b (codegen + execute + self-correct), 4c (SheetRender persistence + client viewer).

Sections affected: §2.12, §2.13, added §2.20; §3.2 (FileKind enum); §3.4 (DXF subsystem); §3.9 (ComplianceResult); §3.12 (change-summary additions); §5.1 (data-access files); §7 (full rewrite); §9.1–§9.3; §13 (Phase 4 split); §14 (added open questions).

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

### 2.7 File storage — bytes on disk, metadata as entities

Never store file bytes in Postgres. File bytes go to disk (LOCAL store) with a migration path to S3 (same `StoredFile` row, flipped `store`/`uri`). Supports streams, `sendfile()`, `pg_dump` stays small.

Single `StoredFile` model unifies metadata for DXF/תב"ע/addon docs/renders. Every file-bearing entity owns a 1:1 FK to `StoredFile`.

`sha256` is the dedup / "changed?" signal. Re-uploading identical bytes to the same project detects the match (no duplicate row, no duplicate file on disk, no re-extraction).

### 2.8 Normalization policy

User-facing data is normalized into relational tables where that normalization is stable and queryable. No JSON blobs for anything the user filters or lists — `Requirement`, `TavaPage`, `SheetRender`, `ComplianceResult` are all normalized.

**Three JSON columns are deliberate exceptions**, all on `DxfFile` and all machine-fuel (never surfaced in the UI):
- `explorationJson` — `dxf_explorer.py` fingerprint output; used to compute `structuralHash` and as input to the codegen prompt.
- `complianceData` — v3 extractor's structured output (setbacks, heights, dimensions, parking, survey). Passed through to agent prompts unchanged. Shape evolves with the `EXTRACTION_CODEGEN_SYSTEM_PROMPT`; locking a schema around it would mean migrations on every prompt iteration (v3 prompts are still stabilizing across architects).
- `extractionTrace` — per-phase timings + attempts + cacheHit flag + traceback (if any). Debug-only.

Normalized tables: `SheetRender`, `Requirement`, `TavaPage`, `ComplianceResult`, `ExtractionScript`. See §3.

Rejected as a design trap: normalizing individual DXF entities (every `LINE`, `ARC`, `TEXT`) into rows. ~30 viewports × ~1k entities/viewport = 30k rows per upload with zero query benefit — agents consume structured measurements, not entity-level rows.

### 2.9 History preservation

Re-uploading a DXF, תב"ע, or addon document creates a new row. Prior rows remain, pinned to their past analyses. `DxfFile`, `TavaFile`, `AddonDocument` are 1:N with `Project`. An `Analysis` records the exact `dxfFileId` and `tavaFileId` it consumed; an `AddonRun` records the exact `addonDocumentId`.

"Current" file for a project = latest by `createdAt` where `deletedAt IS NULL`. Re-upload soft-deletes the prior current via the upload pipeline.

### 2.10 Soft delete — only on `Project`

`Project.deletedAt DateTime?`. All other tables cascade-delete from Project. Project is the recovery unit; lower levels are not. Orphan files on disk are cleaned by a periodic job (not in v1).

### 2.11 Job queue — DB-backed from day one

The orchestrator polls a `Job` table (`WHERE status='PENDING' ORDER BY createdAt`). Workers transition rows through `PENDING → RUNNING → COMPLETED|FAILED|CANCELLED`. Same `JobRunner` interface can swap to BullMQ+Redis later without controller changes.

Boot-time recovery: any `Job` stuck in `RUNNING` older than 30 min (or with null heartbeat) is marked `FAILED` with message `"interrupted by server restart"`. Any `Analysis` / `AddonRun` tied to such a job is marked `FAILED` in the same pass.

### 2.12 Python as an HTTP sidecar

Not `execFile('python3 ...')` per invocation. A FastAPI service in its own container exposes three endpoints for the v3.1 pipeline:
- `POST /explore` — body: `{ storedFileUri, reqId }`, returns `{ explorationJson, structuralHash, ms }`. Runs the generic `dxf_explorer.py` fingerprinter. Fingerprint only — no thumbnails. (Kept cheap so the cache-hit path can short-circuit before rendering.)
- `POST /render-thumbnails` — body: `{ storedFileUri, explorationJson, thumbnailDir, reqId }`, returns `{ thumbnails: [{sheetKey, pngUri}], ms }`. Runs `dxf_sheet_renderer.py` consuming the explorer output (never re-enumerates ezdxf for text ordering). Called only when codegen is about to run (structural-hash cache miss). Thumbnails are transient — deleted at end of handler.
- `POST /execute` — body: `{ storedFileUri, scriptUri, outputDir, reqId }`, returns `{ ok: true, complianceData, renders[], ms }` on success, or `{ ok: false, traceback, ms }` on script crash (HTTP 200 in both cases — a script crash is a normal outcome that feeds the self-correction loop).
- `GET /health` — liveness.

**Sidecar invariants:**
- Never calls Claude. No Anthropic key in Python.
- Never writes to Postgres. Node owns all DB writes.
- Shares the `uploads/` volume with Node so `storedFileUri` + `scriptUri` + `outputDir` + `thumbnailDir` resolve to the same absolute paths on both sides.
- Forwards `X-Request-Id` from Node's `req.id` into its logs for cross-service stitching.
- Matplotlib is used only for thumbnail rendering inside `/render-thumbnails`. Per-sheet SVGs in the final output still come from the AI-generated extraction script at `/execute` (no matplotlib in the generated script).

Timeouts: `/explore` 30s; `/render-thumbnails` 30s; `/execute` 120s wall clock. Node-side `DXF_EXTRACTION` job timeout 5 min (covers explore + optional thumbnails + codegen + up to two execute attempts).

One compose service, one internal port, one integration adapter (`integrations/python-sidecar.client.ts` exposing `explore()` + `renderThumbnails()` + `execute()`).

### 2.13 DXF pipeline efficiency

Applied together in §7:
- **Byte sha256 dedup** (per project): re-uploading identical bytes returns the existing `DxfFile` row, no re-extraction, no codegen cost.
- **Structural-hash cache** (global, append-only): extraction scripts are keyed by the sha256 of the canonicalized exploration JSON. Two different DXFs with the same block structure share the cached script — $1 Opus codegen cost amortizes across identical-structure files from the same architect. See §2.20.
- **Pass-through `complianceData`**: the v3 extractor's JSON is stored as-is on `DxfFile.complianceData` and consumed directly by agents. No normalization layer to drift against prompt evolution.
- **Renders inline with extraction**: final per-sheet SVGs are produced by the AI-generated script during `/execute` and persisted in the same transaction as `complianceData`. No separate `DXF_RENDER` job.
- **Per-sheet `svgWarning`**: failed/underfilled renders flag individual sheets rather than failing the whole extraction. UI surfaces warnings; agent prefers unwarned sheets when citing evidence.
- **Transient codegen thumbnails**: PNG thumbnails are produced by the separate `/render-thumbnails` endpoint, called only on a cache miss after `/explore` returns its structural hash. Written to a per-job temp directory, consumed by codegen, and deleted when the handler finishes. Not persisted as `StoredFile` — they have no post-codegen purpose. Cache hits skip this step entirely, saving ~10s per hit.

### 2.14 Chat — per-Project

`ChatMessage.projectId` (FK Project). One continuous thread per project. Chat works before, during, or after analysis. Context assembled for each assistant reply pulls from (in order of inclusion): latest `Analysis.summary` + `ComplianceResult`s, latest `TavaFile.rawExtractedText` (truncated), latest `DxfFile.complianceData` (pass-through JSON), latest `SheetRender[]` list. No vector DB in v1. See §9.3 for the full assembly.

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

### 2.19 Chat streaming via SSE

Chat replies stream to the browser as Server-Sent Events (SSE), not as a single JSON blob after 8-10 s of silence. Token-by-token rendering matches claude.ai UX and is table stakes for chat.

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

**Server handles streaming without workers / pub-sub** — chat is a single synchronous request-scoped operation. The handler:
1. Persists the `USER` `ChatMessage`, emits `user-message` event.
2. Calls the Anthropic SDK in streaming mode (`messages.stream(...)`), pipes each content delta into a `token` event.
3. On stream end, persists the `ASSISTANT` `ChatMessage` with the full content, emits `assistant-message` event, closes the response.

No `Job`, no worker, no pub/sub. SSE is scoped to this one endpoint.

**Analysis-status live updates stay on polling** for v1. Polling at 2.5 s is acceptable for status that changes 4-5 times over 3 minutes. Migrating to SSE for analysis status is §14 open-question material.

### 2.20 v3.1 DXF extraction — AI-generated per-file scripts with a visual bridge

Three sources of variance defeat any hardcoded extractor:

1. **Structural variance.** Every architect names blocks, organizes sheets, and scales coordinates differently. No Israeli standard exists.
2. **Encoding chaos.** Hebrew in Israeli DXFs is stored four different ways: Unicode escapes (`\U+05E7\U+05D5`, ~30% of files), raw UTF-8 Hebrew bytes (~20%), **SHX-font Latin substitution** where AutoCAD displays Latin characters as Hebrew through font glyph mapping (`"eu cbhhi"` renders as `"קו בניין"`, ~40% — the hardest case because the file contains zero Hebrew bytes), and legacy code pages CP862 / Windows-1255 (~10%). A decoder catalog breaks on the next architect whose SHX font mapping differs.
3. **Spatial context determines meaning.** The number `400` between a `"קו בניין"` label and a `"גבול מגרש"` label is a 4.00 m setback. The same `400` in a floor-plan dimension chain is a 4.00 m room width. Only position disambiguates.

**The core move: don't decode, let Claude see the drawings.** The v3.1 pipeline ships three generic, stable scripts that never interpret anything, plus a per-file AI-generated script. Orchestration happens Node-side.

**Four phases:**

1. **Explore — `dxf_explorer.py` (generic, static).** Fingerprints the file without interpreting anything. Per-block entity counts (`LINE / POLYLINE / CIRCLE / ARC / INSERT / TEXT / MTEXT / ATTRIB / ATTDEF`), bounding boxes, layer usage, polyline stats, INSERT graph. **Up to 50 text samples per block spanning `TEXT | MTEXT | ATTRIB | ATTDEF`**, each carrying `{raw, decoded?, x, y, block, handle, layer, entityType}`. `raw` is byte-exact ezdxf output, never decoded. `decoded` is best-effort Hebrew via `_combine_and_scrub_surrogates` (nullable — null when decoding would be lossy or indeterminate) and is kept only as a *hint*, not a source of truth. **Encoding-signal flags per block:** `hasUnicodeEscapes`, `hasNativeHebrew`, `hasPossibleShx`, `hasHighBytes`. Also emits the existing text-pattern flags (`hasIntegers`, `hasDecimals`, `hasHeights`, `hasCoordinates`). Auto-detected dual-viewport pattern is kept as a **hint**, not a hard classifier. ~5s, $0. Never changes.

2. **Render thumbnails — `dxf_sheet_renderer.py` (generic, static).** One PNG per logical sheet (~1200×900 px). Geometry (`LINE / POLYLINE / CIRCLE / ARC`) drawn in black; **numbered red dots overlaid at each sampled text position**. Hard ordering invariant: the renderer consumes `explorationJson.text_samples` and plots dots in that exact order — dot `N` in the PNG ↔ `text_samples[N-1]` in the JSON. The renderer never re-enumerates ezdxf for text ordering. Dot-density policy: keep non-numeric samples first (`length ≥ 3`, regex `^[-+]?\d+(\.\d+)?%?$` deprioritized), de-duplicate near-coincident positions (< bbox-diagonal / 200), cap at ~100 dots per sheet. Pure-numeric texts are ASCII and need no visual disambiguation. ~10s, $0. Never changes. Runs only on a structural-hash cache miss.

3. **Codegen — Claude (v1: `claude-opus-4-7` + vision).** Node sends a multimodal message containing `explorationJson` (text) and each sheet thumbnail (image). Claude (a) classifies each sheet visually (a floor plan looks like a floor plan regardless of text encoding — door swing arcs, bathroom fixtures, kitchen counters; an elevation looks like an elevation — building profile with stone hatching, windows, ground line), (b) uses the dot numbers to correlate raw text samples with architectural features, inferring what each **raw** string means for *this* file (dot `#12` sits on a boundary edge, `text_samples[11].raw == "eu cbhhi"` → in this file, `"eu cbhhi"` labels a building line), and (c) emits a Python extraction script that matches **raw strings**, not decoded Hebrew. The generated script starts with a `LABELS` dict mapping semantic names (`"building_line"`, `"plot_boundary"`, `"kitchen"`, …) to the **raw** strings actually present in the file. Numbers are encoding-agnostic (ASCII digits / decimal points / `+` / `%`); only labels need a map. ~60–90s, ~$1 per cold run. Scripts are cached by structural hash; structurally-similar files skip this phase.

4. **Execute + self-correct — `/execute` endpoint.** The generated script runs as a subprocess against the original DXF. Output: `complianceData` (setbacks, heights, dimensions, parking, survey data, label correlations) + per-sheet SVG renders. On crash, Node re-prompts Claude Opus once with the traceback + broken code; the corrected script succeeds >90% of the time. v1 allows one correction attempt; further retries are §14 deferred.

**Why "don't decode" beats a decoder catalog.** SHX font mappings vary between fonts, the `.shx` files aren't available on the server, and new encoding variants appear with every new architect's file. The visual bridge sidesteps the entire problem: Claude builds a **file-specific** label map from whatever raw strings ezdxf returns, regardless of how AutoCAD stored them. Re-exporting a file with a different encoding yields different `raw` strings AND a different structural hash, so a new cache entry is fetched — the pipeline is re-parametrized, not broken.

**Why the dot-number bridge works.** The ordering invariant (dot `N` ↔ `text_samples[N-1]`) is enforced by having the renderer consume the explorer's sample list rather than re-enumerating entities. This makes the PNG and the JSON two projections of one ordered list. Claude can point at dot `#12` in the image and reference `text_samples[11]` in the JSON; the mapping is unambiguous.

**System prompt shrinks dramatically.** v3's prompt embedded a Hebrew keyword table, a dual-viewport bbox-overlap heuristic, and prose rules for setback / dimension-chain / survey / parking extraction. v3.1 drops all of that. The new prompt describes the **contract** (required `complianceData` schema, SVG rendering rules — Y-axis flip, stroke width, ACI color table, text-as-`<text>`-elements overlay) and the **visual-bridge protocol** (how dots map to samples, required `LABELS` dict preamble, "match raw strings, not decoded Hebrew"). Recognition logic stays inside Claude's vision call, where it can adapt to whatever this specific file looks like.

**Model choice (v1 → deferred A/B).** Codegen runs on `claude-opus-4-7` + vision in v1. Opus is the reliability baseline for complex Python generation while we validate the new architecture. After Phase 4b ships and telemetry accumulates (self-correction rate, generation time, cost per cold run), Sonnet 4.6 + vision is an A/B candidate — `ExtractionScript.generatedByModel` supports the switch without migration. See §14.

**Two caches compound.** Byte-sha256 per-project dedup (identical files skip everything) and structural-hash global codegen cache (structurally-similar files skip phases 2 and 3). Cache hit: ~15s, $0 (explore + execute only). Cold first run: ~100–160s, ~$1–1.15.

**Phase 4a carry-over.** The Phase 4a explorer's `_combine_and_scrub_surrogates` is retained but repurposed: it populates `decoded` alongside `raw`, rather than being the only sample. Phase 4b ships a one-time migration that nulls `DxfFile.explorationJson` + `structuralHash` on any non-COMPLETED `DxfFile` row, forcing a re-explore on next upload. COMPLETED rows (none expected at this stage) are untouched.

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
enum FileKind   { DXF TAVA ADDON RENDER EXTRACTION_SCRIPT }
enum FileStore  { LOCAL S3 }

model StoredFile {
  id            String    @id @default(cuid())
  kind          FileKind
  store         FileStore @default(LOCAL)
  uri           String              // "uploads/dxf/<cuid>.dxf", "uploads/scripts/<cuid>.py", "s3://..." later
  originalName String                // for SCRIPT/RENDER, a synthetic name like "extract_<hash>.py"
  sizeBytes    Int
  sha256       String
  createdAt    DateTime   @default(now())

  dxfFile           DxfFile?
  tavaFile          TavaFile?
  addonDocument     AddonDocument?
  sheetRender       SheetRender?
  extractionScript  ExtractionScript?

  @@index([sha256])
}
```

`RENDER` kind carries SVG sheet renders (`image/svg+xml`). `EXTRACTION_SCRIPT` kind carries AI-generated Python scripts. Both live under `uploads/` on local; both flip to S3 via the same `store` field later.

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

  // v3 pipeline outputs — see §7
  explorationJson    Json?              // output of dxf_explorer.py (structural fingerprint)
  structuralHash     String?            // sha256 of canonical explorationJson; joins to ExtractionScript
  complianceData     Json?              // v3 extractor output: setbacks, heights, dimensions, parking, survey, ...
  extractionTrace    Json?              // per-phase timings + cacheHit + attempts + traceback (if any)

  deletedAt          DateTime?
  createdAt          DateTime          @default(now())

  sheetRenders       SheetRender[]
  analyses           Analysis[]

  @@index([projectId, createdAt])
  @@index([structuralHash])
}

enum SheetClassification {
  INDEX_PAGE FLOOR_PLAN CROSS_SECTION ELEVATION
  PARKING_SECTION SURVEY SITE_PLAN ROOF_PLAN AREA_CALCULATION UNCLASSIFIED
}

model SheetRender {
  id              String              @id @default(cuid())
  dxfFileId       String
  dxfFile         DxfFile             @relation(fields: [dxfFileId], references: [id], onDelete: Cascade)
  storedFileId    String              @unique       // SVG StoredFile (kind=RENDER)
  storedFile      StoredFile          @relation(fields: [storedFileId], references: [id])

  sheetIndex      Int                                // 1-based ordering in UI
  displayName     String                             // "קומת קרקע", "חתך A-A"
  classification  SheetClassification @default(UNCLASSIFIED)
  geometryBlock   String?                            // "VIEWPORT2" — provenance/debug
  annotationBlock String?                            // "VIEWPORT19" — provenance/debug
  svgWarning      String?                            // "underfilled: 12KB" when size-validation flags
  createdAt       DateTime            @default(now())

  results         ComplianceResult[]                 // via ComplianceResult.sheetRenderId

  @@unique([dxfFileId, sheetIndex])
  @@index([dxfFileId, classification])
}

model ExtractionScript {
  id                 String     @id @default(cuid())
  structuralHash     String                              // sha256 of canonical explorationJson
  storedFileId       String     @unique                  // StoredFile with kind=EXTRACTION_SCRIPT
  storedFile         StoredFile @relation(fields: [storedFileId], references: [id])

  generatedByModel   String                              // "claude-opus-4-7"
  generationCostUsd  Decimal    @db.Decimal(10, 4)
  generationMs       Int
  fixedFromScriptId  String?                             // self-correction lineage (nullable)
  createdAt          DateTime   @default(now())

  @@index([structuralHash, createdAt])                   // newest wins on lookup
}
```

**Notes:**
- `Viewport`, `ParsedValue`, `RenderedImage`, `RenderKind`, `ViewportType`, `ParsedValueKind` from the original spec are removed — v3 produces `complianceData` JSON directly, and the sheet concept is represented by `SheetRender` (which *is* the sheet table, carrying render + classification + display name together).
- `ExtractionScript` rows are **append-only and global**: keyed by the structural fingerprint of the exploration JSON, not scoped to a project. A cache hit across users is expected — the scripts are machine-generated Python that classifies blocks and extracts numbers (no user data embedded). On self-correction, a new row is inserted and wins via `ORDER BY createdAt DESC LIMIT 1`; the original row is retained for audit.
- `DxfFile.complianceData` shape is defined by the v3 extractor's system prompt (§2.20, §7.3). It evolves with the prompt; no Prisma migration is needed when new fields appear. The agent-facing contract is "whatever is in `complianceData`, plus the `sheets` list" (§9.1).
- `DxfFile.explorationJson` and `DxfFile.complianceData` are **machine-fuel only** — never surfaced as raw JSON in the UI (§4.10). The UI reads `SheetRender[]` for sheets and `ComplianceResult[]` for results.
- **`DxfFile.explorationJson` shape (v3.1):** `{ blocks: {[name]: {entityCounts, bbox, layers, polylineStats, insertsInto[], textPatternFlags, encodingFlags, textSamples: [{raw, decoded?, x, y, block, handle, layer, entityType}, ...]}}, hints: {dualViewportPairs[], dimensionUnitGuess}, header: {version, fonts, styles} }`. `text_samples` is an **ordered** list per block; the renderer relies on this order for the dot-number invariant. `raw` is byte-exact; `decoded` is nullable. Encoding flags: `hasUnicodeEscapes | hasNativeHebrew | hasPossibleShx | hasHighBytes`. `structuralHash = sha256(canonical(explorationJson))` — canonicalization sorts object keys, preserves array order, and serializes with no whitespace.

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
  dxfEvidence     String                           // citation pointer (agent free-text)
  sheetRenderId   String?                          // nullable FK; populated post-parse when dxfEvidence references "render_NN.svg"
  sheetRender     SheetRender?       @relation(fields: [sheetRenderId], references: [id])
  measuredValue   String?
  requiredValue   String?
  category        String                           // free-text; maps loosely to RequirementCategory

  createdAt       DateTime           @default(now())

  @@index([analysisId, status])
  @@index([addonRunId, status])
  @@index([sheetRenderId])
}
```

Exactly one of `analysisId` / `addonRunId` must be set. The service enforces this; a DB CHECK constraint (`CHECK ((analysisId IS NULL) <> (addonRunId IS NULL))`) is added via a migration.

`sheetRenderId` is populated after the agent's JSON response is parsed, by regex-matching `render_(\d+)\.svg` in `dxfEvidence` against the sheet list passed into the prompt (§9.1). It lets the UI render each citation as a click-through to the exact sheet SVG.

### 3.10 Jobs

```prisma
enum JobType   {
  DXF_EXTRACTION TAVA_EXTRACTION ADDON_EXTRACTION
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
| DXF extractor (v1→v3.1)  | Hardcoded `execFile` extractor per project   | `dxf_explorer.py` + `dxf_sheet_renderer.py` (both generic) + multimodal AI-generated per-file script via visual-bridge codegen + self-correct (§2.20, §7) |
| DXF data shape           | Normalized `Viewport` + `ParsedValue`        | `DxfFile.complianceData` JSON pass-through (§3.4)                 |
| DXF sheet model          | `Viewport` (1 per block) + `RenderedImage`   | `SheetRender` (1 per logical sheet; carries SVG + classification) (§3.4) |
| DXF codegen cache        | N/A                                           | `ExtractionScript` global append-only, keyed by structural hash (§3.4, §7.3) |
| Renders                  | PNG at 150/300 DPI, separate `DXF_RENDER` job| SVG per sheet, produced inline with `/execute`, no separate job (§2.13, §7) |
| Sidecar contract         | `/extract` + `/render` (hardcoded)           | `/explore` + `/render-thumbnails` + `/execute` (sidecar never calls Claude) (§2.12, §7.1) |
| Requirements             | JSON array on `TavaFile.requirements`        | Normalized `Requirement` + `TavaPage` (§3.5)                      |
| Compliance results       | JSON arrays on Analysis/AddonRun             | Unified polymorphic `ComplianceResult` + `sheetRenderId` (§3.9)   |
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

Limits: DXF 100 MB, TAVA 50 MB, ADDON 30 MB. Multer disk storage with `decodeOriginalName` (latin1→utf8) helper applied at the middleware level (not per-route).

Upload behavior:
1. Multer writes file to `uploads/<kind>/<cuid>.<ext>`
2. Compute sha256 of the stored file
3. If any `StoredFile` with same `sha256` AND same `kind` AND already attached to this project (via its file-kind relation) exists → return that existing row (no new StoredFile, no new DxfFile/TavaFile, no extraction re-run)
4. Otherwise: create `StoredFile` row, create `DxfFile` / `TavaFile` / `AddonDocument` row in a transaction
5. Enqueue extraction `Job` (DXF_EXTRACTION / TAVA_EXTRACTION / ADDON_EXTRACTION)
6. Soft-delete any previous current file-of-same-kind on the project (so the new one is "current")
7. Return the created row with `extractionStatus=PENDING`

UI polls (§4.5) to see status transitions.

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
| O    | POST   | `/api/projects/:id/chat`     | `{ content }`           | `text/event-stream` (see §2.19)     |

`POST /chat` is a **streaming** endpoint. Response `Content-Type: text/event-stream`. Events emitted in order: `user-message` (after persisting the user's message), N × `token` (each Claude content-block delta), `assistant-message` (after persisting the assistant's reply), then connection close. On error: `event: error\ndata: {"message":"..."}` then close.

Rate-limited at 5 messages / minute per `(projectId, userId)` to cap Claude spend; independent of source IP so two users on the same network don't collide.

Context assembled for the assistant: latest `Analysis.summary` + latest 20 `ComplianceResult`s + truncated `TavaFile.rawExtractedText` (first 4000 chars) + `DxfFile.complianceData` (full JSON) + `SheetRender[]` list. Prior `ChatMessage`s (last 20) included for conversational continuity. See §9.3 for the full assembly code.

Headers set on the SSE response:
```
Content-Type: text/event-stream
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```
Last header tells any downstream nginx/proxy not to buffer.

### 4.8 Renders (sheet SVGs)

| Auth | Method | Path                                                | Response                  |
|------|--------|-----------------------------------------------------|---------------------------|
| P    | GET    | `/api/renders/:dxfFileId/:filename`                 | SVG bytes (`image/svg+xml`) |

Intentionally unauthenticated — the cuid is the capability. Validates cuid format on `:dxfFileId`, rejects `..` / `/` / `\` / any path separator in `:filename`, checks `DxfFile` exists and that `:filename` matches a `SheetRender` row for that `DxfFile`. Response: `Content-Type: image/svg+xml`, `Cache-Control: public, max-age=31536000, immutable` (SVG filenames are cuids, immutable). Must be mounted BEFORE any `app.use('/api', someRouterWithAuth)` that might shadow it (comment in `app.ts` marks this).

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
- Direct read of `DxfFile.explorationJson` / `DxfFile.complianceData` / `DxfFile.extractionTrace` / `TavaFile.rawExtractedText` via API (internal machine-fuel only)

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
│   │   ├── sheet-render.da.ts
│   │   ├── extraction-script.da.ts
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
│   │   ├── dxf-extraction.handler.ts     # explore → codegen-or-cache → execute → self-correct → persist
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
│   ├── upload.middleware.ts             # multer config, decodeOriginalName
│   ├── validate.middleware.ts           # moved from middlewares.ts
│   ├── error-handler.middleware.ts      # moved
│   └── not-found.middleware.ts          # moved
└── bootstrap/
    ├── seed-admin.ts
    └── start-job-runner.ts
```

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
callClaude(opts: { system, user, model: 'opus'|'sonnet'|'haiku', maxTokens, reqId }): Promise<{ text, stopReason, inputTokens, outputTokens }>
streamClaude(opts: { system, user, model, maxTokens, reqId, signal? }): AsyncIterable<{ type: 'delta', text } | { type: 'stop', text, stopReason }>
parseJsonResponse<T>(raw: string): T   // fence-stripping + truncation repair

// v3 DXF codegen — see §7.3
generateExtractionScript(opts: { explorationJson, reqId }): Promise<{ code: string, costUsd: number, ms: number }>
fixExtractionScript(opts: { explorationJson, brokenCode, traceback, reqId }): Promise<{ code: string, costUsd: number, ms: number }>

// integrations/python-sidecar.client.ts — see §7.1
explore(opts: { storedFileUri, reqId }): Promise<{ explorationJson, structuralHash, ms }>
execute(opts: { storedFileUri, scriptUri, outputDir, reqId }): Promise<
  | { ok: true, complianceData, renders: SidecarRender[], ms }
  | { ok: false, traceback: string, ms }
>

// integrations/storage.client.ts
saveStream(kind: FileKind, ext: string, stream): Promise<{ uri, sha256, sizeBytes }>
saveBuffer(kind: FileKind, ext: string, buf: Buffer): Promise<{ uri, sha256, sizeBytes }>  // used for EXTRACTION_SCRIPT + RENDER bytes
resolve(uri: string): string             // absolute path for local; presigned URL later for S3
readText(uri: string): Promise<string>   // used by fixExtractionScript to send brokenCode back to Claude
deleteByUri(uri: string): Promise<void>
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
- `@anthropic-ai/sdk`
- `cuid` (already implicit via Prisma)
- No `bullmq` — deferred (Job table is enough)

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

## 7. DXF Pipeline (v3.1)

The v3.1 pipeline has four phases (explore → [cache-hit? skip : render-thumbnails + codegen] → execute → self-correct) orchestrated by Node, with three endpoints on the Python sidecar. See §2.20 for the architectural rationale; the end-to-end diagram lives in §7.6.

### 7.1 Python sidecar service

**Container:** compose service `python-sidecar`, FastAPI 0.115+, uvicorn, ezdxf ≥1.3, matplotlib ≥3.8, numpy, shapely. No tesseract, no pdftotext (those are Node-side, see §8). Matplotlib is used only for `/render-thumbnails`; the final per-sheet SVGs at `/execute` are emitted as raw text by the AI-generated extraction script. Mounts the same `uploads/` volume as Node at the same path. Listens on `python-sidecar:5000` (internal only).

**Endpoints:**
```
GET  /health
  → { ok: true, ezdxfVersion }

POST /explore
  body    { storedFileUri, reqId }
  returns { explorationJson, structuralHash, ms }

POST /render-thumbnails
  body    { storedFileUri, explorationJson, thumbnailDir, reqId }
  returns { thumbnails: [{sheetKey, pngUri, dotCount}], ms }

POST /execute
  body    { storedFileUri, scriptUri, outputDir, reqId }
  returns on success  { ok: true, complianceData, renders: [...], ms }
          on crash    { ok: false, traceback: string, ms }   // HTTP 200 both cases
```

**Sidecar invariants (repeat of §2.12 for §7 locality):** never calls Claude; never writes to Postgres; resolves `storedFileUri` / `scriptUri` / `outputDir` / `thumbnailDir` against the shared volume; forwards `X-Request-Id` to logs; HTTP 5xx only for sidecar process errors, not script crashes.

**`/explore` logic — runs `dxf_explorer.py` (static, never changes across DXFs):**
- Iterates every block; counts `LINE / POLYLINE / ARC / CIRCLE / INSERT / TEXT / MTEXT / ATTRIB / ATTDEF` per block.
- Computes per-block bounding boxes.
- Samples up to **50 texts per block** across `TEXT | MTEXT | ATTRIB | ATTDEF`. Each sample is `{raw, decoded, x, y, block, handle, layer, entityType}`:
  - `raw` is byte-exact ezdxf output — **no decoding, no `_combine_and_scrub_surrogates`**.
  - `decoded` is best-effort Hebrew via `_combine_and_scrub_surrogates`, kept as a hint. Set to `null` when decoding fails or would lossy-transform the bytes.
- Records **encoding-signal flags per block**:
  - `hasUnicodeEscapes` — any raw sample contains `\U+XXXX`
  - `hasNativeHebrew` — any raw sample contains UTF-8 Hebrew bytes (U+0590–U+05FF)
  - `hasPossibleShx` — letter-pair frequency in raw samples matches SHX Latin glyph distribution (cheap statistical heuristic; false positives acceptable)
  - `hasHighBytes` — non-ASCII, non-UTF-8 bytes present (suggests CP862 / Windows-1255)
- Records text-pattern flags: `hasIntegers`, `hasDecimals`, `hasHeights` (`+N.NN` format), `hasCoordinates`.
- INSERT graph, layer usage, polyline stats (count, closed/open split, vertex distributions).
- Auto-detects dual-viewport pattern as a **hint** under `hints.dualViewportPairs[]` (not a hard classifier — codegen may override from visual evidence).
- Guesses dimension unit (`cm | mm | m`) from coordinate value ranges under `hints.dimensionUnitGuess`.
- Returns `explorationJson` (~100–200KB for a 30MB DXF) + `structuralHash = sha256(canonical(explorationJson))` (object keys sorted, array order preserved, no whitespace in serialization).
- Target runtime: <5s on a 30MB file.

**`/render-thumbnails` logic — runs `dxf_sheet_renderer.py` (static, never changes):**
- Input: `storedFileUri` (the DXF), `explorationJson` (from `/explore`), `thumbnailDir` (where PNGs land).
- For each logical sheet (derived from blocks plus the explorer's dual-viewport hints; modelspace is one implicit sheet if no block-level sheets exist):
  - Draws geometry with matplotlib: `LINE / POLYLINE / CIRCLE / ARC` in black on a white background, axes off, aspect ratio locked.
  - **Overlays a numbered red dot at every text sample's `(x, y)`, in the order the sample appears in `explorationJson.text_samples`.** The renderer never re-enumerates ezdxf for ordering.
  - **Dot-density policy:** sort samples within a sheet by `(isNumeric, -length)` — non-numeric first, longer strings first. Numeric: regex `^[-+]?\d+(\.\d+)?%?$`. De-duplicate near-coincident positions (< bbox-diagonal / 200 apart). Cap at **100 dots per sheet**. The cap is applied *after* the invariant — skipped samples keep their global dot number (so dots may be non-contiguous within a sheet, but `N` ↔ `text_samples[N-1]` globally). Dropped dots are fine — Claude doesn't need every text position labeled, only enough to anchor the visual map.
  - Writes `{thumbnailDir}/{sheetKey}.png` at ~1200×900 px. `sheetKey` is the block name, or `"modelspace"` for modelspace content.
- Returns `thumbnails: [{sheetKey, pngUri, dotCount}]`. `dotCount` is the number of dots actually rendered after dedup/cap — for admin/debug.
- Target runtime: <10s on a 30MB file.

**`/execute` logic — unchanged from v3.0:**
- Reads the Python script at `scriptUri` from the shared volume.
- Runs it as a subprocess (`python3 scriptUri dxfPath outputDir`), captures stdout (expected to be JSON: `complianceData` + `renders[]`) and stderr.
- On non-zero exit: returns `{ ok: false, traceback: stderr, ms }` with HTTP 200.
- On zero exit but malformed stdout: returns `{ ok: false, traceback: "<parse-error>\n<stdout>", ms }`.
- On success: validates each render file exists, stats `sizeBytes`, flags `svgWarning: "underfilled: <N>KB"` for renders <20KB (the dot-soup failure signal from v2 experience). Returns the full structure.
- Target runtime: <10s per DXF. Hard timeout 120s (configured on the subprocess).

### 7.2 Node-side DXF upload flow

`POST /api/projects/:id/dxf`:
1. Multer stream → `uploads/dxf/<cuid>.dxf`
2. Stream sha256 during write (piggyback on the stream, no re-read)
3. **Byte-dedup check (per project):** if a `StoredFile` with same `(sha256, kind=DXF)` already exists AND is referenced by a `DxfFile` on **this project** (including soft-deleted ones) → return that `DxfFile` (undelete if soft-deleted), delete the just-written file from disk, no extraction job enqueued. **Dedup is per-project on purpose** — cross-project sharing of DXF bytes creates separate `StoredFile` rows, because two users uploading identical DXFs should not share file-level authorization. (Structural-hash cache is global; *byte* dedup is not.)
4. Otherwise, inside `$transaction`:
   - Create `StoredFile` (kind=DXF)
   - Create `DxfFile` with `extractionStatus=PENDING`, `storedFileId` set, `projectId` set
   - Soft-delete prior current `DxfFile` on project (if any) — the new one is now current
   - Enqueue `Job { type: DXF_EXTRACTION, dxfFileId }`
5. Return created row (UI polls for extraction completion)

### 7.3 DXF_EXTRACTION job handler (state machine)

One handler runs the full v3.1 state machine. Persists `DxfFile.extractionTrace` as it goes so admins can inspect which phase took how long and what went wrong. Heartbeat every 15s. 5-min wall-clock timeout enforced by the job runner (§10).

```
handle(job):
  dxf = dxfFile.findById(job.dxfFileId, { include: { storedFile: true } })
  trace = { cacheHit: null, attempts: 0, phases: [] }
  thumbnailDir = `uploads/tmp/thumbnails/${dxf.id}/`     # per-job temp, deleted in finally
  dxfFile.update({ extractionStatus: EXTRACTING })

  try:
    # Phase 1 — explore (fingerprint only, no thumbnails)
    t0 = now()
    { explorationJson, structuralHash } = await sidecar.explore({
      storedFileUri: dxf.storedFile.uri, reqId
    })
    trace.phases.push({ phase: 'explore', ms: now() - t0 })

    # Phase 2 — codegen OR cache hit
    script = await extractionScript.findLatestByHash(structuralHash)
    if script:
      trace.cacheHit = true
    else:
      # Phase 1.5 — render thumbnails (cache miss only)
      t1a = now()
      { thumbnails } = await sidecar.renderThumbnails({
        storedFileUri: dxf.storedFile.uri,
        explorationJson, thumbnailDir, reqId,
      })
      trace.phases.push({ phase: 'render-thumbnails', ms: now() - t1a, sheetCount: thumbnails.length })

      # Phase 2 — multimodal codegen
      t1b = now()
      { code, costUsd, ms } = await anthropic.generateExtractionScript({
        explorationJson, thumbnails, reqId,   # thumbnails: [{sheetKey, pngUri}]
      })
      stored = await storage.saveBuffer('EXTRACTION_SCRIPT', '.py', Buffer.from(code))
      scriptFile = await storedFile.create({ kind: EXTRACTION_SCRIPT, ...stored })
      script = await extractionScript.create({
        structuralHash, storedFileId: scriptFile.id,
        generatedByModel: 'claude-opus-4-7', generationCostUsd: costUsd, generationMs: ms,
      })
      trace.cacheHit = false
      trace.phases.push({ phase: 'codegen', ms: now() - t1b, costUsd })

    # Phase 3+4 — execute, self-correct once on crash
    outputDir = `uploads/renders/${dxf.id}/`
    attempt = 0
    while attempt < 2:
      attempt += 1
      trace.attempts = attempt
      t2 = now()
      result = await sidecar.execute({
        storedFileUri: dxf.storedFile.uri,
        scriptUri: script.storedFile.uri,
        outputDir, reqId,
      })
      trace.phases.push({ phase: `execute.${attempt}`, ms: now() - t2, ok: result.ok })
      if result.ok: break
      if attempt == 1:
        # Self-correction uses the traceback, NOT the thumbnails (text-only fix prompt)
        t3 = now()
        brokenCode = await storage.readText(script.storedFile.uri)
        { code, costUsd, ms } = await anthropic.fixExtractionScript({
          explorationJson, brokenCode, traceback: result.traceback, reqId,
        })
        stored = await storage.saveBuffer('EXTRACTION_SCRIPT', '.py', Buffer.from(code))
        fixedFile = await storedFile.create({ kind: EXTRACTION_SCRIPT, ...stored })
        script = await extractionScript.create({
          structuralHash, storedFileId: fixedFile.id, fixedFromScriptId: script.id,
          generatedByModel: 'claude-opus-4-7', generationCostUsd: costUsd, generationMs: ms,
        })
        trace.phases.push({ phase: 'self-correct', ms: now() - t3, costUsd })

    if not result.ok:
      dxfFile.update({
        extractionStatus: FAILED,
        extractionError: result.traceback.slice(-2000),
        extractionTrace: trace,
        structuralHash,
        explorationJson,
      })
      throw JobFailed('extraction.exhausted-retries')

    # Phase 5 — persist (single transaction)
    await prisma.$transaction(async tx => {
      for (render of result.renders):
        sf = await tx.storedFile.create({
          kind: RENDER,
          uri: `${outputDir}${render.filename}`,
          sha256: computed, sizeBytes: render.sizeBytes,
          originalName: render.filename,
        })
        await tx.sheetRender.create({
          dxfFileId: dxf.id, storedFileId: sf.id,
          sheetIndex: render.sheetIndex,
          displayName: render.displayName,
          classification: render.classification,
          geometryBlock: render.geometryBlock,
          annotationBlock: render.annotationBlock,
          svgWarning: render.svgWarning,
        })
      await tx.dxfFile.update({
        id: dxf.id,
        explorationJson, structuralHash,
        complianceData: result.complianceData,
        extractionTrace: trace,
        extractionStatus: COMPLETED,
      })
    })
  finally:
    # Always clean up transient thumbnails — they have no post-codegen purpose
    await storage.removeDirIfExists(thumbnailDir)
```

**Design notes:**
- **Thumbnails are rendered only on cache miss.** The cache-hit path is `explore → findLatestByHash (hit) → execute` — no renderer invocation, ~15s total. On cache miss, `render-thumbnails` adds ~10s before codegen.
- **Self-correction is text-only.** The original codegen sees thumbnails + exploration; the fix prompt sees the traceback + broken code + exploration JSON. No thumbnails in the fix call — by the time a script has crashed, the problem is almost always an ezdxf API misuse or a raw-string mismatch, not a visual recognition error. Cheaper and faster.
- **Max 1 self-correction attempt.** Telemetry from the v2 prototype showed retry succeeds >90%; a second retry has diminishing returns. If even the corrected script crashes, fail the job — admin inspects `extractionTrace` + `extractionError`.
- **Append-only cache.** Both the original and corrected scripts get `ExtractionScript` rows. `findLatestByHash` picks the newest by `createdAt DESC`; a correction improves the cache for future identical-structure files.
- **No DXF_RENDER job.** Per-sheet SVGs arrive from `/execute` and are persisted in the same transaction as `complianceData`.
- **Failed extraction never partially commits.** On failure, only `extractionTrace` + `extractionError` + `explorationJson` + `structuralHash` land on `DxfFile`; no SheetRenders, no `complianceData`. Debug with `extractionTrace` + the cached broken script.
- **Thumbnail cleanup is in `finally`.** A crashed handler, failed job, or thrown exception still triggers directory removal. Orphan `uploads/tmp/thumbnails/*` from hard-crashed Node processes (SIGKILL before `finally` runs) are rare; an hourly sweeper is deferred to §14 item 23.
- **Heartbeat** every 15s via setInterval so the boot-time reaper (§10.4) knows long codegen/execute calls are alive.

### 7.4 Codegen system prompts

`integrations/anthropic.client.ts` exports two functions:

```ts
generateExtractionScript(opts: {
  explorationJson: object,
  thumbnails: { sheetKey: string, pngUri: string }[],
  reqId: string,
}): Promise<{ code, costUsd, ms }>

fixExtractionScript(opts: {
  explorationJson: object,
  brokenCode: string,
  traceback: string,
  reqId: string,
}): Promise<{ code, costUsd, ms }>
```

Both use `claude-opus-4-7` with a dedicated system prompt constant `EXTRACTION_CODEGEN_SYSTEM_PROMPT` at the top of the file. The v3.1 prompt describes the **contract** and the **visual-bridge protocol** only — it does not embed Hebrew keyword tables, dual-viewport bbox-overlap heuristics, or spatial-correlation rules. Recognition stays inside Claude's vision call.

**`generateExtractionScript` prompt outline:**

1. **Inputs you will receive.**
   - `explorationJson`: structural fingerprint. Each block has an ordered `text_samples` list with `{raw, decoded?, x, y, block, handle, layer, entityType}`. `raw` is byte-exact; `decoded` is a best-effort Hebrew hint (nullable — do not rely on it). Encoding-signal flags indicate how Hebrew is stored in this file (`hasUnicodeEscapes`, `hasNativeHebrew`, `hasPossibleShx`, `hasHighBytes`).
   - One PNG thumbnail per sheet: geometry in black, **numbered red dots at text positions**. Dot `N` in the PNG corresponds to `text_samples[N-1]` in the JSON (indexed globally across the sheet, dots are dense enough to anchor the visual map even when density-capped).

2. **Visual-bridge protocol (what to do with the images).**
   - Classify each sheet by looking at it: floor plan (rooms, door arcs, fixtures), elevation (building profile, ground line, stone hatching), cross-section (floor slabs, ceiling heights), site plan / survey (plot boundary, terrain elevations), parking (bay grid), roof, index page, area calculation table, or unclassified.
   - Use dot positions to decide what each raw string *means* for this file. Example: dot `#12` sits on a building edge adjacent to a boundary line → `text_samples[11].raw` is this file's label for "building line" (e.g. `"eu cbhhi"` or `"קו בניין"` or `\U+05E7\U+05D5 \U+05D1\U+05E0\U+05D9\U+05D9\U+05DF`, depending on encoding). Record the raw form, not a decoded form.

3. **Required output: a complete Python script.** The script starts with a `LABELS` dict mapping semantic names to the raw strings present in this file:

   ```python
   LABELS = {
       "building_line":  "eu cbhhi",          # raw string from text_samples[11].raw
       "plot_boundary":  "dcuk ndra",
       "ground_level":   "+0.00",              # numeric/ASCII labels unchanged
       "kitchen":        "nycj",
       "bedroom":        "j/ ahbv",
       "bathroom":       "j/ rjmv",
       "safe_room":      'nn"s',
       # ... one entry per label the extractor will search for
   }
   ```

   All subsequent label matching uses `.strip() == LABELS[key]` (or `in LABELS[key]` for substring, never a hardcoded Hebrew literal). Numbers are matched directly from raw text via regex — they are ASCII and encoding-agnostic.

4. **Extraction contract (required `complianceData` schema).** Required top-level keys: `setbacks`, `heights`, `dimensions`, `parking`, `survey`, `labelCorrelations`. Each is an object; sub-schema documented inline in the prompt. Missing data → omit the sub-key, do not invent placeholders.

5. **SVG rendering contract (for per-sheet renders returned alongside `complianceData`).** Y-axis flip (DXF Y-up → SVG Y-down), bounding-box fit, stroke width scaled to diagonal, ACI color table, text as `<text>` elements in original raw form. One SVG per sheet, named `render_NN.svg`. Each sheet carries a `displayName` (Hebrew, decoded if possible), `classification` (enum from §3.4), `geometryBlock` / `annotationBlock` (provenance), and optional `svgWarning`.

6. **Output constraint.** Your output must be the complete Python script, nothing else. No fence, no commentary, no markdown.

**`fixExtractionScript` prompt addendum.** Text-only: receives `brokenCode` + `traceback` + `explorationJson`. No thumbnails (by the time a script crashes, the failure is almost always an ezdxf API misuse, a string-matching bug, or a JSON-schema mistake — visual re-classification rarely helps and adds cost). Instructs: produce a minimal fix that preserves the rest of the script; do not rewrite the `LABELS` dict unless the traceback directly implicates it.

Prompt drift is controlled: the system-prompt constant lives at the top of `anthropic.client.ts`, so any change shows up in PR diffs.

### 7.5 DXF pipeline efficiency recap

- **Byte-sha256 per-project dedup** — identical uploads skip everything.
- **Structural-hash global codegen cache** — Opus codegen cost (~$1) only on the first unique DXF structure; repeat-structure uploads run `explore + execute` only (~15s, $0) and skip the thumbnail renderer entirely.
- **Thumbnails only on cache miss** — `/render-thumbnails` adds ~10s to cold runs, but cache hits never pay it.
- **No blocking renders** — final per-sheet SVGs are produced inline with extraction at `/execute`, so there's nothing to block; per-sheet `svgWarning` surfaces degraded sheets without failing the whole job.
- **Self-correction loop** — AI-generated Python crashes ~30% of the time on novel structures; one text-only retry with the traceback succeeds >90%, making the pipeline resilient without human intervention.
- **Pass-through JSON to agents** — `complianceData` flows unchanged into core and add-on agent prompts (§9). No normalization layer to drift against prompt evolution.
- **Canonical UTF-8 via JSON HTTP** — surrogate-pair stdout bugs eliminated (Node never reads Python stdout directly).
- **Visual bridge avoids decoder catalog** — raw-string matching + per-file `LABELS` dict means a new Hebrew encoding (seventh font, eighth code page) requires zero pipeline changes; Claude builds a new label map from the thumbnails.

### 7.6 End-to-end pipeline diagram

```
                          DXF file uploaded
                                  │
                                  ▼
                   ┌─────────────────────────────┐
                   │ POST /api/projects/:id/dxf  │
                   │ (Node)                      │
                   │ - multer → uploads/dxf/…    │
                   │ - stream sha256             │
                   │ - per-project byte dedup  ──┼──► hit → return DxfFile, skip
                   └──────────────┬──────────────┘
                                  │ miss
                                  ▼
                    enqueue Job(DXF_EXTRACTION)
                                  │
                                  ▼
       ┌────────────────────────────────────────────────────────────┐
       │ DXF_EXTRACTION handler (Node, §7.3) — heartbeat 15s        │
       └───┬─────────────────────────────────────────────┬──────────┘
           │                                             │
   Phase 1 │                                             │
           ▼                                             │
     ┌──────────────────────────┐                        │
     │ sidecar POST /explore    │                        │
     │ dxf_explorer.py          │                        │
     │ → explorationJson        │                        │
     │   (raw + decoded         │                        │
     │    text_samples,         │                        │
     │    encoding flags,       │                        │
     │    structural hints)     │                        │
     │ → structuralHash         │                        │
     └────────────┬─────────────┘                        │
                  │                                      │
   cache lookup   ▼                                      │
     ┌────────────────────────────┐                      │
     │ ExtractionScript           │                      │
     │ .findLatestByHash(hash)    │                      │
     └───┬────────────────────┬───┘                      │
         │                    │                          │
     hit │                    │ miss                     │
         │                    ▼                          │
         │   ┌─────────────────────────────────┐         │
         │   │ Phase 1.5 — render thumbnails    │         │
         │   │ sidecar POST /render-thumbnails │         │
         │   │ dxf_sheet_renderer.py           │         │
         │   │ consumes explorationJson        │         │
         │   │ → PNG per sheet with            │         │
         │   │   numbered red dots at          │         │
         │   │   text_samples positions        │         │
         │   │   (invariant: dot N ↔ [N-1])    │         │
         │   └─────────────┬───────────────────┘         │
         │                 │                             │
         │                 ▼                             │
         │   ┌─────────────────────────────────┐         │
         │   │ Phase 2 — multimodal codegen     │         │
         │   │ anthropic.generateExtractionScr. │         │
         │   │ inputs:                         │         │
         │   │  - explorationJson (text)       │         │
         │   │  - thumbnails[] (images)        │         │
         │   │ output: complete Python script  │         │
         │   │ with LABELS dict + extractor    │         │
         │   │ v1: claude-opus-4-7 + vision    │         │
         │   └─────────────┬───────────────────┘         │
         │                 │                             │
         │        persist  │                             │
         │        StoredFile(EXTRACTION_SCRIPT)          │
         │         + ExtractionScript row                │
         │                 │                             │
         └─────────────────┤                             │
                           ▼                             │
           ┌────────────────────────────────┐            │
           │ Phase 3 — execute              │            │
           │ sidecar POST /execute          │            │
           │  python3 script dxf outputDir  │            │
           │  → complianceData (JSON)       │            │
           │  → renders[] (SVG per sheet)   │            │
           └────────┬────────────┬──────────┘            │
                    │            │                       │
                 ok │      crash │                       │
                    │            ▼                       │
                    │   ┌───────────────────────────┐    │
                    │   │ Phase 4 — self-correct    │    │
                    │   │ anthropic.fixExtraction.. │    │
                    │   │ text-only (no thumbnails) │    │
                    │   │ inputs: explorationJson,  │    │
                    │   │  brokenCode, traceback    │    │
                    │   │ 1 attempt, then FAIL      │    │
                    │   └──┬──────────────┬─────────┘    │
                    │      │ ok           │ crash        │
                    │      │              ▼              │
                    │      │       mark DxfFile FAILED   │
                    │      │       + extractionError     │
                    │      │                             │
                    ▼      ▼                             │
           ┌────────────────────────────────┐            │
           │ Phase 5 — persist (tx)         │            │
           │ - StoredFile rows (kind=RENDER)│            │
           │ - SheetRender rows per SVG     │            │
           │ - DxfFile.complianceData       │            │
           │ - DxfFile.explorationJson      │            │
           │ - DxfFile.structuralHash       │            │
           │ - DxfFile.extractionTrace      │            │
           │ - DxfFile.status = COMPLETED   │            │
           └──────────────┬─────────────────┘            │
                          │                              │
                finally:  │                              │
                rm -rf thumbnailDir ◄──────────────────── ┘
                          │
                          ▼
         consumed downstream by §9 agents
         (complianceData + SheetRender[])
```

---

## 8. PDF / OCR Pipeline (תב"ע + add-on docs)

Runs inside the Node container (no sidecar needed — `pdftotext` and `tesseract` are CLI tools invoked via `execFile`).

### 8.1 Flow (TAVA_EXTRACTION / ADDON_EXTRACTION job)

1. `execFile('pdftotext', ['-layout', storedFile.uri, '-'])`, capture stdout
2. If `stdout.trim().length > 100` → treat as digital PDF, `extractionMethod=PDF_TEXT`, raw text = stdout
3. Else → OCR fallback:
   - `execFile('pdftoppm', ['-tiff', '-r', '300', storedFile.uri, tmpBase])` — render all pages to 300 DPI TIFFs
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
- Upload pipelines already populate `DxfFile.complianceData` + `SheetRender[]` (§7) and `TavaFile` + `Requirement` + `TavaPage` (§8). The analysis job assumes both are complete (the analyze endpoint refuses to enqueue otherwise, see §4.5).
- Status transitions: `PENDING` → `ANALYZING` → `COMPLETED | FAILED`. Extraction is fully decoupled from the analysis lifecycle.

**Prompt assembly** (`compliance-agent.service.ts::buildCorePrompt(analysisId)`):

```ts
const analysis = await analysis.findById(analysisId, {
  include: { dxfFile: true, tavaFile: { include: { requirements: true } } }
})
const sheets = await sheetRender.findByDxfFile(analysis.dxfFileId, {
  include: { storedFile: true },
  orderBy: { sheetIndex: 'asc' },
})

const user = {
  requirements: analysis.tavaFile.requirements,          // normalized Requirement rows
  tavaTextFallback: analysis.tavaFile.rawExtractedText.slice(0, 8000),
  complianceData: analysis.dxfFile.complianceData,        // pass-through v3 JSON
  sheets: sheets.map(s => ({
    filename: basename(s.storedFile.uri),                  // "render_05.svg"
    sheetIndex: s.sheetIndex,
    displayName: s.displayName,                            // "קומת קרקע"
    classification: s.classification,                      // "FLOOR_PLAN"
    svgWarning: s.svgWarning,
  })),
}
```

**System prompt** (Hebrew, `CORE_AGENT_SYSTEM_PROMPT` constant in `compliance-agent.service.ts`):
- PASS / FAIL / WARNING / CANNOT_CHECK rules with Hebrew labels
- `dxfEvidence` required for each result; for CANNOT_CHECK, must cite what's missing
- **"When citing evidence, reference the exact sheet filename from the `sheets` list (e.g. `\"מרווח צדדי 3.0m, ראה render_05.svg (קומת קרקע)\"`). The filename must be one from the provided list."**
- **"If a sheet has an `svgWarning`, prefer citing a different sheet when possible. If no other sheet shows the requirement, cite the warned sheet and note the limitation in `details`."**
- **"`complianceData` holds the extracted measurements; `requirements` holds what they must satisfy. Compare directly; do not estimate values that aren't present."**

**Call:** `callClaude({ model: 'opus', maxTokens: 16000, ... })`.

**Post-processing:**
- `parseJsonResponse` → array of result objects from Claude
- Regex each `dxfEvidence` for `render_(\d+)\.svg` — if matched against a filename in the `sheets` list, populate `sheetRenderId` on the result
- `createMany` into `ComplianceResult` with `analysisId` set and `sheetRenderId` populated when resolvable
- Aggregate counts into `Analysis.passCount | failCount | warningCount | cannotCheckCount`
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
3. Fetch `DxfFile.complianceData` (pass-through JSON) + `SheetRender[]` (same shape as core; `sheets: [{filename, sheetIndex, displayName, classification, svgWarning}]`)
4. Assemble Hebrew prompt with domain-specific `systemPromptSuffix`; same "cite sheet filenames" rule as core (§9.1)
5. `callClaude({ model: 'opus', maxTokens: 12000 })`
6. `parseJsonResponse` → regex-match `render_NN.svg` in each `dxfEvidence` to populate `sheetRenderId`
7. Bulk-insert `ComplianceResult` with `addonRunId` set and `sheetRenderId` populated when resolvable
8. Aggregate counts into `AddonRun`, `status=COMPLETED`

### 9.3 Chat agent (per-project, streaming via SSE)

`chat.controller.ts` holds the SSE response open; `chat.service.ts::respond(projectId, userContent, res)` drives it:

1. Inside a transaction: persist `ChatMessage { role: USER, content: userContent }`. Emit SSE `user-message` event with the persisted row.
2. Assemble context:
   - Last 20 `ChatMessage`s (conversational continuity, excluding the one just inserted)
   - Latest `Analysis.summary` + latest 20 `ComplianceResult`s across core + add-on runs
   - Latest `TavaFile.rawExtractedText` truncated to 4000 chars
   - Latest `DxfFile.complianceData` (full, pass-through JSON — typically 10–30KB, no truncation)
   - Latest `SheetRender[]` list: `{filename, displayName, classification, svgWarning}` (same shape as the core-agent prompt)
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

v1 implementation: DB-polling worker. Single Node process runs the loop.

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

`FOR UPDATE SKIP LOCKED` means multiple worker instances are safe if ever added. Heartbeat update every 30s during long handlers so the boot-time reaper knows the job is alive.

### 10.3 Handlers

One per `JobType` (see §5.1). Each handler receives the full `Job` row and does its work idempotently (safe to re-run if a prior attempt half-completed).

### 10.4 Boot-time recovery

`bootstrap/start-job-runner.ts` before `app.listen()`:
1. `UPDATE Job SET status='FAILED', errorMessage='interrupted by server restart', completedAt=now WHERE status='RUNNING' AND (heartbeatAt IS NULL OR heartbeatAt < now - interval '30 seconds')`
2. `UPDATE Analysis SET status='FAILED', errorMessage='interrupted by server restart', completedAt=now WHERE status IN ('PENDING','ANALYZING') AND createdAt < now - interval '30 minutes'`
3. Same for `AddonRun`
4. Start the worker loop

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
- `compliance-agent.service.ts::buildCorePrompt` — sheet list assembly, requirement interleaving, תב"ע truncation, `sheetRenderId` regex post-processing
- `integrations/anthropic.client.ts::generateExtractionScript` / `fixExtractionScript` — prompt shape, cost calculation, mocked responses
- `jobs/handlers/dxf-extraction.handler.ts` — state machine: cache-hit path, cold-codegen path, self-correction path, exhausted-retries failure
- `extraction-script.da.ts::findLatestByHash` — newest-wins ordering, append-only cache

### 11.2 Integration (`npm run test:integration`, real DB)

- Login → authed request → logout round-trip
- Admin create user → user login → admin disable → 401 on next request
- Upload DXF → job runs → DxfFile completed + `complianceData` populated + `SheetRender` rows + SVG files on disk
- Upload identical DXF to same project → byte-dedup short-circuits, no new StoredFile, no new extraction job
- Upload structurally-similar DXF to a different project → structural-hash cache hit, no Opus codegen call, new `DxfFile` + `SheetRender[]` created with `extractionTrace.cacheHit=true`
- Force a codegen bug (test fixture returning broken Python) → self-correction retry succeeds → `extractionTrace.attempts=2`, two `ExtractionScript` rows with `fixedFromScriptId` lineage
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
- `integrations/` folder skeleton with `auth-cookie.ts` + `password.ts`
- Env vars added to [server/src/utils/env.ts](../../../server/src/utils/env.ts): `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_INITIAL_PASSWORD`
- Docker Compose / Prisma Postgres (whichever user picks) connected

**Phase 1 — Auth + roles.**
- Prisma models: `User`, `AuditLog`; first migration
- `bootstrap/seed-admin.ts`
- Auth routes (login, logout, me, change-password) + middleware + service + tests
- Admin routes (list, create, delete, reset-password, active toggle, stats) + tests
- Client: login page, auth state hook, protected route, admin users page

**Phase 2 — Projects + storage.**
- Prisma models: `StoredFile`, `Project`; migration
- `integrations/storage.client.ts` (local disk only)
- Project CRUD endpoints + tests
- Client: project list (HomePage), create-project page, project detail page

**Phase 3 — Jobs infrastructure.**
- Prisma model: `Job`; migration
- `jobs/runner.ts` + worker loop + `bootstrap/start-job-runner.ts`
- `jobs/recovery.ts` + integration test for boot recovery
- No handlers yet

**Phase 4a — Sidecar + upload + explore.**
- Prisma migration: `DxfFile` (with `explorationJson`, `structuralHash`, `extractionTrace`; no `complianceData` or SheetRenders yet); `StoredFile.kind` enum gains `EXTRACTION_SCRIPT` (reserved for 4b)
- Python sidecar container: FastAPI skeleton with `/health` + `/explore` only (runs `dxf_explorer.py`)
- `integrations/python-sidecar.client.ts` with `explore()` method only
- Upload endpoint `POST /api/projects/:id/dxf` + multer + `decodeOriginalName` + per-project sha256 dedup
- `DXF_EXTRACTION` handler: runs only the explore phase, persists `explorationJson` + `structuralHash` + `extractionTrace`, transitions to COMPLETED with `complianceData=null` (temporary)
- Client: upload dropzone on ProjectPage, `ExtractionStatusPill` (PENDING → EXTRACTING → COMPLETED/FAILED)
- Demo: upload any DXF, see fingerprint JSON + structural hash in the response

**Phase 4b — Codegen + execute + self-correct (v3.1 visual bridge).**
- Prisma migration: `ExtractionScript` table; `DxfFile.complianceData` field added
- **Explorer rewrite (sidecar submodule):** `dxf_explorer.py` now emits each text sample as `{raw, decoded?, x, y, block, handle, layer, entityType}` across `TEXT | MTEXT | ATTRIB | ATTDEF`; sample cap 30 → 50; new encoding-signal flags (`hasUnicodeEscapes`, `hasNativeHebrew`, `hasPossibleShx`, `hasHighBytes`); dual-viewport detection demoted from classifier to hint; `hints.dimensionUnitGuess` added. Structural-hash canonicalization respects `text_samples` ordering (see §3.4 notes).
- **New sidecar script: `dxf_sheet_renderer.py`** — consumes `explorationJson`, emits one PNG per sheet with numbered red dots at text-sample positions in the explorer's order. Dot-density policy: non-numeric first, dedup near-coincident, cap 100/sheet.
- **Sidecar new endpoint `POST /render-thumbnails`** — `{storedFileUri, explorationJson, thumbnailDir, reqId}` → `{thumbnails: [{sheetKey, pngUri, dotCount}], ms}`. Matplotlib added to the sidecar container image.
- **Sidecar new endpoint `POST /execute`** — runs the AI-generated script subprocess; returns `complianceData + renders[]` or `{ok:false, traceback}`.
- `integrations/python-sidecar.client.ts`: add `renderThumbnails()` + `execute()` methods.
- `integrations/anthropic.client.ts`: add `generateExtractionScript(opts: {explorationJson, thumbnails, reqId})` (multimodal — accepts image inputs) + `fixExtractionScript(opts: {explorationJson, brokenCode, traceback, reqId})` (text-only). Model: `claude-opus-4-7` + vision. Dedicated `EXTRACTION_CODEGEN_SYSTEM_PROMPT` constant describing the visual-bridge protocol + required `LABELS` dict preamble + `complianceData` schema + SVG rendering contract. **No Hebrew keyword table, no dual-viewport bbox-overlap rule, no spatial-correlation prose.**
- **Data migration (one-time, ships with Phase 4b deploy):** null out `DxfFile.explorationJson` + `DxfFile.structuralHash` for any row where `extractionStatus != COMPLETED`. Forces a re-explore on the next upload/job run. COMPLETED rows are left alone (none expected at this stage of integration).
- `DXF_EXTRACTION` handler expands to the full state machine (§7.3): `explore → findLatestByHash → (miss: render-thumbnails + codegen) → execute → on-crash self-correct → persist complianceData`. Transient `thumbnailDir` cleanup in `finally`.
- Handler does not yet persist `SheetRender` rows (renders produced but not DB-registered — deferred to 4c).
- Tests:
  - Unit: sidecar client `explore/renderThumbnails/execute`; anthropic client multimodal call shape; handler state machine (cache hit, cache miss, self-correction retry, exhausted-retries failure).
  - Integration: structural-hash cache hit path (second upload of structurally-similar file ~15s, $0, skips `render-thumbnails`); self-correction retry path (first-attempt crash → second-attempt success); exhausted-retries failure path (both attempts crash → `FAILED` + `extractionError` populated).
  - Contract test: dot-number invariant — on a fixture DXF, assert `thumbnails[0].dotCount ≤ text_samples.length` for sheet[0] and that the renderer consumes `explorationJson.text_samples` rather than re-enumerating ezdxf.
- Demo: cold first run ~100–160s at ~$1 with `complianceData` populated; re-upload structurally-similar file ~15s $0 cache hit.

**Phase 4c — SheetRender persistence + client sheet viewer.**
- Prisma migration: `SheetRender` table + `SheetClassification` enum
- `DXF_EXTRACTION` handler extends its final transaction to register `StoredFile` (kind=RENDER) + `SheetRender` rows for each SVG returned by `/execute`
- `GET /api/renders/:dxfFileId/:filename` serves SVGs with `Content-Type: image/svg+xml` + long immutable cache header
- Client: `DxfPreviewGrid.tsx` (3-column thumbnail grid with Hebrew `displayName` + classification badges + `svgWarning` triangle), `DxfPreviewLightbox.tsx` (fullscreen viewer), `useDxfSheets(dxfFileId)` hook
- Validation: tested against at least 3 different architects' DXFs before merge (generalization acceptance test)
- Demo: upload DXF, see 17 sheet thumbnails with Hebrew names; click one; SVG fills viewport

**Phase 5 — TAVA upload + OCR + requirements.**
- Prisma models: `TavaFile`, `TavaPage`, `Requirement`; migration
- `services/tava-extraction.service.ts` (pdftotext + tesseract parallel)
- `parseTavaRequirements` via `integrations/anthropic.client.ts`
- Handler: `tava-extraction.handler.ts`
- Client: TAVA upload in project page

**Phase 6 — Core compliance agent.**
- Prisma models: `Analysis`, `ComplianceResult` (with `sheetRenderId` FK); migration
- `compliance-agent.service.ts::buildCorePrompt` — reads `DxfFile.complianceData` + `SheetRender[]` (pass-through JSON + sheet list; no viewport summaries to rebuild)
- Post-parse regex `render_(\d+)\.svg` in `dxfEvidence` → populate `sheetRenderId`
- `core-analysis.service.ts` + handler
- Analyze endpoint + analysis-status polling
- Client: AnalysisPage with results + score + sheet thumbnails; clickable citations deep-link to the cited SVG

**Phase 7 — Add-on agents.**
- Prisma models: `AddonDocument`, `AddonRun`; migration
- Base + 4 concrete agents
- Upload + run endpoints
- Client: AddonAgentCard × 4

**Phase 8 — Chat with SSE streaming.**
- Prisma model: `ChatMessage`; migration
- `chat.service.ts` with `streamClaude` integration; context assembly reads `DxfFile.complianceData` + `SheetRender[]` (§9.3), not viewport summaries
- `POST /api/projects/:id/chat` as SSE endpoint; `GET` as history
- Client: `chat.api.ts` with streaming parser (fetch + ReadableStream), `useChat.ts` optimistic hook, `ChatPanel.tsx` with token-by-token rendering
- Abort on unmount / tab close

**Phase 9 — Polish + docs.**
- Hebrew UI copy review
- All vault pages written/updated
- Playwright smoke
- Final docker-compose.prod.yml, deploy script, host nginx template

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
7. **Stateless deployment — next major phase after v1.** S3-compatible object storage for all files (DXF, TAVA, addon docs, renders); Redis for `rate-limit-redis` and later BullMQ; Python sidecar switches from shared volume to S3 presigned URLs; worker splits into its own deployment (`src/worker.ts` entrypoint); renders endpoint returns `302` to presigned GET URLs; Multer swaps disk storage for a stream-through-to-S3 engine. Planned as a contained follow-up to v1; the `StoredFile.store` enum is already in the schema for this swap.
8. pgvector / RAG for chat (pull in past similar analyses)
9. BullMQ swap (follows the stateless deployment in #7)
10. SSE for analysis-status live updates (replaces 2.5 s polling)
11. 3D DXF entity support
12. DWG file support (client-side export step in UI)
13. Periodic cleanup job for orphan files on disk
14. Metrics / tracing backend (Prometheus, OTEL)
15. Rate limits on analyze endpoint (Claude spend cap)
16. **Area calculation fallback** — when the DXF lacks a שטחי בנייה table, estimate built area from floor-plan dimension chains (your v3 "what's left to build" #5). v1 answer for missing area is `CANNOT_CHECK`; reopen if real-world usage shows this is unacceptable.
17. **Per-user daily codegen budget** — cap how many unique structural hashes a user can trigger per day to bound Opus spend. Single-tenant v1 doesn't need this; re-evaluate when user count grows.
18. **Structural-cache hit-rate alerting** — surface the ratio of cache hits vs cold codegens to admins when it drops below a threshold (signals either prompt churn or an influx of novel architects). Log-only in v1.
19. **Multi-attempt self-correction (>1 retry)** — v1 allows exactly one self-correction attempt. If telemetry shows a meaningful tail of 2-retry successes, raise the cap.
20. **Script provenance / diffing UI** — admins can view `ExtractionScript` lineage (`fixedFromScriptId` chain) and diff the corrected script vs the broken one. Useful for improving `EXTRACTION_CODEGEN_SYSTEM_PROMPT` based on real failure patterns.
21. **Cross-architect generalization test suite** — ongoing fixture library of DXFs from different architects, run in CI as a regression gate on any change to the codegen prompt or explorer script. Phase 4c's acceptance test is the seed of this.
22. **Sonnet 4.6 + vision A/B** — v1 ships codegen on `claude-opus-4-7` for reliability. After Phase 4b accumulates 20–30 cold runs of telemetry (self-correction rate, generation time, cost per cold run), flip half of new cold runs to `claude-sonnet-4-6` + vision by setting `anthropic.generateExtractionScript()`'s model via config. Compare self-correction rate and total-cost-to-green. `ExtractionScript.generatedByModel` already supports the audit cut. Decision criterion: if Sonnet's self-correction rate is within +10% of Opus's, adopt Sonnet as default and Opus as the fix model.
23. **Transient thumbnail sweeper** — crashed Node processes leave orphan `uploads/tmp/thumbnails/<dxfFileId>/` directories. v1 handler cleans up in `finally`; crash-before-finally is rare but possible. Add an hourly sweeper that removes directories older than 24h. Low priority at v1 scale — a few dozen orphan directories per year are harmless.
24. **Dot-density cap tuning** — v1 caps at 100 dots/sheet with non-numeric-first prioritization. If telemetry shows Claude asking to reference dot numbers above the cap (via self-correction tracebacks or extraction errors citing missing labels), raise the cap or change the prioritization. Log `dotCount` per sheet from `/render-thumbnails` to enable this analysis.
25. **Re-export encoding drift** — if an architect re-exports the same DXF from a different AutoCAD version, the `raw` strings may change (e.g. SHX → Unicode). Structural hash changes, new cache entry fetched, new script generated. This is the correct behavior but doubles codegen cost for that architect. If it becomes a meaningful cost driver, consider a "label-map alias" table keyed by (architect, semantic_label) that seeds `LABELS` across structural-hash variations. Defer until real-world data shows this matters.

---

## 15. Approval

Approved by the user during brainstorm on 2026-04-19. This document supersedes `2026-04-19-auth-roles-security-design.md`.

**v3 DXF pipeline revision approved 2026-04-20.** Affects §2.12, §2.13, §2.20 (new), §3.2 (FileKind), §3.4 (full rewrite), §3.9 (sheetRenderId), §3.10 (JobType), §3.12 (change summary), §5.1 (data-access + handlers), §5.3 (integration clients), §7 (full rewrite), §9.1–§9.3, §11 (tests), §13 (Phase 4 split 4a/4b/4c, Phases 6/8 context tweaks), §14 (added open questions). Phases 0 + 1a are already merged and untouched; the v3 changes apply from Phase 4 onward.

Drift from this spec must be corrected either in code or in this file — not silently tolerated.

Next step: `superpowers:writing-plans` skill produces an implementation plan that maps directly to §13 phases.
