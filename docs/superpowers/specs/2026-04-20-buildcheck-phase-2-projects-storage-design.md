# BuildCheck — Phase 2 — Projects + Storage Design

**Date:** 2026-04-20
**Status:** Approved for implementation planning
**Phase:** 2 (server + client)
**Parent spec:** [2026-04-19-buildcheck-full-redesign.md](./2026-04-19-buildcheck-full-redesign.md) §2.7, §3.2, §3.3, §13
**Depends on:** Phase 1a (merged; auth + admin routes live), Phase 1b (in-review; client auth UI)

Introduces the `Project` model, the `StoredFile` metadata-on-disk-bytes pattern, project CRUD endpoints, and the client project list + detail pages. No file uploads yet (phase 4a adds DXF upload).

---

## 1. Scope

**In scope**
- Prisma migration: `Project` + `StoredFile` + `FileKind` + `FileStore`; `projects` back-relation on `User`.
- `integrations/storage.client.ts` — local-disk abstraction (`writeStream`, `readStream`, `delete`, `exists`) over `uploads/` subtrees keyed by `FileKind`.
- `POST/GET/PATCH/DELETE /api/projects(/:id)` — owner-scoped CRUD; admin can list all via `?all=true`.
- Schemas (Zod), controllers, services, data-access, routes; audit-log events for create/update/delete.
- Tests: unit (service) + integration (HTTP).
- Client: `HomePage` becomes project card grid + "Create project" dialog; `/projects/:id` detail page (placeholder for phase 4a file upload).
- Env: add `UPLOADS_DIR` (default `uploads`). `uploads/` auto-created at boot, gitignored, never committed.

**Out of scope (deferred)**
- File upload flows (DXF/TAVA/ADDON → phase 4a / 5 / 7)
- Project restoration UI (soft-delete vanishes; no un-delete in v1)
- Locality picker / geocoding (free-text for now)
- Project sharing / collaborators (single-owner only in v1)
- Admin `?all=true` UI toggle for non-admins (it's silently ignored server-side)

**Green bar**
- Server: `npm run typecheck` + `npm test` + `npm run test:integration` exit 0
- Client: `npm run typecheck` + `npm run build` + `npm run lint` exit 0
- Manual smoke (Chrome): create project → appears on HomePage → detail page loads → delete → vanishes → admin toggles `?all=true` to see another owner's project

---

## 2. Server — data model

Added to `server/prisma/schema.prisma`:

```prisma
enum FileKind   { DXF TAVA ADDON RENDER EXTRACTION_SCRIPT }
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

model Project {
  id          String    @id @default(cuid())
  ownerId     String
  owner       User      @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  name        String
  description String?
  locality    String?
  deletedAt   DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@index([ownerId, createdAt])
  @@index([deletedAt])
}
```

`User` gets `projects Project[]` back-relation.

**Intentional omission:** `StoredFile` back-relations to `DxfFile`, `TavaFile`, `AddonDocument`, `SheetRender`, `ExtractionScript` are not in this migration. They're added when each owning model lands (4a, 5, 7, 4c, 4b). Prisma accepts this — back-relations can be added later without schema break.

**Migration command:** `npx prisma migrate dev --name phase_2_projects_and_storage`. Produces one file under `prisma/migrations/<ts>_phase_2_projects_and_storage/migration.sql`.

---

## 3. Server — storage client

```ts
// server/src/integrations/storage.client.ts
export interface StorageClient {
  writeStream(kind: FileKind, filename: string): WriteStream;      // returns a writable stream
  readStream(uri: string): ReadStream;                             // for GET /files
  delete(uri: string): Promise<void>;
  exists(uri: string): Promise<boolean>;
  resolveUri(kind: FileKind, filename: string): string;            // "uploads/<kind-dir>/<filename>"
}
```

Single `LocalStorageClient` implementation for v1; S3 later via same interface.

**Layout on disk:**
```
uploads/
  dxf/
  tava/
  addon/
  renders/
  scripts/
```

Directories auto-created at boot in `bootstrap/ensure-uploads.ts` (called from `src/index.ts` before the Express listen). Missing dirs are created recursively; idempotent.

**Env:**
- `UPLOADS_DIR` (default `"uploads"`) — relative or absolute. Validated in `src/utils/env.ts` as a string.
- `.gitignore` (server) gains `/uploads/`.

Phase 2 does **not** expose any upload endpoints; `storage.client.ts` is scaffolded so phase 4a can drop in without restructuring.

---

## 4. Server — project CRUD endpoints

All under `/api/projects`, require `auth`. Follow the Phase 1a pattern: `validate()` middleware with Zod, controller → service → data-access, `{ data }`/`{ error }` response shape.

### 4.1 Endpoints

| Method | Path | Body | Auth | Success |
|---|---|---|---|---|
| POST | `/api/projects` | `{ name, description?, locality? }` | authed | `201 { data: { project } }` |
| GET | `/api/projects` | — (query: `q?`, `limit?`, `cursor?`, `all?`) | authed | `{ data: { projects, nextCursor? } }` |
| GET | `/api/projects/:id` | — | authed + (owner OR admin) | `{ data: { project } }` |
| PATCH | `/api/projects/:id` | `{ name?, description?, locality? }` | authed + (owner OR admin) | `{ data: { project } }` |
| DELETE | `/api/projects/:id` | — | authed + (owner OR admin) | `{ data: { ok: true } }` (soft-delete) |

`project` shape in responses: `{ id, ownerId, name, description, locality, createdAt, updatedAt }` (no `deletedAt` — soft-deleted projects return 404).

### 4.2 Visibility rule — list

- Default: `ownerId = req.user.id AND deletedAt IS NULL`, ordered by `createdAt DESC`, cursor-paginated.
- `?all=true` **and** `req.user.role === 'ADMIN'`: all non-deleted projects (any owner). Response includes owner id/email/name via a join.
- Non-admin with `?all=true`: silently ignored (no 403 noise), returns owner-scoped list.
- `q`: case-insensitive substring on `name` (Postgres `ILIKE`).
- Pagination: cursor = last seen `id`; `limit` default 20, max 100.

### 4.3 Access rules — detail / update / delete

`ensureProjectAccess(project, user)` helper returns the project or throws:
- 404 if not found OR `deletedAt != null` (never distinguish — avoid leaking existence)
- 403 if `project.ownerId !== user.id && user.role !== 'ADMIN'`
- otherwise, returns the project

Used by all three of `getProject`, `patchProject`, `deleteProject`.

### 4.4 Audit log

Every mutation writes one `AuditLog` entry via the existing `audit-log.service`:
- `project.created` — entity=Project, entityId=project.id
- `project.updated` — entity=Project, entityId=project.id, metadata `{ fields: [...changed] }`
- `project.deleted` — entity=Project, entityId=project.id

### 4.5 Files

```
server/src/
  api/
    routes/projects.routes.ts
    controllers/projects.controller.ts
    services/projects.service.ts
    services/projects.service.test.ts
    data-access/projects.da.ts
    schemas/projects.schemas.ts
    schemas/stored-file.schemas.ts         # reserved for phase 4a; empty in phase 2
  integrations/
    storage.client.ts
  bootstrap/
    ensure-uploads.ts                      # called from src/index.ts
  utils/
    env.ts                                 # + UPLOADS_DIR
tests/integration/
  projects.integration.test.ts
```

Wire the new router into `src/api/index.ts` (the existing router mounter from phase 1a).

---

## 5. Server — tests

**Unit (service)** covers:
- `createProject` sets ownerId, trims name, rejects empty name
- `listUserProjects` excludes soft-deleted
- `listAllProjects` admin path returns cross-owner rows
- `patchProject` rejects empty updates, writes audit entry with changed fields
- `softDeleteProject` sets `deletedAt`, writes audit

**Integration** covers the HTTP boundary end-to-end against a real test DB:
- POST create → 201 + list contains it
- GET list → only authenticated user's rows
- GET list `?all=true` as USER → ignored, owner-scoped
- GET list `?all=true` as ADMIN → cross-owner visible
- GET detail cross-owner as USER → 403
- GET detail cross-owner as ADMIN → 200
- PATCH updates + audit
- DELETE soft-deletes (404 on subsequent GET) + audit
- Deleting as cross-owner USER → 403; as ADMIN → 200
- Validation: empty name → 400 with Zod message

Reuses the phase 1a test harness (supertest + Prisma with `DATABASE_URL` pointed at a dedicated test DB).

---

## 6. Client

### 6.1 Files

```
client/src/
  api/
    projects.api.ts                        # list, get, create, update, delete
    types.ts                               # + Project, ProjectListResponse
  hooks/
    useProjects.ts                         # useQuery wrapper (list)
    useProject.ts                          # useQuery wrapper (detail by id)
  pages/
    HomePage.tsx                           # REPLACED — project list + create dialog
    ProjectDetailPage.tsx                  # NEW — /projects/:id
    projects/
      CreateProjectDialog.tsx
      DeleteProjectConfirm.tsx
      ProjectCard.tsx                      # shadcn Card showing project summary
  routes.tsx                               # + /projects/:id
```

### 6.2 HomePage

Header: "My projects" + "Create project" button (admin-only "Show all" toggle to the right of the title, flips the query's `all=true`).
Grid: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4`.
Each `ProjectCard` shows name, locality if set, description (truncated 2 lines), owner email (only when `?all=true`), "Opened X days ago", and a `…` dropdown with "Delete".

Empty state: centered copy "No projects yet — create your first" + inline CTA button.

### 6.3 CreateProjectDialog

RHF + zod (`name: z.string().min(1).max(120)`, `description?: z.string().max(2000)`, `locality?: z.string().max(120)`).
Submit via `useHttpClient({ fn: createProject })`. On success: invalidate `['projects']`, navigate to `/projects/<newId>`.

### 6.4 DeleteProjectConfirm

AlertDialog with an email-equivalent gate: the user types the project's *name* to confirm deletion (matches the admin-user-delete UX). On success: invalidate `['projects']`, navigate to `/` if currently on the detail page.

### 6.5 ProjectDetailPage

Loads via `useProject(id)`. Shows name, description, locality, created/updated timestamps, owner (if admin viewing another's project). Placeholder card: "Files arrive in phase 4a." Action bar: "Edit" (opens edit dialog — reuse CreateProjectDialog in edit mode) + "Delete" (opens DeleteProjectConfirm).

404 from the API → redirect to `/` with a toast "Project not found".

---

## 7. Process / branching

- Branches already cut:
  - Main repo: `feat/buildcheck-phase-2` off `feat/buildcheck-phase-1b` (carries phase 1b work forward since phase 1b is still in-review).
  - Client submodule: `feat/buildcheck-phase-2` off client `feat/buildcheck-phase-1b`.
  - Server submodule: `feat/buildcheck-phase-2` off server `integration/buildcheck`.
- Each submodule phase 2 PR targets its own integration line when its phase 1 PR merges. Until then, the main repo's phase-2 PR stacks on top of phase-1b.

**Phase Status transitions handled at PR open time (current → in-progress now, in-review when PR opens).**

---

## 8. Risks & non-goals

- **Stacked-PR coupling.** Phase 2 builds on phase 1b's client auth UI. If reviewers change phase 1b's public API (`useAuth`, `useHttpClient`, `api.ts`), phase 2 rebases. Likely small; isolated to imports.
- **Test DB isolation.** Integration tests require a `DATABASE_URL` distinct from dev. Reuses phase 1a harness, but if developer env skips `npm run db:push` against the test DB before running integration tests, failures are environmental. Document in the plan.
- **Admin content access.** Admin seeing all projects crosses a privacy line that isn't obvious from "admin permissions" alone. Auditable (audit-log on every read *is not* planned — only mutations — so admin browsing isn't tracked). Accepted: admin trust model.
- **No restore.** Soft-deleted projects cannot be un-deleted via the UI in v1. Restore is a follow-up if needed.
