# BuildCheck — Phase 4a — Sidecar + DXF Upload + Explore Design

**Date:** 2026-04-20
**Status:** Approved for implementation planning
**Phase:** 4a (sidecar + server + client — biggest phase to date)
**Parent spec:** [2026-04-19-buildcheck-full-redesign.md](./2026-04-19-buildcheck-full-redesign.md) §2.7, §2.12, §3.4, §7, §13
**Depends on:** Phase 1a (auth — merged), Phase 2 (Project + StoredFile — in-review), Phase 3 (Job queue — in-review)

Introduces the Python FastAPI sidecar (new submodule `sidecar/`), the `DxfFile` model + upload pipeline, per-project sha256 byte-dedup, and a `DXF_EXTRACTION` job handler that runs **only** the explore phase. `complianceData`, `SheetRender[]`, Anthropic codegen, and self-correction all land in 4b. Phase 4a demo: upload `dummy_data/הערות - 24.11 (1).dxf`, see `explorationJson` + `structuralHash` on `DxfFile`.

---

## 1. Scope

**In scope**

**Sidecar (new submodule `Clearance-sidecar`):**
- FastAPI app with `GET /health` + `POST /explore`
- `dxf_explorer.py` — static explorer: block entity counts, per-block bboxes, sampled texts (Hebrew-decoded), layer list, dual-viewport pattern flag, classification-keyword pre-digest
- Dockerfile (uvicorn → port 3002)
- pytest suite against a committed DXF fixture (small synthetic DXF, not the user's `dummy_data/`)
- GitHub Actions CI

**Server:**
- Prisma: `DxfFile` model + `ExtractionStatus` enum; back-relations on `Project` + `StoredFile`. Phase-4a fields only: `explorationJson`, `structuralHash`, `extractionTrace`, `extractionStatus`, `extractionError`, `extractionJobId`. **Not** in 4a: `complianceData`, `sheetRenders[]` back-relation (4b / 4c).
- `integrations/python-sidecar.client.ts` — HTTP client with `explore()` only; forwards `X-Request-Id`.
- `middlewares/upload.middleware.ts` — multer disk storage + `decodeOriginalName` latin1→utf8 helper (Hebrew filename fix).
- Env: `PYTHON_SIDECAR_URL` (default `http://localhost:3002`).
- `api/routes/dxf.routes.ts` mounted at `/api/projects/:projectId/dxf`.
- `POST /api/projects/:projectId/dxf` upload: stream → disk, sha256-during-stream, per-project byte-dedup check, create `StoredFile` + `DxfFile` in transaction, soft-delete prior current, enqueue `DXF_EXTRACTION` job.
- `GET /api/projects/:projectId/dxf` — list DXFs for a project (owner/admin).
- `GET /api/dxf/:id` — detail (owner/admin).
- `jobs/handlers/dxf-extraction.handler.ts` — runs explore only, persists `explorationJson` + `structuralHash` + `extractionTrace`, transitions `DxfFile.extractionStatus` PENDING → EXTRACTING → COMPLETED/FAILED.
- `bootstrap/register-handlers.ts` — called before `startJobRunner()`; registers `DXF_EXTRACTION` handler in the phase-3 registry.
- Unit tests: service, handler (mocked sidecar), sidecar client (axios mocked).
- Integration tests: full upload → job → COMPLETED happy path with a fake sidecar URL; byte-dedup short-circuit; large-file rejection; non-owner 403.

**Client:**
- `api/dxf.api.ts` — upload (multipart), list, get.
- `hooks/useProjectDxfFiles.ts` — React Query with polling (every 2 s while any DXF has status PENDING | EXTRACTING; stops polling when all are terminal).
- `components/ExtractionStatusPill.tsx` — colored badge (PENDING: muted, EXTRACTING: blue animated, COMPLETED: green, FAILED: destructive).
- `pages/projects/DxfDropzone.tsx` — drag-and-drop + click-to-pick; POSTs via `useHttpClient`; toast + React Query invalidate on success.
- `ProjectDetailPage` — replace the "Files arrive in phase 4a" placeholder with a DXF list + dropzone.

**Out of scope**
- Anthropic codegen, extraction script cache, `/execute`, SheetRenders, SVG viewer (4b / 4c)
- `complianceData` on `DxfFile` (4b)
- TAVA uploads (5), add-on docs (7), compliance agent (6)
- Redis / BullMQ (post-v1)
- Admin-facing job inspector UI

**Green bar**
- Sidecar: `pytest` green, `docker build` green, `uvicorn` boots against a real DXF and returns `explorationJson`.
- Server: `typecheck` + `npm test` + `npm run test:integration` all green.
- Client: `typecheck` + `lint` + `build` all green.
- End-to-end: upload `dummy_data/הערות - 24.11 (1).dxf` via the client, see status pill transition PENDING → EXTRACTING → COMPLETED, then inspect the DB row to confirm `explorationJson` and `structuralHash` are populated.

---

## 2. Sidecar

### 2.1 Repo layout

```
Clearance-sidecar/
├── pyproject.toml                # poetry-ish deps declared here; we use pip-tools
├── requirements.txt              # compiled from pyproject; used by Docker and CI
├── requirements-dev.txt          # pytest, ruff
├── Dockerfile                    # uvicorn app.main:app --host 0.0.0.0 --port 3002
├── .github/workflows/ci.yml      # install + pytest + ruff + docker build
├── app/
│   ├── __init__.py
│   ├── main.py                   # FastAPI app, /health + /explore
│   ├── dxf_explorer.py           # pure function: explore_dxf(path) → dict
│   ├── hashing.py                # sha256 of canonicalized JSON
│   └── logging_config.py         # JSON stdout + X-Request-Id passthrough
└── tests/
    ├── conftest.py
    ├── fixtures/
    │   └── small_test.dxf        # tiny committed DXF for deterministic tests
    ├── test_health.py
    ├── test_dxf_explorer.py
    └── test_explore_endpoint.py
```

### 2.2 Contract (phase 4a — phase 4b adds `/execute`)

```
GET /health
  → 200 { ok: true, ezdxf_version: "1.x.y" }

POST /explore
  headers: X-Request-Id (forwarded from Node)
  body    { "stored_file_uri": "uploads/dxf/<cuid>.dxf" }
  success: 200 { "exploration_json": {...}, "structural_hash": "<sha256>", "ms": 2340 }
  sidecar error (bad path, file corrupt): 500 { "error": "<message>", "reqId": "<id>" }
```

`stored_file_uri` resolves via `UPLOADS_MOUNT` env (default `/data/uploads` in container, `./uploads` relative to `sidecar/` for dev). Must match where Node writes files. Dev parity without Docker: a `DEV_UPLOADS_ROOT` env that points at the same host path as the server's `UPLOADS_DIR`.

### 2.3 Explorer scope (phase 4a)

`explore_dxf(path: Path) → dict` returns a canonical dict containing:

- `source`: `{ filename, size_bytes, sha256 }` (sha256 recomputed for sanity, compared server-side)
- `blocks`: list of `{ name, entity_counts: { LINE, POLYLINE, LWPOLYLINE, ARC, CIRCLE, INSERT, TEXT, MTEXT }, bbox: [xmin, ymin, xmax, ymax], layers: [...], text_samples: [first 30 decoded strings], text_flags: { has_hebrew, has_integers, has_decimals, has_heights, has_coordinates } }`
- `layers`: list of layer names used across the drawing
- `dual_viewport_pairs`: heuristic — pairs of blocks with bbox IoU ≥ 0.5 where one has >500 LINEs and the other has >10 TEXTs (marker for geometry+annotation VP pattern)
- `classification_keywords`: per-block Hebrew keyword match counts (categories: floor_plan, elevation, section, survey, parking) — precomputed lookup table, not NLP
- `meta`: `{ ezdxf_version, explorer_version: "4a.1", ms }`

`structural_hash = sha256(json.dumps(canonical_form, sort_keys=True, ensure_ascii=False))`. `canonical_form` = `explore_output` minus `meta` and `source` (those vary run-to-run and file-to-file; we want structurally-similar DXFs to hash identically so phase 4b's codegen cache can hit).

Hebrew decoding: `ezdxf` returns texts as possibly-broken strings. A `_combine_and_scrub_surrogates(s)` helper normalizes CP1252-encoded-as-latin1 → utf-8; falls back to raw string if scrub fails. Same logic that worked in the v2 prototype the user has validated.

### 2.4 Python deps

- `fastapi` ~= 0.115
- `uvicorn[standard]` ~= 0.32
- `ezdxf` ~= 1.3
- `pydantic` ~= 2.9
- `structlog` ~= 24.4 (JSON logging)

Dev: `pytest`, `pytest-asyncio`, `httpx` (for test client), `ruff`.

Python 3.12 (matches 3.11+ ezdxf requirement; 3.12 is current).

### 2.5 Dockerfile

Multi-stage: build stage installs deps into a venv; runtime stage copies only the venv + app; `CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3002"]`. Listens on port 3002 (distinct from server 3001 / client 5173).

### 2.6 Tests

- `test_health.py`: `GET /health` returns 200 with `ok: true` and `ezdxf_version` populated
- `test_dxf_explorer.py`: feeds `tests/fixtures/small_test.dxf`, asserts block list non-empty, bbox tuple shape, `structural_hash` deterministic across two runs with same file
- `test_explore_endpoint.py`: `POST /explore` with a good file → 200 + expected keys; bad path → 500 with structured error

The fixture `small_test.dxf` is synthesized with `ezdxf` in a test-generator script (also committed, `tests/fixtures/build_fixture.py`) so the DXF is reproducible. It contains 2 blocks with a handful of entities. Keeps the repo small (~5 KB) and CI hermetic. The user's real `dummy_data/` DXFs stay unused in CI (gitignored in main repo anyway).

---

## 3. Server

### 3.1 Data model (Prisma)

```prisma
enum ExtractionStatus {
  PENDING
  EXTRACTING
  COMPLETED
  FAILED
}

model DxfFile {
  id                 String           @id @default(cuid())
  projectId          String
  project            Project          @relation(fields: [projectId], references: [id], onDelete: Cascade)
  storedFileId       String           @unique
  storedFile         StoredFile       @relation(fields: [storedFileId], references: [id])

  extractionStatus   ExtractionStatus @default(PENDING)
  extractionError    String?
  extractionJobId    String?

  explorationJson    Json?
  structuralHash     String?
  extractionTrace    Json?

  deletedAt          DateTime?
  createdAt          DateTime         @default(now())

  @@index([projectId, createdAt])
  @@index([structuralHash])
}
```

`Project.dxfFiles DxfFile[]` back-relation added. `StoredFile.dxfFile DxfFile?` back-relation added.

Migration: `npx prisma migrate dev --name phase_4a_dxf_file`.

### 3.2 Sidecar integration

`src/integrations/python-sidecar.client.ts`:

```ts
export interface PythonSidecarClient {
  explore(opts: { storedFileUri: string; reqId: string }): Promise<{
    explorationJson: unknown;
    structuralHash: string;
    ms: number;
  }>;
}
```

Uses axios against `PYTHON_SIDECAR_URL`. Request body snake_case (`stored_file_uri`) per the sidecar contract; response un-snake-cased on the Node side. 60-second timeout. On 5xx, throws `HttpError(500, \`sidecar.explore failed: ${body.error}\`)`; on network error throws a plain Error (propagates as a 500 to the client but the handler captures it as an extraction failure anyway).

### 3.3 Upload middleware

`src/middlewares/upload.middleware.ts`: multer with `diskStorage({ destination: ..., filename: (req, file, cb) => cb(null, \`\${cuid()}.dxf\`) })`. Size limit 100 MB for DXF (per spec §4.8). The `decodeOriginalName` helper re-decodes `file.originalname` from latin1 to utf-8 when the header was mis-decoded — the Hebrew-filename fix. Applied inside the controller (not middleware) since different routes have different size limits later.

### 3.4 Upload route + controller + service

`POST /api/projects/:projectId/dxf`:
1. Multer writes the file to `uploads/dxf/<cuid>.dxf`, computes sha256 via a piped `crypto.createHash('sha256')` stream (no file re-read).
2. `decodeOriginalName(file.originalname)`.
3. **Project access check:** owner or admin (reuses `ensureProjectAccess` from phase 2 — refactored into a shared helper `lib/project-access.ts`).
4. **Byte-dedup:** query for `DxfFile` where `project.id = projectId AND storedFile.sha256 = uploadedSha`. If found: undelete if soft-deleted; delete the just-uploaded file from disk (idempotent); return the existing `DxfFile` with the existing `explorationStatus`. No job enqueued.
5. **Otherwise, inside `prisma.$transaction`:**
   - Create `StoredFile` (kind=DXF, uri, sha256, sizeBytes, originalName).
   - Soft-delete any existing non-deleted `DxfFile` on this project.
   - Create `DxfFile` (status=PENDING, storedFileId, projectId).
   - Enqueue `Job { type: DXF_EXTRACTION, dxfFileId }`.
   - Set `DxfFile.extractionJobId = job.id` (second update inside the same transaction).
6. Return `201 { data: { dxfFile: publicDxf(...) } }`.

`publicDxf(d)` strips `explorationJson` / `extractionTrace` from the default shape — those are machine-fuel, not UI payloads. (Admin-only endpoint can surface them in a later phase.)

### 3.5 List + get

- `GET /api/projects/:projectId/dxf` → list DXFs for a project (owner/admin). Only non-deleted by default.
- `GET /api/dxf/:id` → detail (owner/admin). Returns `publicDxf(...)`.
- No update / delete in 4a (re-upload is the delete + replace path).

### 3.6 DXF_EXTRACTION handler (phase 4a — explore-only)

`src/jobs/handlers/dxf-extraction.handler.ts`:

```ts
export async function dxfExtractionHandler(job: Job): Promise<void> {
  const reqId = `job:${job.id}`;
  const dxf = await prisma.dxfFile.findUniqueOrThrow({
    where: { id: job.dxfFileId! },
    include: { storedFile: true },
  });
  await prisma.dxfFile.update({ where: { id: dxf.id }, data: { extractionStatus: 'EXTRACTING' } });

  const trace: Record<string, unknown> = { phases: [] };
  try {
    const t0 = Date.now();
    const { explorationJson, structuralHash } = await sidecar.explore({
      storedFileUri: dxf.storedFile.uri,
      reqId,
    });
    (trace.phases as unknown[]).push({ phase: 'explore', ms: Date.now() - t0 });
    await prisma.dxfFile.update({
      where: { id: dxf.id },
      data: {
        explorationJson: explorationJson as Prisma.InputJsonValue,
        structuralHash,
        extractionTrace: trace as Prisma.InputJsonValue,
        extractionStatus: 'COMPLETED',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.dxfFile.update({
      where: { id: dxf.id },
      data: {
        extractionStatus: 'FAILED',
        extractionError: message.slice(-2000),
        extractionTrace: trace as Prisma.InputJsonValue,
      },
    });
    throw err; // job runner marks Job row FAILED too
  }
}
```

Registration: `src/bootstrap/register-handlers.ts` (called from `src/index.ts` before `startJobRunner()`):

```ts
registerHandler('DXF_EXTRACTION', dxfExtractionHandler);
```

### 3.7 Env additions

`src/utils/env.ts`: `PYTHON_SIDECAR_URL: z.string().url().default('http://localhost:3002')`.

---

## 4. Client

### 4.1 Files

```
client/src/
  api/
    dxf.api.ts                    # upload, list, getDxf
    types.ts                      # + DxfFile, ExtractionStatus
  hooks/
    useProjectDxfFiles.ts         # list + conditional polling
  components/
    ExtractionStatusPill.tsx
  pages/
    projects/
      DxfDropzone.tsx             # drag-and-drop + file picker
  pages/
    ProjectDetailPage.tsx         # REPLACE "Files" placeholder
```

### 4.2 Upload hook

`uploadDxf(projectId, file)` uses `FormData` + `useHttpClient({ fn: uploadDxf })`. On success → invalidate `['project-dxfs', projectId]` + toast. Progress reporting (percent) deferred — phase 4a ships a plain spinner.

### 4.3 Polling

`useProjectDxfFiles(projectId)` wraps `useQuery` with `refetchInterval: (data) => data?.dxfFiles.some(d => d.extractionStatus === 'PENDING' || d.extractionStatus === 'EXTRACTING') ? 2000 : false`. Stops once all are terminal.

### 4.4 ExtractionStatusPill

Colored `<Badge>`:
- PENDING → `variant="outline"`, label "Pending"
- EXTRACTING → `variant="default"` with a spinner, label "Extracting…"
- COMPLETED → green-tinted badge, label "Ready"
- FAILED → `variant="destructive"`, label "Failed"

### 4.5 DxfDropzone

Uses the native `<input type="file" accept=".dxf">` + drag-over styling. Accepts one file at a time. 100 MB client-side check, with a toast if exceeded (server also enforces).

### 4.6 ProjectDetailPage

Replace the `Files` `Card` placeholder with a new section:
- Dropzone at top
- List of existing DXFs (rows): original filename + sha256 prefix + size + `<ExtractionStatusPill>` + uploaded-ago

Only owner / admin sees the dropzone. Non-owner viewers see the list only (phase 2's access rule already handles 403 via useProject; here we gate the dropzone on `user.id === project.ownerId || user.role === 'ADMIN'`).

---

## 5. Process / branching

- Branches cut (local):
  - Main repo: `feat/buildcheck-phase-4a` (off phase-3)
  - Server: `feat/buildcheck-phase-4a` (off server phase-3)
  - Client: `feat/buildcheck-phase-4a` (off client phase-2; phase-4a only needs the post-phase-2 state since phase-3 is server-only)
  - Sidecar: `feat/buildcheck-phase-4a` (off fresh `main` — first real content for this repo)
- PRs target:
  - Server → `integration/buildcheck` (via the main-repo aggregator PR; server PR targets server's `integration/buildcheck` once it exists, else `main`)
  - Client → client `main`
  - Sidecar → sidecar `main`
  - Main repo → `integration/buildcheck`

Note: server + client `main` on their respective remotes don't yet have `integration/buildcheck` branches. Given phase 1/2/3 PRs there also target `main`, phase 4a PRs target the same: server → `main`, client → `main`, sidecar → `main`.

---

## 6. Risks & non-goals

- **Python in the stack.** First time we're running Python in this repo. The sidecar submodule keeps concerns isolated — server never imports Python, sidecar never imports Postgres. Dev setup documented in `sidecar/README.md`.
- **Volume sharing in dev.** Server and sidecar need to resolve the same `uploads/dxf/<cuid>.dxf` path. In dev without Docker: both services run locally, server uses `UPLOADS_DIR=./uploads`, sidecar uses `DEV_UPLOADS_ROOT=../server/uploads`. In prod via docker-compose: shared volume mounts the same path. `docker-compose.yml` is out of phase 4a's green bar (prod is phase 9) but the env knobs land now so we don't refactor later.
- **Explorer coverage.** Phase 4a's explorer handles blocks, entities, texts, layers, dual-viewport heuristic, classification keywords. Phase 4b may need additional signal (dimension-chain assembly, spatial correlation) — we'll extend `dxf_explorer.py` then. Adding signal is backward-compatible (new keys in `explorationJson`); the `structuralHash` changes, which invalidates the cache, which is fine since phase 4b is the first time the cache is used.
- **Byte-dedup is per-project.** Intentional — two users uploading identical bytes should not share `StoredFile` rows for authorization reasons (spec §7.2). Cross-project sharing is deferred; v1 is single-owner per project.
- **No client file tests.** Owner directive continues to apply. Manual smoke covers the upload flow.
- **Python CI has its own cycle.** Server CI doesn't block on sidecar CI. If the sidecar is broken, the integration test with a mocked sidecar URL still passes. The end-to-end demo requires a healthy sidecar.
