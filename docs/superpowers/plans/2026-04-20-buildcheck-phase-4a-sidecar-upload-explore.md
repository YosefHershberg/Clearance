# Phase 4a — Sidecar + DXF Upload + Explore Plan

> Biggest phase: new Python submodule + server upload pipeline + client upload UI. Plan is compressed — patterns for layered server code and shadcn client code are established in phases 1a/1b/2; this plan focuses on the novel parts (FastAPI sidecar, DXF explorer logic, multer upload + sha256 dedup, DXF_EXTRACTION handler registration).

**Design spec:** [2026-04-20-buildcheck-phase-4a-sidecar-upload-explore-design.md](../specs/2026-04-20-buildcheck-phase-4a-sidecar-upload-explore-design.md)

---

## Cluster overview

```
0. Sidecar scaffold + /health + /explore (Python, sequential)
   └─> 1. Server: DxfFile migration (sequential)
           └─> 2. Server: sidecar client + upload middleware + env (parallel within)
                   └─> 3. Server: DXF upload + list/get + handler + register (parallel within)
                           └─> 4. Server: unit + integration tests (sequential)
                                   └─> 5. Client: api + hooks + status pill + dropzone + detail page (parallel within)
                                           └─> 6. Push + open 4 PRs + bump submodules + status (sequential)
```

---

## Cluster 0 — Sidecar submodule

Files inside `sidecar/` (branch: `feat/buildcheck-phase-4a`):

- `pyproject.toml`, `requirements.txt`, `requirements-dev.txt`
- `Dockerfile`
- `.github/workflows/ci.yml` — install + pytest + ruff + docker build
- `app/__init__.py`, `app/main.py`, `app/dxf_explorer.py`, `app/hashing.py`, `app/logging_config.py`
- `tests/conftest.py`, `tests/fixtures/build_fixture.py`, `tests/fixtures/small_test.dxf`, `tests/test_health.py`, `tests/test_dxf_explorer.py`, `tests/test_explore_endpoint.py`

### Steps

- [ ] **0.1** Write `pyproject.toml` + compiled `requirements.txt` with `fastapi`, `uvicorn[standard]`, `ezdxf`, `pydantic`, `structlog`. Dev extras: `pytest`, `pytest-asyncio`, `httpx`, `ruff`.
- [ ] **0.2** Write `app/main.py`: FastAPI app with `/health` (returns `{ ok: true, ezdxf_version }`) + `/explore` (validates body, resolves `stored_file_uri` under `DEV_UPLOADS_ROOT`, calls `explore_dxf`, returns `{ exploration_json, structural_hash, ms }`).
- [ ] **0.3** Write `app/dxf_explorer.py`: `explore_dxf(path) → dict` implementing scope §2.3 (blocks, entity counts, bboxes, text samples + Hebrew decode via `_combine_and_scrub_surrogates`, layers, `dual_viewport_pairs`, `classification_keywords`). Small, pure, no I/O beyond reading the DXF.
- [ ] **0.4** Write `app/hashing.py`: `canonical_sha256(obj) → str` using `json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode('utf-8')` then sha256.
- [ ] **0.5** Write `tests/fixtures/build_fixture.py` — generates `small_test.dxf` with 2 named blocks, a handful of LINE/TEXT/CIRCLE entities across two layers. Run once, commit the resulting `.dxf` (~few KB).
- [ ] **0.6** Write the three test files per spec §2.6. Run `pytest -q` → all green.
- [ ] **0.7** Write Dockerfile. Run `docker build -t clearance-sidecar .` → green.
- [ ] **0.8** Write `.github/workflows/ci.yml` — Python 3.12 on ubuntu-latest, install deps, `pytest`, `ruff check`, `docker build`.
- [ ] **0.9** Commit in chunks per natural unit:
  - `chore: python deps + docker`
  - `feat: /health endpoint + structlog logging`
  - `feat: dxf_explorer + canonical hashing`
  - `feat: /explore endpoint`
  - `test: pytest suite + committed fixture`
  - `ci: github actions (pytest + ruff + docker build)`
- [ ] **0.10** Push branch to origin, open sidecar PR against `main`.

---

## Cluster 1 — Server DxfFile migration

Files in `server/`:

- `prisma/schema.prisma` (modify)
- `prisma/migrations/<ts>_phase_4a_dxf_file/migration.sql` (generated)
- `src/test-helpers/db.ts` (add `prisma.dxfFile.deleteMany({})` before `project.deleteMany`)

### Steps

- [ ] **1.1** Add `ExtractionStatus` enum + `DxfFile` model + `Project.dxfFiles` + `StoredFile.dxfFile` back-relations per spec §3.1.
- [ ] **1.2** `npx prisma migrate dev --name phase_4a_dxf_file` → success.
- [ ] **1.3** `npm run typecheck` → green. Commit: `feat(db): phase 4a — DxfFile model + ExtractionStatus + back-relations`.

---

## Cluster 2 — Sidecar client + upload middleware + env

Files:

- `src/integrations/python-sidecar.client.ts` (create)
- `src/middlewares/upload.middleware.ts` (create)
- `src/middlewares/index.ts` (export `uploadDxf`)
- `src/utils/env.ts` (add `PYTHON_SIDECAR_URL`)

### Steps

- [ ] **2.1** Implement `python-sidecar.client.ts` with `explore()` only (see spec §3.2). Use `axios.create` with baseURL + timeout 60s.
- [ ] **2.2** Implement multer config: `diskStorage` rooted at `env.UPLOADS_DIR`, filename = `${cuid()}.dxf`, 100 MB limit, single-file under form field `file`.
- [ ] **2.3** Implement `decodeOriginalName(name: string): string` helper (latin1→utf-8 roundtrip; returns `name` unchanged if decoding throws).
- [ ] **2.4** Add `PYTHON_SIDECAR_URL` to env Zod schema with `.url().default('http://localhost:3002')`.
- [ ] **2.5** Typecheck → green. Commit: `feat(dxf): sidecar client + multer upload middleware + env`.

---

## Cluster 3 — DXF upload + list/get + handler

Files:

- `src/api/schemas/dxf.schemas.ts`
- `src/api/data-access/dxf-file.da.ts`
- `src/api/services/dxf-file.service.ts`
- `src/api/controllers/dxf-file.controller.ts`
- `src/api/routes/dxf.routes.ts`
- `src/api/routes/index.ts` (mount new router at `/api/projects/:projectId/dxf` + `/api/dxf`)
- `src/lib/project-access.ts` (extract the owner-or-admin check from phase 2's `loadAccessible`; import from projects.service going forward)
- `src/jobs/handlers/dxf-extraction.handler.ts`
- `src/bootstrap/register-handlers.ts`
- `src/index.ts` (call `registerHandlers()` before `startJobRunner()`)

### Steps

- [ ] **3.1** Extract project-access helper to `src/lib/project-access.ts`; refactor `projects.service.ts` to use it. Run unit tests → still green.
- [ ] **3.2** Write DXF data-access (`createStoredFile+dxfFile in tx`, `findByProjectAndSha`, `listByProject`, `findById`, `softDeletePriorCurrent`, `setExtractionJobId`).
- [ ] **3.3** Write service: `uploadDxf({ user, projectId, filePath, originalName, sha256, sizeBytes })` — access check + dedup check + transaction + enqueue.
- [ ] **3.4** Write controller + schemas + routes. Wire into `routes/index.ts` via two mounts (`/projects/:projectId/dxf` for upload+list, `/dxf` for detail).
- [ ] **3.5** Write `dxf-extraction.handler.ts` per spec §3.6. Exports a single function.
- [ ] **3.6** Write `bootstrap/register-handlers.ts`: calls `registerHandler('DXF_EXTRACTION', dxfExtractionHandler)`. Import + call from `src/index.ts` before `startJobRunner()`.
- [ ] **3.7** Typecheck → green. Commit: `feat(dxf): upload + list + detail + DXF_EXTRACTION handler (explore-only)`.

---

## Cluster 4 — Server tests

Unit tests (`*.test.ts`):

- `src/integrations/python-sidecar.client.test.ts` — mock axios, assert request URL + body + header, parse response.
- `src/api/services/dxf-file.service.test.ts` — mock DA + job runner; cover happy path, dedup short-circuit, 403 cross-owner, 404 missing project.
- `src/jobs/handlers/dxf-extraction.handler.test.ts` — mock prisma + sidecar; cover explore-success happy path (COMPLETED + `explorationJson`/`structuralHash` persisted), sidecar-throws path (FAILED + `extractionError` persisted + rethrows).

Integration tests (`*.integration.test.ts`):

- `src/api/routes/dxf.integration.test.ts` — supertest against the full app. Use a **stub sidecar** (either a local `msw` HTTP mock at `PYTHON_SIDECAR_URL` or a nock-style interceptor) returning canned `exploration_json` + `structural_hash`. Cover:
  - Happy path: upload → job runs once → DxfFile status COMPLETED with persisted explore output
  - Byte-dedup: upload same bytes twice → second call returns existing `DxfFile`, no new job
  - Large-file 413 (or 400): beyond 100 MB limit
  - Cross-owner 403
  - Non-authed 401
- Adds one line to `src/test-helpers/db.ts`: truncate `dxfFile` before `project`.

### Steps

- [ ] **4.1** Write the three unit tests. Run `npm test -- dxf|sidecar|python-sidecar` → green.
- [ ] **4.2** Write the integration test with sidecar HTTP mock. Run `npm run test:integration -- dxf` → green.
- [ ] **4.3** Full green bar: `npm run typecheck` + `npm test` + `npm run test:integration`. Commit: `test(dxf): unit + integration coverage for upload + handler`.

---

## Cluster 5 — Client

Files:

- `src/api/dxf.api.ts`
- `src/api/types.ts` (append `DxfFile`, `ExtractionStatus`, `ListDxfFilesResponse`)
- `src/hooks/useProjectDxfFiles.ts`
- `src/components/ExtractionStatusPill.tsx`
- `src/pages/projects/DxfDropzone.tsx`
- `src/pages/ProjectDetailPage.tsx` (replace Files card with dropzone + list)

### Steps

- [ ] **5.1** Types + `dxf.api.ts` (upload via FormData, list, get).
- [ ] **5.2** `useProjectDxfFiles` with conditional `refetchInterval` polling.
- [ ] **5.3** `ExtractionStatusPill` — base-ui Badge with status-conditional className.
- [ ] **5.4** `DxfDropzone` — file input + drag-over styling + client-side 100 MB check + `useHttpClient({ fn: uploadDxf })`.
- [ ] **5.5** Update `ProjectDetailPage` to render dropzone (owner/admin only) + DXF row list.
- [ ] **5.6** `typecheck` + `lint` + `build` → all green. Commit: `feat(dxf): upload dropzone + status pill on project detail`.

---

## Cluster 6 — Push + PRs + bumps + Phase Status

### Steps

- [ ] **6.1** Push sidecar branch + open PR (target `main`). Wait for CI green.
- [ ] **6.2** Push server branch + open PR.
- [ ] **6.3** Push client branch + open PR.
- [ ] **6.4** Main repo: bump all three submodule pointers in one commit. Update `Phase Status.md` → phase 4a in-review with four PR links. Push main-repo phase-4a + open PR.

---

## Self-review

- [ ] Spec §1–§6 items all mapped to tasks
- [ ] No TBDs
- [ ] Types consistent (sidecar snake_case vs server camelCase clearly bridged)
- [ ] Sidecar CI + server + client all green
- [ ] E2E smoke: upload `dummy_data/הערות - 24.11 (1).dxf`, status pill PENDING→EXTRACTING→COMPLETED, DB row has `explorationJson` + `structuralHash`
- [ ] Four PRs open, Phase Status = in-review
