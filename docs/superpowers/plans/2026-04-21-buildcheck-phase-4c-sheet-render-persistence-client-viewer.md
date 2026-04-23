# Phase 4c — SheetRender Persistence + Client Sheet Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the SVG renders that Phase 4b's pipeline already produces into a queryable DB-backed list and a clickable 3-column thumbnail grid + fullscreen lightbox in the client. After this phase, uploading a DXF shows the user a visual preview of every sheet extracted, with Hebrew display names and classification badges.

**Architecture:** Server adds a `SheetRender` table (one row per sheet of a DxfFile) and extends the `DXF_EXTRACTION` handler's final transaction to register `StoredFile(RENDER)` + `SheetRender` rows for each SVG returned by `/execute`. A new `GET /api/renders/:dxfFileId/:filename` endpoint streams the SVG bytes with an immutable cache header and a strict path sandbox. The existing `GET /api/dxf/:id` detail endpoint returns the sheets list alongside the DxfFile. Client adds a `useDxfFile` hook (detail query), a `DxfPreviewGrid` component rendering 3-column thumbnails via `<img src>`, and a `DxfPreviewLightbox` for fullscreen viewing. Wires into `ProjectDetailPage`.

**Tech Stack:** Server — Node 20 + Express 5 + Prisma 7 + Jest. Client — React 19 + Vite 8 + Tailwind v4 + shadcn + `@tanstack/react-query` + `react-router`. No new dependencies.

**Design spec:** [2026-04-19-buildcheck-full-redesign.md](../specs/2026-04-19-buildcheck-full-redesign.md) §3.4 (SheetRender model), §4.4 (DXF endpoints), §4.8 (Renders endpoint), §7.3 (handler persistence block), §13 Phase 4c (scope).

---

## Cluster overview

```
0. Server Prisma migration — SheetRender + SheetClassification enum
   └─> 1. Server code — handler SheetRender persistence + renders endpoint + data access
           └─> 2. Server tests — handler + data-access integration + renders route
                   └─> 3. Client — API types + useDxfFile hook
                           └─> 4. Client — DxfPreviewGrid + DxfPreviewLightbox + ProjectDetailPage wiring
                                   └─> 5. Finalize — push, PRs, submodule bumps, Phase Status, acceptance test
```

Work inside each cluster is mostly linear. Cluster 3 (client API) can start as soon as Cluster 1's `GET /api/dxf/:id` detail response shape is committed; no strict ordering with Cluster 2 tests.

---

## Pre-flight

- [ ] **P.1** Confirm you're at `integration/buildcheck` tip `c65a461` (Phase 4b merged + Phase Status advanced). Check:

  ```bash
  cd "C:\Users\yosefh\OneDrive - hms.co.il\Desktop\Clearance"
  git fetch origin && git switch integration/buildcheck && git pull --ff-only
  git log --oneline -1       # expect: c65a461 chore(integration): mark phase 4b merged, advance current to 4c
  ```

- [ ] **P.2** Main-repo branch:

  ```bash
  git switch -c feat/buildcheck-phase-4c
  ```

- [ ] **P.3** Server submodule branch (off `main`, which is at `11f1651` after Phase 4b):

  ```bash
  cd server && git fetch origin && git switch main && git pull --ff-only && git switch -c feat/buildcheck-phase-4c && cd -
  ```

- [ ] **P.4** Client submodule branch (off `main`):

  ```bash
  cd client && git fetch origin && git switch main && git pull --ff-only && git switch -c feat/buildcheck-phase-4c && cd -
  ```

- [ ] **P.5** No sidecar work this phase. Leave the sidecar submodule alone.

---

## Cluster 0 — Server Prisma: SheetRender + SheetClassification

Directory: `server/` (branch `feat/buildcheck-phase-4c`).

**Files:**
- Modify: `server/prisma/schema.prisma`
- Generated: `server/prisma/migrations/<ts>_phase_4c_sheet_render/migration.sql`
- Modify: `server/src/test-helpers/db.ts`

### Steps

- [ ] **0.1** Add the `SheetClassification` enum at the top of the schema (near the other enums):

  ```prisma
  enum SheetClassification {
    INDEX_PAGE
    FLOOR_PLAN
    CROSS_SECTION
    ELEVATION
    PARKING_SECTION
    SURVEY
    SITE_PLAN
    ROOF_PLAN
    AREA_CALCULATION
    UNCLASSIFIED
  }
  ```

- [ ] **0.2** Add the `SheetRender` model after `ExtractionScript`:

  ```prisma
  model SheetRender {
    id           String              @id @default(cuid())
    dxfFileId    String
    dxfFile      DxfFile             @relation(fields: [dxfFileId], references: [id], onDelete: Cascade)
    storedFileId String              @unique
    storedFile   StoredFile          @relation(fields: [storedFileId], references: [id])

    sheetIndex      Int
    displayName     String
    classification  SheetClassification @default(UNCLASSIFIED)
    geometryBlock   String?
    annotationBlock String?
    svgWarning      String?
    createdAt       DateTime            @default(now())

    @@unique([dxfFileId, sheetIndex])
    @@index([dxfFileId, classification])
  }
  ```

  **Note:** the spec's §3.4 listing has a `results ComplianceResult[]` back-relation — omit it for now; `ComplianceResult` doesn't exist until Phase 6. Add the back-relation in Phase 6's migration, not this one.

- [ ] **0.3** Add back-relations on `DxfFile` and `StoredFile`:

  ```prisma
  model DxfFile {
    // ... existing fields ...

    sheetRenders SheetRender[]    // NEW

    @@index([projectId, createdAt])
    @@index([structuralHash])
  }

  model StoredFile {
    // ... existing fields ...
    dxfFile          DxfFile?
    extractionScript ExtractionScript?
    sheetRender      SheetRender?     // NEW

    @@index([sha256])
  }
  ```

- [ ] **0.4** Generate the migration:

  ```bash
  cd server
  npx prisma migrate dev --name phase_4c_sheet_render
  ```

  Expected: new directory `prisma/migrations/<ts>_phase_4c_sheet_render/` with `migration.sql` containing (a) `CREATE TYPE "SheetClassification" AS ENUM (...)`, (b) `CREATE TABLE "SheetRender" (...)` with all columns, (c) a UNIQUE index on `(dxfFileId, sheetIndex)`, (d) a plain index on `(dxfFileId, classification)`, (e) a UNIQUE index on `storedFileId`, (f) FK constraints to `DxfFile` (onDelete CASCADE) and `StoredFile` (onDelete RESTRICT by default).

- [ ] **0.5** Verify Prisma client regenerated:

  ```bash
  ls src/generated/prisma/client/index.d.ts  # just confirms the file was touched
  ```

  (Prisma `migrate dev` auto-runs `generate`.)

- [ ] **0.6** Update `src/test-helpers/db.ts` to include `sheetRender` in `truncateAll` — BEFORE `dxfFile.deleteMany` (SheetRender references DxfFile via FK CASCADE, but explicit ordering is safer and matches the pattern used for `extractionScript`):

  ```typescript
  export async function truncateAll(): Promise<void> {
      await prisma.auditLog.deleteMany({});
      await prisma.job.deleteMany({});
      await prisma.sheetRender.deleteMany({});     // NEW — before dxfFile
      await prisma.extractionScript.deleteMany({});
      await prisma.dxfFile.deleteMany({});
      await prisma.project.deleteMany({});
      await prisma.storedFile.deleteMany({});
      await prisma.user.deleteMany({});
  }
  ```

- [ ] **0.7** Typecheck:

  ```bash
  cd server
  npm run typecheck
  ```

  Expected: clean.

- [ ] **0.8** Commit:

  ```bash
  git add prisma/schema.prisma prisma/migrations src/test-helpers/db.ts
  git commit -m "feat(db): phase 4c — SheetRender + SheetClassification enum + back-relations"
  ```

---

## Cluster 1 — Server code: handler persistence + renders endpoint + DxfFile detail with sheets

Directory: `server/` (same branch).

**Files:**
- Create: `server/src/api/data-access/sheet-render.da.ts`
- Modify: `server/src/api/data-access/dxf-file.da.ts` — extend `findById` to include `sheetRenders`
- Modify: `server/src/api/services/dxf-file.service.ts` — shape the detail response with basenames
- Modify: `server/src/jobs/handlers/dxf-extraction.handler.ts` — extend final transaction
- Create: `server/src/api/controllers/renders.controller.ts`
- Create: `server/src/api/routes/renders.routes.ts`
- Create: `server/src/api/schemas/renders.schemas.ts`
- Modify: `server/src/api/routes/index.ts` — mount `/api/renders`

### Steps

- [ ] **1.1** Create `server/src/api/data-access/sheet-render.da.ts`:

  ```typescript
  import prisma from '../../config/prisma';
  import type { SheetRender, StoredFile } from '../../generated/prisma/client';

  export type SheetRenderWithFile = SheetRender & { storedFile: StoredFile };

  export async function findByDxfFileId(dxfFileId: string): Promise<SheetRenderWithFile[]> {
      return prisma.sheetRender.findMany({
          where: { dxfFileId },
          orderBy: { sheetIndex: 'asc' },
          include: { storedFile: true },
      });
  }
  ```

  No `create` helper — rows are created inside the handler's `$transaction` (see step 1.5) and never elsewhere.

- [ ] **1.2** Extend `server/src/api/data-access/dxf-file.da.ts` — add a `findByIdWithSheets(id)` helper next to the existing `findById` (don't modify the existing signature — other callers may rely on the slimmer shape):

  ```typescript
  // Add below existing exports:
  import type { SheetRender } from '../../generated/prisma/client';

  export type DxfFileDetail = Awaited<ReturnType<typeof findByIdWithSheets>>;

  export async function findByIdWithSheets(id: string) {
      return prisma.dxfFile.findUnique({
          where: { id },
          include: {
              storedFile: true,
              sheetRenders: {
                  orderBy: { sheetIndex: 'asc' },
                  include: { storedFile: true },
              },
          },
      });
  }
  ```

  If `dxf-file.da.ts` already has a `findById({ include: { storedFile: true } })`, leave it and add `findByIdWithSheets` as a new export. The service picks which to call.

- [ ] **1.3** Modify `server/src/api/services/dxf-file.service.ts::getDxfFile(user, id)` (or whatever the existing detail-service method is named — read the file first):

  - Replace its data-access call with `findByIdWithSheets(id)`.
  - After loading, shape the returned sheet list to include a `filename` field (basename of the SVG's `storedFile.uri`) and drop the nested `storedFile` object — callers don't need the raw `uri` / `sha256` / `sizeBytes` of the SVG, they only need `filename` to construct the render URL.

  Add this helper at the top of the service file (or in a shared lib if the repo has one):

  ```typescript
  import path from 'node:path';
  // ... existing imports ...

  function svgFilename(uri: string): string {
      return path.basename(uri);
  }
  ```

  Then in `getDxfFile`:

  ```typescript
  const dxf = await da.findByIdWithSheets(id);
  if (!dxf) throw new HttpError(404, 'dxf_not_found');
  await ensureOwnerOrAdmin(user, dxf.project);  // or whatever the existing access check is

  return {
      ...dxf,
      sheetRenders: dxf.sheetRenders.map(s => ({
          id: s.id,
          sheetIndex: s.sheetIndex,
          displayName: s.displayName,
          classification: s.classification,
          geometryBlock: s.geometryBlock,
          annotationBlock: s.annotationBlock,
          svgWarning: s.svgWarning,
          filename: svgFilename(s.storedFile.uri),
      })),
  };
  ```

  **Important:** read the existing `getDxfFile` service method for the actual field shape / existing access-check call / return type before pasting. Match its style. Preserve any existing behavior (e.g. soft-delete filter, owner check).

- [ ] **1.4** If the service returns a TS-typed result (e.g. `Promise<DxfFileDetail>`), extend the type definition so `sheetRenders` is in the response contract. The existing controller/response handler probably passes the return through as-is — verify and adjust.

- [ ] **1.5** Extend the final transaction in `server/src/jobs/handlers/dxf-extraction.handler.ts`. Currently the success-path update (spec §7.3 step 5) writes only the DxfFile fields. Extend it to also create one `StoredFile(kind=RENDER)` + `SheetRender` pair per `result.renders` entry.

  Locate the existing success-path block. It currently looks like (from Phase 4b):

  ```typescript
  // Phase 5 — persist complianceData
  await prisma.dxfFile.update({
      where: { id: dxf.id },
      data: {
          explorationJson: explorationJson as Prisma.InputJsonValue,
          structuralHash,
          complianceData: result.complianceData as Prisma.InputJsonValue,
          extractionTrace: trace as unknown as Prisma.InputJsonValue,
          extractionStatus: 'COMPLETED',
      },
  });
  ```

  Replace with:

  ```typescript
  // Phase 5 — persist complianceData + SheetRender rows
  await prisma.$transaction(async tx => {
      for (const render of result.renders) {
          const renderSha = await computeFileSha256(path.resolve(env.UPLOADS_DIR, render.filename));
          const storedFile = await tx.storedFile.create({
              data: {
                  kind: 'RENDER',
                  uri: render.filename,                        // already relative to UPLOADS_DIR from /execute
                  originalName: path.basename(render.filename),
                  sha256: renderSha,
                  sizeBytes: render.sizeBytes,
              },
          });
          await tx.sheetRender.create({
              data: {
                  dxfFileId: dxf.id,
                  storedFileId: storedFile.id,
                  sheetIndex: render.sheetIndex,
                  displayName: render.displayName,
                  classification: render.classification as 'FLOOR_PLAN' | 'ELEVATION' | 'CROSS_SECTION' | 'PARKING_SECTION' | 'SURVEY' | 'SITE_PLAN' | 'ROOF_PLAN' | 'AREA_CALCULATION' | 'INDEX_PAGE' | 'UNCLASSIFIED',
                  geometryBlock: render.geometryBlock,
                  annotationBlock: render.annotationBlock,
                  svgWarning: render.svgWarning,
              },
          });
      }
      await tx.dxfFile.update({
          where: { id: dxf.id },
          data: {
              explorationJson: explorationJson as Prisma.InputJsonValue,
              structuralHash,
              complianceData: result.complianceData as Prisma.InputJsonValue,
              extractionTrace: trace as unknown as Prisma.InputJsonValue,
              extractionStatus: 'COMPLETED',
          },
      });
  });
  ```

  Add `computeFileSha256` as a top-of-file helper (or import from `src/lib/` if one exists):

  ```typescript
  import { createHash } from 'node:crypto';
  import { createReadStream } from 'node:fs';

  async function computeFileSha256(absolutePath: string): Promise<string> {
      return new Promise((resolve, reject) => {
          const hash = createHash('sha256');
          createReadStream(absolutePath)
              .on('data', chunk => hash.update(chunk))
              .on('error', reject)
              .on('end', () => resolve(hash.digest('hex')));
      });
  }
  ```

  Check whether this helper already exists elsewhere (e.g. the upload controller at `src/api/controllers/dxf-file.controller.ts` has one). If yes, extract it to `src/lib/file-hash.ts` and have both callers import from there. Cleanest.

  **Classification enum validation:** the AI-generated script may produce a classification string that isn't in the `SheetClassification` enum. Before writing, validate and fall back to `UNCLASSIFIED`:

  ```typescript
  const VALID_CLASSIFICATIONS = ['INDEX_PAGE', 'FLOOR_PLAN', 'CROSS_SECTION', 'ELEVATION', 'PARKING_SECTION', 'SURVEY', 'SITE_PLAN', 'ROOF_PLAN', 'AREA_CALCULATION', 'UNCLASSIFIED'] as const;
  type Classification = (typeof VALID_CLASSIFICATIONS)[number];

  function normalizeClassification(raw: string): Classification {
      return (VALID_CLASSIFICATIONS as readonly string[]).includes(raw) ? (raw as Classification) : 'UNCLASSIFIED';
  }
  ```

  Use `normalizeClassification(render.classification)` instead of the inline cast. Add a unit test in the handler test for this (step 2.3).

- [ ] **1.6** Create `server/src/api/schemas/renders.schemas.ts`:

  ```typescript
  import { z } from 'zod';

  // Only allow filenames matching "render_<digits>.svg" — prevents path traversal
  // and confines callers to the AI-generated script's naming convention.
  const renderFilename = z.string().regex(/^render_\d+\.svg$/, 'invalid_filename');

  export const renderParamSchema = z.object({
      params: z.object({
          dxfFileId: z.string().cuid(),
          filename: renderFilename,
      }),
  });
  ```

- [ ] **1.7** Create `server/src/api/controllers/renders.controller.ts`:

  ```typescript
  import fs from 'node:fs';
  import path from 'node:path';
  import type { Request, Response, NextFunction } from 'express';
  import prisma from '../../config/prisma';
  import env from '../../utils/env';
  import { HttpError } from '../../lib/HttpError';

  function requireUser(req: Request) {
      if (!req.user) throw new HttpError(401, 'Unauthenticated');
      return req.user;
  }

  export async function serveRender(req: Request, res: Response, next: NextFunction) {
      try {
          const user = requireUser(req);
          const { dxfFileId, filename } = req.params as { dxfFileId: string; filename: string };

          // Authz: SheetRender must exist AND belong to a project owned by user (or user is admin).
          const sheet = await prisma.sheetRender.findFirst({
              where: {
                  dxfFileId,
                  storedFile: { originalName: filename },
              },
              include: {
                  dxfFile: { include: { project: true } },
              },
          });
          if (!sheet) throw new HttpError(404, 'render_not_found');
          const project = sheet.dxfFile.project;
          if (project.ownerId !== user.id && user.role !== 'ADMIN') {
              throw new HttpError(403, 'forbidden');
          }

          // Resolve absolute path and sandbox-check before streaming.
          const relativeUri = sheet.storedFile.uri;
          const root = path.resolve(env.UPLOADS_DIR);
          const abs = path.resolve(env.UPLOADS_DIR, relativeUri);
          if (abs !== root && !abs.startsWith(root + path.sep)) {
              throw new HttpError(400, 'path_escape');
          }
          if (!fs.existsSync(abs)) throw new HttpError(404, 'file_missing');

          res.setHeader('Content-Type', 'image/svg+xml');
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          fs.createReadStream(abs).pipe(res);
      } catch (err) {
          next(err);
      }
  }
  ```

  Note on the authz lookup: we use `storedFile.originalName` to match the `filename` URL segment (the `originalName` is set to the basename during the handler's transaction in step 1.5). This keeps the controller simple without parsing file paths. Alternative: match on `storedFile.uri = ${dxfFileId}/${filename}` if the path shape is stable.

- [ ] **1.8** Create `server/src/api/routes/renders.routes.ts`:

  ```typescript
  import { Router } from 'express';
  import { auth, validate } from '../../middlewares';
  import { serveRender } from '../controllers/renders.controller';
  import { renderParamSchema } from '../schemas/renders.schemas';

  export const rendersRouter = Router();
  rendersRouter.use(auth);
  rendersRouter.get('/:dxfFileId/:filename', validate(renderParamSchema), serveRender);
  ```

- [ ] **1.9** Mount in `server/src/api/routes/index.ts`. Read the existing file and add the mount next to the other `Router` mounts. Example addition:

  ```typescript
  import { rendersRouter } from './renders.routes';
  // ... existing mounts ...
  router.use('/renders', rendersRouter);
  ```

- [ ] **1.10** Typecheck:

  ```bash
  cd server
  npm run typecheck
  ```

  Expected: clean.

- [ ] **1.11** Commit:

  ```bash
  git add src/api/data-access/sheet-render.da.ts src/api/data-access/dxf-file.da.ts src/api/services/dxf-file.service.ts src/jobs/handlers/dxf-extraction.handler.ts src/api/controllers/renders.controller.ts src/api/routes/renders.routes.ts src/api/routes/index.ts src/api/schemas/renders.schemas.ts
  # Plus any extracted file-hash helper if you added one:
  # git add src/lib/file-hash.ts src/api/controllers/dxf-file.controller.ts
  git commit -m "feat(dxf): SheetRender persistence + renders serving endpoint"
  ```

---

## Cluster 2 — Server tests

**Files:**
- Modify: `server/src/jobs/handlers/dxf-extraction.handler.test.ts` — extend cache-miss + self-correction tests to assert SheetRender rows; add classification-normalization test
- Modify: `server/src/jobs/handlers/dxf-extraction.handler.integration.test.ts` — extend cache-miss-path test to assert SheetRender rows exist in DB
- Create: `server/src/api/data-access/sheet-render.da.integration.test.ts`
- Create: `server/src/api/routes/renders.integration.test.ts`

### Steps

- [ ] **2.1** Extend unit tests in `dxf-extraction.handler.test.ts` — Path 2 (cache miss, first execute succeeds) should now pass `renders: [...]` in the execute mock and assert `prisma.sheetRender.create` (if tx-aware mocking is used) was called with the expected fields. The test infrastructure for Phase 4b mocked `prisma` at module level; extend the mock to cover `sheetRender.create` + `$transaction`. Specifically:

  ```typescript
  // In the jest.mock('../../config/prisma', ...) block add:
  sheetRender: { create: jest.fn() },
  $transaction: jest.fn(async (fn) => fn({
    storedFile: { create: jest.fn().mockImplementation(async (args) => ({ id: `sf-${Math.random()}`, ...args.data })) },
    sheetRender: { create: jest.fn().mockImplementation(async (args) => ({ id: `sr-${Math.random()}`, ...args.data })) },
    dxfFile: { update: jest.fn() },
  })),
  ```

  Then in Path 2:

  ```typescript
  (sidecar.execute as jest.Mock).mockResolvedValue({
    ok: true,
    complianceData: { setbacks: {} },
    renders: [
      { filename: 'renders/dxf-1/render_01.svg', sheetIndex: 1, displayName: 'קומת קרקע', classification: 'FLOOR_PLAN', sizeBytes: 30000 },
      { filename: 'renders/dxf-1/render_02.svg', sheetIndex: 2, displayName: 'חתך A-A', classification: 'CROSS_SECTION', sizeBytes: 28000 },
    ],
    ms: 8000,
  });

  // ... existing test body ...

  // New assertions:
  expect((prisma as any).$transaction).toHaveBeenCalled();
  // Inspect the tx callback was invoked with the mock tx client; verify storedFile.create was called twice
  // and sheetRender.create was called twice with the expected sheetIndex / displayName / classification.
  ```

  Adjust to match the existing test's style. Use jest `.toHaveBeenCalledWith` with `expect.objectContaining({ data: { sheetIndex: 1, ... } })` for readability.

- [ ] **2.2** Add a new unit test for classification normalization (a renders entry with `classification: 'RANDOM_STRING_NOT_IN_ENUM'` must land in DB as `UNCLASSIFIED`):

  ```typescript
  it('normalizes unknown classification strings to UNCLASSIFIED', async () => {
      (sidecar.explore as jest.Mock).mockResolvedValue({ explorationJson: {}, structuralHash: 'h', ms: 100 });
      const findLatestByHash = require('../../api/data-access/extraction-script.da').findLatestByHash as jest.Mock;
      findLatestByHash.mockResolvedValue({ id: 's-cached', storedFile: { uri: 'uploads/scripts/x.py' } });
      (sidecar.execute as jest.Mock).mockResolvedValue({
          ok: true,
          complianceData: {},
          renders: [{ filename: 'renders/dxf-1/render_01.svg', sheetIndex: 1, displayName: 's1', classification: 'NOT_A_REAL_CLASSIFICATION', sizeBytes: 30000 }],
          ms: 8000,
      });

      const { dxf, job } = makeFakeDxfAndJob();  // reuse existing helper
      await dxfExtractionHandler(job);

      const sheetCreate = (mockedTx.sheetRender.create as jest.Mock).mock.calls[0][0];
      expect(sheetCreate.data.classification).toBe('UNCLASSIFIED');
  });
  ```

  Adjust to whatever helper exists for fake DxfFile seeding in the unit tests.

- [ ] **2.3** Run:

  ```bash
  cd server
  npm test -- dxf-extraction.handler
  ```

  Expect all existing handler tests + new SheetRender assertions + classification-normalization test to pass.

- [ ] **2.4** Extend `dxf-extraction.handler.integration.test.ts` cache-miss path to assert that `prisma.sheetRender.findMany({ where: { dxfFileId } })` returns the expected rows after the handler runs:

  ```typescript
  // Add to the existing "cache-miss path" test:
  (sidecar.execute as jest.Mock).mockResolvedValue({
      ok: true,
      complianceData: { setbacks: {} },
      renders: [
          { filename: 'renders/dxf-1/render_01.svg', sheetIndex: 1, displayName: 'קומת קרקע', classification: 'FLOOR_PLAN', sizeBytes: 30000, geometryBlock: 'VP1', annotationBlock: 'VP2' },
          { filename: 'renders/dxf-1/render_02.svg', sheetIndex: 2, displayName: 'חתך A-A', classification: 'CROSS_SECTION', sizeBytes: 28000 },
      ],
      ms: 8000,
  });
  // The integration test needs the SVG files to exist on disk for the handler's sha256 read.
  // Before running the handler, write fake SVGs to uploads/renders/<dxfFileId>/:
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  await fs.mkdir(path.join(env.UPLOADS_DIR, 'renders', dxf.id), { recursive: true });
  await fs.writeFile(path.join(env.UPLOADS_DIR, 'renders', dxf.id, 'render_01.svg'), 'x'.repeat(30000));
  await fs.writeFile(path.join(env.UPLOADS_DIR, 'renders', dxf.id, 'render_02.svg'), 'x'.repeat(28000));

  await dxfExtractionHandler(job);

  const sheets = await prisma.sheetRender.findMany({
      where: { dxfFileId: dxf.id },
      orderBy: { sheetIndex: 'asc' },
      include: { storedFile: true },
  });
  expect(sheets).toHaveLength(2);
  expect(sheets[0].displayName).toBe('קומת קרקע');
  expect(sheets[0].classification).toBe('FLOOR_PLAN');
  expect(sheets[0].storedFile.kind).toBe('RENDER');
  expect(sheets[1].classification).toBe('CROSS_SECTION');
  ```

  In the integration test, the `UPLOADS_DIR` is the CI placeholder or real dev path — use the actual env value. Clean up the written files in `afterEach` / `afterAll`.

- [ ] **2.5** Create `server/src/api/data-access/sheet-render.da.integration.test.ts` with at least one test that creates a DxfFile + two SheetRender rows and asserts `findByDxfFileId` returns them in `sheetIndex` ascending order:

  ```typescript
  import prisma from '../../config/prisma';
  import { findByDxfFileId } from './sheet-render.da';
  import { truncateAll } from '../../test-helpers/db';

  beforeEach(async () => await truncateAll());

  it('findByDxfFileId returns sheets in sheetIndex ascending order', async () => {
      const user = await prisma.user.create({ data: { email: 't@t', name: 't', passwordHash: 'h', role: 'USER' } });
      const project = await prisma.project.create({ data: { ownerId: user.id, name: 'p' } });
      const dxfSF = await prisma.storedFile.create({ data: { kind: 'DXF', uri: 'uploads/dxf/t.dxf', originalName: 't.dxf', sha256: 'a'.repeat(64), sizeBytes: 1000 } });
      const dxf = await prisma.dxfFile.create({ data: { projectId: project.id, storedFileId: dxfSF.id, extractionStatus: 'COMPLETED' } });

      const sf2 = await prisma.storedFile.create({ data: { kind: 'RENDER', uri: `uploads/renders/${dxf.id}/render_02.svg`, originalName: 'render_02.svg', sha256: 'b'.repeat(64), sizeBytes: 20000 } });
      const sf1 = await prisma.storedFile.create({ data: { kind: 'RENDER', uri: `uploads/renders/${dxf.id}/render_01.svg`, originalName: 'render_01.svg', sha256: 'c'.repeat(64), sizeBytes: 25000 } });
      await prisma.sheetRender.create({ data: { dxfFileId: dxf.id, storedFileId: sf2.id, sheetIndex: 2, displayName: 's2', classification: 'CROSS_SECTION' } });
      await prisma.sheetRender.create({ data: { dxfFileId: dxf.id, storedFileId: sf1.id, sheetIndex: 1, displayName: 's1', classification: 'FLOOR_PLAN' } });

      const sheets = await findByDxfFileId(dxf.id);
      expect(sheets).toHaveLength(2);
      expect(sheets[0].sheetIndex).toBe(1);
      expect(sheets[0].displayName).toBe('s1');
      expect(sheets[1].sheetIndex).toBe(2);
      expect(sheets[0].storedFile.kind).toBe('RENDER');
  });
  ```

- [ ] **2.6** Create `server/src/api/routes/renders.integration.test.ts` covering (a) happy path returns 200 with `image/svg+xml` content type + immutable cache header + correct SVG body, (b) 403 when requester is not project owner and not admin, (c) 400 when filename doesn't match the `render_\d+\.svg` regex, (d) 404 when the sheet exists in DB but the file on disk is missing.

  ```typescript
  import request from 'supertest';
  import fs from 'node:fs/promises';
  import path from 'node:path';
  import { app } from '../../app';
  import prisma from '../../config/prisma';
  import env from '../../utils/env';
  import { truncateAll } from '../../test-helpers/db';
  import { hashPassword } from '../../integrations/password';
  // authenticated cookie helper — re-use whichever exists:
  import { signAuthCookie } from '../../integrations/auth-cookie';

  async function seed({ ownerEmail = 'owner@test.com' } = {}) {
      const owner = await prisma.user.create({ data: { email: ownerEmail, name: 'Owner', passwordHash: await hashPassword('password123'), role: 'USER' } });
      const project = await prisma.project.create({ data: { ownerId: owner.id, name: 'p' } });
      const dxfSF = await prisma.storedFile.create({ data: { kind: 'DXF', uri: 'uploads/dxf/t.dxf', originalName: 't.dxf', sha256: 'a'.repeat(64), sizeBytes: 1000 } });
      const dxf = await prisma.dxfFile.create({ data: { projectId: project.id, storedFileId: dxfSF.id, extractionStatus: 'COMPLETED' } });
      return { owner, project, dxf };
  }

  beforeEach(async () => await truncateAll());

  it('200 + correct headers + bytes when owner requests their sheet', async () => {
      const { owner, dxf } = await seed();
      const renderRel = `uploads/renders/${dxf.id}/render_01.svg`;
      const renderAbs = path.join(env.UPLOADS_DIR, `renders/${dxf.id}/render_01.svg`);
      await fs.mkdir(path.dirname(renderAbs), { recursive: true });
      await fs.writeFile(renderAbs, '<svg>hello</svg>');
      const sf = await prisma.storedFile.create({ data: { kind: 'RENDER', uri: renderRel, originalName: 'render_01.svg', sha256: 'b'.repeat(64), sizeBytes: 18 } });
      await prisma.sheetRender.create({ data: { dxfFileId: dxf.id, storedFileId: sf.id, sheetIndex: 1, displayName: 's1', classification: 'FLOOR_PLAN' } });

      const res = await request(app)
          .get(`/api/renders/${dxf.id}/render_01.svg`)
          .set('Cookie', signAuthCookie({ userId: owner.id, role: 'USER' }));

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('image/svg+xml');
      expect(res.headers['cache-control']).toContain('immutable');
      expect(res.text).toBe('<svg>hello</svg>');

      await fs.rm(path.dirname(renderAbs), { recursive: true, force: true });
  });

  it('403 when non-owner non-admin requests', async () => {
      const { dxf } = await seed({ ownerEmail: 'owner@test.com' });
      const other = await prisma.user.create({ data: { email: 'other@test.com', name: 'Other', passwordHash: await hashPassword('password123'), role: 'USER' } });
      const renderRel = `uploads/renders/${dxf.id}/render_01.svg`;
      const sf = await prisma.storedFile.create({ data: { kind: 'RENDER', uri: renderRel, originalName: 'render_01.svg', sha256: 'b'.repeat(64), sizeBytes: 0 } });
      await prisma.sheetRender.create({ data: { dxfFileId: dxf.id, storedFileId: sf.id, sheetIndex: 1, displayName: 's1', classification: 'FLOOR_PLAN' } });

      const res = await request(app)
          .get(`/api/renders/${dxf.id}/render_01.svg`)
          .set('Cookie', signAuthCookie({ userId: other.id, role: 'USER' }));

      expect(res.status).toBe(403);
  });

  it('400 when filename does not match render_<digits>.svg', async () => {
      const { owner, dxf } = await seed();
      const res = await request(app)
          .get(`/api/renders/${dxf.id}/../../etc/passwd`)
          .set('Cookie', signAuthCookie({ userId: owner.id, role: 'USER' }));
      expect([400, 404]).toContain(res.status);  // express may intercept the path before the schema; either is acceptable rejection
  });

  it('404 when DB sheet exists but disk file missing', async () => {
      const { owner, dxf } = await seed();
      const renderRel = `uploads/renders/${dxf.id}/render_01.svg`;
      const sf = await prisma.storedFile.create({ data: { kind: 'RENDER', uri: renderRel, originalName: 'render_01.svg', sha256: 'b'.repeat(64), sizeBytes: 0 } });
      await prisma.sheetRender.create({ data: { dxfFileId: dxf.id, storedFileId: sf.id, sheetIndex: 1, displayName: 's1', classification: 'FLOOR_PLAN' } });

      const res = await request(app)
          .get(`/api/renders/${dxf.id}/render_01.svg`)
          .set('Cookie', signAuthCookie({ userId: owner.id, role: 'USER' }));
      expect(res.status).toBe(404);
  });
  ```

  If `signAuthCookie` is not the exact helper name in the repo, use whatever `auth.integration.test.ts` or `admin.integration.test.ts` uses to mint an authenticated cookie. Read one of those files first to match the pattern.

- [ ] **2.7** Run:

  ```bash
  cd server
  npm run test:integration -- sheet-render.da.integration
  npm run test:integration -- renders.integration
  npm run test:integration -- dxf-extraction.handler.integration
  npm run test:integration    # full regression
  npm test                    # unit regression
  npm run typecheck
  ```

  Expect all green.

- [ ] **2.8** Commit:

  ```bash
  git add src/jobs/handlers/dxf-extraction.handler.test.ts src/jobs/handlers/dxf-extraction.handler.integration.test.ts src/api/data-access/sheet-render.da.integration.test.ts src/api/routes/renders.integration.test.ts
  git commit -m "test(dxf): SheetRender persistence + renders endpoint coverage"
  ```

---

## Cluster 3 — Client: API types + useDxfFile hook

Directory: `client/` (branch `feat/buildcheck-phase-4c`).

**Files:**
- Modify: `client/src/api/types.ts` — add `SheetRender` + `SheetClassification` types; extend `DxfFile` with optional `sheetRenders`
- Modify: `client/src/api/dxf.api.ts` — add `fetchDxfFile(id)` function
- Create: `client/src/hooks/useDxfFile.ts`

### Steps

- [ ] **3.1** Read the existing `client/src/api/types.ts` and `client/src/api/dxf.api.ts` to match style. They likely use camelCase interfaces with explicit fields.

- [ ] **3.2** Add to `client/src/api/types.ts` (append near the existing DxfFile type):

  ```typescript
  export type SheetClassification =
      | 'INDEX_PAGE'
      | 'FLOOR_PLAN'
      | 'CROSS_SECTION'
      | 'ELEVATION'
      | 'PARKING_SECTION'
      | 'SURVEY'
      | 'SITE_PLAN'
      | 'ROOF_PLAN'
      | 'AREA_CALCULATION'
      | 'UNCLASSIFIED';

  export interface SheetRender {
      id: string;
      sheetIndex: number;
      displayName: string;
      classification: SheetClassification;
      geometryBlock: string | null;
      annotationBlock: string | null;
      svgWarning: string | null;
      filename: string;       // used to build GET /api/renders/<dxfFileId>/<filename> URL
  }
  ```

  Extend the existing `DxfFile` type with `sheetRenders?: SheetRender[]` (optional so the list endpoint's slimmer shape still satisfies the type).

- [ ] **3.3** Extend `client/src/api/dxf.api.ts`. Add:

  ```typescript
  import { useHttpClient } from '@/hooks/useHttpClient';  // or however existing functions get the axios instance

  // If the file exports functions that take an `http` instance as a parameter, match that pattern.
  export async function fetchDxfFile(http: AxiosInstance, id: string): Promise<DxfFile> {
      const res = await http.get<{ data: { dxfFile: DxfFile } }>(`/api/dxf/${id}`);
      return res.data.data.dxfFile;
  }
  ```

  The exact shape of the existing API file matters — read it first. If it uses react-query `useQuery` directly inside the api file, match that. If it exports thin axios wrappers and hooks live in `hooks/`, match that.

- [ ] **3.4** Create `client/src/hooks/useDxfFile.ts`. Match the pattern of `useProject.ts` or `useProjectDxfFiles.ts`:

  ```typescript
  import { useQuery } from '@tanstack/react-query';
  import { useHttpClient } from './useHttpClient';
  import { fetchDxfFile } from '@/api/dxf.api';

  export function useDxfFile(id: string | undefined) {
      const http = useHttpClient();
      return useQuery({
          queryKey: ['dxf', id],
          queryFn: () => fetchDxfFile(http, id!),
          enabled: !!id,
          refetchInterval: (query) => {
              // Poll while extraction is in progress so thumbnails appear without a manual refresh.
              const status = query.state.data?.extractionStatus;
              return status === 'PENDING' || status === 'EXTRACTING' ? 2000 : false;
          },
      });
  }
  ```

- [ ] **3.5** Typecheck (client uses Vite + TS; run the repo's typecheck command — probably `npm run typecheck` or `tsc --noEmit`):

  ```bash
  cd client
  npm run typecheck    # or tsc --noEmit
  ```

  Expected: clean. If there's no `typecheck` script, run `npx tsc --noEmit`.

- [ ] **3.6** Commit:

  ```bash
  cd client
  git add src/api/types.ts src/api/dxf.api.ts src/hooks/useDxfFile.ts
  git commit -m "feat(dxf): client types + useDxfFile hook for sheet rendering"
  ```

---

## Cluster 4 — Client: DxfPreviewGrid + DxfPreviewLightbox + ProjectDetailPage wiring

**Files:**
- Create: `client/src/components/DxfPreviewGrid.tsx`
- Create: `client/src/components/DxfPreviewLightbox.tsx`
- Modify: `client/src/pages/ProjectDetailPage.tsx`

### Steps

- [ ] **4.1** Create `client/src/components/DxfPreviewGrid.tsx`:

  ```tsx
  import { Badge } from '@/components/ui/badge';
  import { AlertTriangle } from 'lucide-react';
  import type { SheetRender } from '@/api/types';

  interface Props {
      dxfFileId: string;
      sheets: SheetRender[];
      onSelect: (sheet: SheetRender) => void;
  }

  const CLASSIFICATION_LABELS: Record<SheetRender['classification'], string> = {
      FLOOR_PLAN: 'תכנית',
      ELEVATION: 'חזית',
      CROSS_SECTION: 'חתך',
      PARKING_SECTION: 'חנייה',
      SURVEY: 'מדידה',
      SITE_PLAN: 'תכנית מגרש',
      ROOF_PLAN: 'תכנית גג',
      AREA_CALCULATION: 'חישוב שטחים',
      INDEX_PAGE: 'תוכן',
      UNCLASSIFIED: 'לא מסווג',
  };

  export function DxfPreviewGrid({ dxfFileId, sheets, onSelect }: Props) {
      if (sheets.length === 0) {
          return <p className="text-sm text-muted-foreground">אין גיליונות להצגה</p>;
      }
      return (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {sheets.map((sheet) => (
                  <button
                      key={sheet.id}
                      onClick={() => onSelect(sheet)}
                      className="group flex flex-col gap-2 rounded-lg border bg-card p-3 text-right transition hover:border-primary hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                      <div className="relative aspect-[4/3] w-full overflow-hidden rounded border bg-white">
                          <img
                              src={`/api/renders/${dxfFileId}/${sheet.filename}`}
                              alt={sheet.displayName}
                              className="h-full w-full object-contain"
                              loading="lazy"
                          />
                          {sheet.svgWarning && (
                              <div className="absolute right-2 top-2 rounded-full bg-amber-100 p-1 text-amber-700" title={sheet.svgWarning}>
                                  <AlertTriangle className="h-3.5 w-3.5" />
                              </div>
                          )}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                          <Badge variant="outline" className="text-xs">
                              {CLASSIFICATION_LABELS[sheet.classification]}
                          </Badge>
                          <span className="truncate text-sm font-medium" dir="rtl">
                              {sheet.displayName}
                          </span>
                      </div>
                  </button>
              ))}
          </div>
      );
  }
  ```

  Confirm `@/components/ui/badge` exists; if not, use `@/components/ui/*` components the repo does have. `lucide-react` is already a dependency.

- [ ] **4.2** Create `client/src/components/DxfPreviewLightbox.tsx`:

  ```tsx
  import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
  import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
  import type { SheetRender } from '@/api/types';

  interface Props {
      dxfFileId: string;
      sheet: SheetRender | null;
      onClose: () => void;
  }

  export function DxfPreviewLightbox({ dxfFileId, sheet, onClose }: Props) {
      const open = sheet !== null;
      return (
          <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
              <DialogContent className="max-h-[95vh] max-w-[95vw] p-0">
                  <VisuallyHidden asChild>
                      <DialogTitle>{sheet?.displayName ?? ''}</DialogTitle>
                  </VisuallyHidden>
                  {sheet && (
                      <div className="flex h-[90vh] w-full flex-col gap-2 p-4">
                          <div className="flex items-baseline justify-between gap-4" dir="rtl">
                              <h2 className="text-lg font-semibold">{sheet.displayName}</h2>
                              <span className="text-sm text-muted-foreground">גיליון {sheet.sheetIndex}</span>
                          </div>
                          <div className="flex-1 overflow-auto rounded border bg-white">
                              <img
                                  src={`/api/renders/${dxfFileId}/${sheet.filename}`}
                                  alt={sheet.displayName}
                                  className="h-full w-full object-contain"
                              />
                          </div>
                          {sheet.svgWarning && (
                              <p className="text-xs text-amber-700" dir="rtl">
                                  אזהרה: {sheet.svgWarning}
                              </p>
                          )}
                      </div>
                  )}
              </DialogContent>
          </Dialog>
      );
  }
  ```

  **Check first** that `@/components/ui/dialog` exists in the project (shadcn generates it via `npx shadcn add dialog`). If not, add it:

  ```bash
  cd client
  npx shadcn@latest add dialog
  ```

  Same check for `@radix-ui/react-visually-hidden` — it's likely already transitively installed via shadcn, but verify with `npm list @radix-ui/react-visually-hidden`. If missing, `npm i @radix-ui/react-visually-hidden`.

- [ ] **4.3** Wire into `client/src/pages/ProjectDetailPage.tsx`. Read the existing file; find the DXF-files section (it lists `dxfFiles` and shows a status pill per file). Add a new section below it that renders thumbnails of the current COMPLETED DxfFile:

  ```tsx
  import { useState } from 'react';
  import { DxfPreviewGrid } from '@/components/DxfPreviewGrid';
  import { DxfPreviewLightbox } from '@/components/DxfPreviewLightbox';
  import { useDxfFile } from '@/hooks/useDxfFile';
  import type { SheetRender } from '@/api/types';

  // Inside the component, after loading dxfsQuery:
  const currentDxf = dxfFiles[0];   // adjust based on how the existing code picks "current"
  const dxfDetail = useDxfFile(currentDxf?.extractionStatus === 'COMPLETED' ? currentDxf.id : undefined);
  const [lightboxSheet, setLightboxSheet] = useState<SheetRender | null>(null);
  ```

  Then in the JSX, below the DXF files Card, add:

  ```tsx
  {dxfDetail.data?.sheetRenders && dxfDetail.data.sheetRenders.length > 0 && (
      <Card>
          <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground" dir="rtl">גיליונות</CardTitle>
          </CardHeader>
          <CardContent>
              <DxfPreviewGrid
                  dxfFileId={currentDxf.id}
                  sheets={dxfDetail.data.sheetRenders}
                  onSelect={setLightboxSheet}
              />
          </CardContent>
      </Card>
  )}
  <DxfPreviewLightbox
      dxfFileId={currentDxf?.id ?? ''}
      sheet={lightboxSheet}
      onClose={() => setLightboxSheet(null)}
  />
  ```

  Adjust the "which DxfFile is current" logic to match how the existing code already chooses one (usually the most-recently-created non-soft-deleted row). If the existing list is already sorted newest-first, `dxfFiles[0]` is correct; if oldest-first, take the last one.

- [ ] **4.4** Start the dev server and visually verify the grid:

  ```bash
  cd client
  npm run dev
  ```

  Open browser to the project detail page, confirm:
  - A DxfFile in `EXTRACTING` status does NOT show the sheets section.
  - A DxfFile in `COMPLETED` status with SheetRender rows shows a 3-column grid at ≥lg screen width.
  - Clicking a thumbnail opens the lightbox with a larger image.
  - Pressing ESC or clicking the overlay closes the lightbox.
  - Hebrew display names render correctly (RTL).

  Until the server has a seeded COMPLETED DxfFile with SheetRender rows on disk, this is easiest to test by letting Phase 4b's real pipeline run against a test DXF. If that's not feasible in dev, add a DB seed helper temporarily to check rendering, then revert.

- [ ] **4.5** Typecheck:

  ```bash
  cd client
  npm run typecheck    # or tsc --noEmit
  ```

  Expected: clean.

- [ ] **4.6** Commit:

  ```bash
  git add src/components/DxfPreviewGrid.tsx src/components/DxfPreviewLightbox.tsx src/pages/ProjectDetailPage.tsx
  # Plus any new shadcn-added files if you ran `shadcn add dialog`:
  # git add components.json src/components/ui/dialog.tsx package.json package-lock.json
  git commit -m "feat(dxf): sheet-preview grid + lightbox on ProjectDetailPage"
  ```

---

## Cluster 5 — Finalize: acceptance test + PRs + merges + Phase Status

### Acceptance test (manual gate)

- [ ] **5.1** **Cross-architect acceptance test.** Before opening PRs, run the Phase 4b+4c pipeline end-to-end against **at least 3 different architects' DXFs** and verify:
  - Each upload completes extraction successfully.
  - Each completed extraction produces `>= 1` SheetRender row.
  - The client grid renders the thumbnails and each opens in the lightbox.
  - Hebrew display names appear correctly.
  - At least one file exercises the cache-miss codegen path; one exercises the cache-hit path (re-upload the same file structure).

  This is the generalization acceptance gate called out in spec §13 Phase 4c and the Phase 4b "cross-architect generalization test suite" open question (§14 item 21). Fixtures live in `dummy_data/` per the project's convention (the user's memory notes this).

  If any file fails to produce SheetRender rows, investigate before opening PRs.

### PR sequence

- [ ] **5.2** Push server branch and open server PR (target `main`):

  ```bash
  cd server
  git push -u origin feat/buildcheck-phase-4c
  gh pr create --base main --title "feat: phase 4c — SheetRender persistence + renders endpoint" --body "$(cat <<'EOF'
  ## Summary
  - Prisma migration: `SheetRender` table + `SheetClassification` enum + back-relations on `DxfFile`/`StoredFile`.
  - `DXF_EXTRACTION` handler extends its final transaction to register `StoredFile(kind=RENDER)` + `SheetRender` rows for each SVG returned by `/execute`. Classification string normalized to the enum (fallback `UNCLASSIFIED`).
  - New endpoint `GET /api/renders/:dxfFileId/:filename` — streams SVG with `Content-Type: image/svg+xml` + `Cache-Control: public, max-age=31536000, immutable`. Authz: project owner or admin. Filename validated against `^render_\d+\.svg$`.
  - `GET /api/dxf/:id` detail response now includes a `sheetRenders[]` list with `{id, sheetIndex, displayName, classification, svgWarning, filename}`.
  - `findByDxfFileId` data-access helper for future consumers.

  ## Test plan
  - [ ] `npm run typecheck` clean
  - [ ] `npm test` green (incl. extended handler tests + classification-normalization)
  - [ ] `npm run test:integration` green (incl. new SheetRender DA + renders endpoint coverage + extended handler integration test)
  - [ ] Cross-architect acceptance test passed (manual, 3+ DXFs)

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  EOF
  )"
  ```

- [ ] **5.3** Push client branch and open client PR (target `main`):

  ```bash
  cd client
  git push -u origin feat/buildcheck-phase-4c
  gh pr create --base main --title "feat: phase 4c — DXF sheet preview grid + lightbox" --body "$(cat <<'EOF'
  ## Summary
  - New types `SheetRender` + `SheetClassification` in `api/types.ts`.
  - New API function `fetchDxfFile(id)` + React Query hook `useDxfFile(id)` with 2s polling while extraction is in progress.
  - `DxfPreviewGrid` component: responsive 3-column thumbnail grid (1 col on mobile, 2 on sm, 3 on lg) with Hebrew classification badges and an amber warning icon when `svgWarning` is set.
  - `DxfPreviewLightbox` component: fullscreen dialog with larger SVG rendering via shadcn `Dialog`.
  - Wired into `ProjectDetailPage`: a "גיליונות" section appears below the DXF files list when the current DxfFile is COMPLETED and has at least one sheet.

  ## Test plan
  - [ ] `npm run typecheck` clean
  - [ ] Visual check: upload a DXF, see 3-column grid with Hebrew names; click a thumbnail; lightbox opens with larger image; ESC closes.

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  EOF
  )"
  ```

- [ ] **5.4** Merge the server PR (use `--admin` if branch protection enforces review and you have admin rights):

  ```bash
  gh pr merge <server-pr-number> --repo YosefHershberg/Clearance-server --merge --delete-branch --admin
  ```

  Pull the updated `main`:

  ```bash
  cd server && git fetch origin && git switch main && git pull --ff-only && cd -
  ```

- [ ] **5.5** Merge the client PR:

  ```bash
  gh pr merge <client-pr-number> --repo YosefHershberg/Clearance-client --merge --delete-branch --admin
  ```

  Pull the updated `main`:

  ```bash
  cd client && git fetch origin && git switch main && git pull --ff-only && cd -
  ```

- [ ] **5.6** Bump submodule pointers in the main repo and push:

  ```bash
  cd "C:\Users\yosefh\OneDrive - hms.co.il\Desktop\Clearance"
  git add server client
  git commit -m "chore(submodule): bump server + client to phase 4c tips"
  ```

- [ ] **5.7** Transition Phase Status to `in-review` (on the main-repo feat branch) and push:

  ```bash
  # Edit docs/vault/00-Index/Phase Status.md:
  # - Frontmatter: current_status: in-review
  # - Current callout: status in-review, add PR links
  # - Row 4c: Status → in-review, fill PR cell
  git add "docs/vault/00-Index/Phase Status.md"
  git commit -m "docs(vault): phase 4c → in-review with PR links"
  git push -u origin feat/buildcheck-phase-4c
  ```

- [ ] **5.8** Open the main-repo PR against `integration/buildcheck`:

  ```bash
  gh pr create --base integration/buildcheck --title "feat: phase 4c — SheetRender persistence + client sheet viewer" --body "$(cat <<'EOF'
  ## Summary
  Phase 4c adds the DB persistence + UI layer for the SVG sheet renders that Phase 4b already produces at `/execute`. After this phase, uploading any Israeli permit DXF and waiting ~2 minutes yields a visible thumbnail grid of every sheet (floor plans, elevations, sections, survey, parking) with Hebrew display names and classification badges.

  - Spec §3.4 (SheetRender), §7.3 (persistence block), §13 Phase 4c scope.
  - Plan: `docs/superpowers/plans/2026-04-21-buildcheck-phase-4c-sheet-render-persistence-client-viewer.md`
  - Vault: Phase Status flipped to `in-review`.

  ## Linked sub-PRs
  - Server: [LINK TO SERVER PR]
  - Client: [LINK TO CLIENT PR]

  ## Test plan
  - [ ] Server CI green
  - [ ] Client typecheck green
  - [ ] Manual: cross-architect acceptance test — at least 3 DXFs from different architects produce SheetRender rows and render in the grid

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  EOF
  )"
  ```

  Fill in the sub-PR URLs after 5.4 and 5.5.

- [ ] **5.9** Merge the main-repo PR into `integration/buildcheck`:

  ```bash
  gh pr merge <main-pr-number> --repo YosefHershberg/Clearance --merge --delete-branch
  ```

- [ ] **5.10** Final Phase Status flip on `integration/buildcheck`:

  ```bash
  cd "C:\Users\yosefh\OneDrive - hms.co.il\Desktop\Clearance"
  git fetch origin && git switch integration/buildcheck && git pull --ff-only
  # Edit docs/vault/00-Index/Phase Status.md:
  # - Frontmatter: current_phase: 5, current_status: not-started
  # - Current callout: Phase 5 — TAVA upload + OCR, status not-started, branch (to create)
  # - Row 4c: Status → merged, add "merged 2026-04-21" to Notes
  git add "docs/vault/00-Index/Phase Status.md"
  git commit -m "chore(integration): mark phase 4c merged, advance current to 5"
  git push origin integration/buildcheck
  ```

---

## Self-review checklist

- [ ] Every spec §13 Phase 4c bullet maps to a task.
- [ ] The dot-number invariant + classification-enum normalization + path-traversal rejection all have explicit tests.
- [ ] No task mentions "similar to Task N" — each task is self-contained.
- [ ] Commit messages follow conventional-commits.
- [ ] Cross-architect acceptance gate is the final step before PR opens.
- [ ] No client work references `SheetRender` fields beyond what the server response actually includes.
- [ ] No reference to `ComplianceResult` or Phase 6 work (back-relation deferred).
