# Phase 2 — Projects + Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the `Project` entity + local-disk storage abstraction. Server exposes project CRUD (owner-scoped + admin-all); client replaces the HomePage placeholder with a project grid + detail page.

**Architecture:** Layered (controller → service → `*.da.ts`) on the server per phase 1a; the client picks up from phase 1b's AuthContext + React Query + shadcn stack. Storage is a thin `StorageClient` interface with a `LocalStorageClient` implementation; S3 slots in later without controller changes.

**Tech adds:** none (Prisma, Zod, supertest, React Query, RHF already present).

**Design spec:** [2026-04-20-buildcheck-phase-2-projects-storage-design.md](../specs/2026-04-20-buildcheck-phase-2-projects-storage-design.md)

---

## Dependency clusters

```
Cluster 0 (sequential): env + schema + migration
  └─> Cluster 1 (parallel on server): schemas, storage client, DA, service, controller, routes
          └─> Cluster 2 (sequential): wire router + bootstrap dirs
                  └─> Cluster 3 (sequential): unit tests
                          └─> Cluster 4 (sequential): integration tests + server smoke
                                  └─> Cluster 5 (parallel on client): api/hooks/pages/dialogs
                                          └─> Cluster 6 (sequential): routes wire-up + e2e smoke
                                                  └─> Cluster 7 (sequential): submodule bumps + PRs
```

Agents in the same parallel cluster touch disjoint files. Orchestrator commits at cluster boundaries.

---

## Preflight (branches already cut)

- Main repo: `feat/buildcheck-phase-2` off `feat/buildcheck-phase-1b`
- Client: `feat/buildcheck-phase-2` off client `feat/buildcheck-phase-1b`
- Server: `feat/buildcheck-phase-2` off server `integration/buildcheck`

CWD: `C:/Users/yosefh/OneDrive - hms.co.il/Desktop/Clearance`.

---

## Task 1 — Server env + schema + migration

**Files (server):**
- Modify: `prisma/schema.prisma`
- Modify: `src/utils/env.ts`
- Create: `prisma/migrations/<ts>_phase_2_projects_and_storage/migration.sql` (generated)
- Modify: `.gitignore` (add `/uploads/`)

- [ ] **1.1** Add to `prisma/schema.prisma`:

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

On the existing `User` model, add: `projects Project[]`.

- [ ] **1.2** Update `src/utils/env.ts` — add `UPLOADS_DIR: z.string().default('uploads')` to the Zod env schema. Export as part of the env object.

- [ ] **1.3** Append `/uploads/` to `server/.gitignore`.

- [ ] **1.4** Generate migration:

```bash
cd "C:/Users/yosefh/OneDrive - hms.co.il/Desktop/Clearance/server"
npx prisma migrate dev --name phase_2_projects_and_storage
```

Expected: new migration folder under `prisma/migrations/` with `migration.sql` creating the two tables + enums + two indexes on Project + one on StoredFile. Prisma client regenerates.

- [ ] **1.5** Typecheck + commit:

```bash
npm run typecheck
git add prisma/schema.prisma prisma/migrations src/utils/env.ts .gitignore
git commit -m "feat(db): phase 2 — Project + StoredFile models + migration"
```

---

## Cluster 1 — Server scaffolding (parallel on server)

### Task 2 — Storage client + bootstrap

**Files (server, create):**
- `src/integrations/storage.client.ts`
- `src/bootstrap/ensure-uploads.ts`

- [ ] **2.1** `src/integrations/storage.client.ts`

```ts
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { FileKind } from '../generated/prisma';
import env from '../utils/env';

const KIND_DIRS: Record<FileKind, string> = {
  DXF: 'dxf',
  TAVA: 'tava',
  ADDON: 'addon',
  RENDER: 'renders',
  EXTRACTION_SCRIPT: 'scripts',
};

export interface StorageClient {
  writeStream(kind: FileKind, filename: string): NodeJS.WritableStream;
  readStream(uri: string): NodeJS.ReadableStream;
  delete(uri: string): Promise<void>;
  exists(uri: string): Promise<boolean>;
  resolveUri(kind: FileKind, filename: string): string;
}

class LocalStorageClient implements StorageClient {
  private root = path.resolve(env.UPLOADS_DIR);

  private absolute(uri: string): string {
    return path.isAbsolute(uri) ? uri : path.resolve(uri);
  }

  resolveUri(kind: FileKind, filename: string): string {
    return path.join(env.UPLOADS_DIR, KIND_DIRS[kind], filename).replace(/\\/g, '/');
  }

  writeStream(kind: FileKind, filename: string): NodeJS.WritableStream {
    const abs = path.join(this.root, KIND_DIRS[kind], filename);
    return createWriteStream(abs);
  }

  readStream(uri: string): NodeJS.ReadableStream {
    return createReadStream(this.absolute(uri));
  }

  async delete(uri: string): Promise<void> {
    await unlink(this.absolute(uri));
  }

  async exists(uri: string): Promise<boolean> {
    try {
      await stat(this.absolute(uri));
      return true;
    } catch {
      return false;
    }
  }
}

export const storage: StorageClient = new LocalStorageClient();

export async function ensureStorageDirs(): Promise<void> {
  const root = path.resolve(env.UPLOADS_DIR);
  for (const sub of Object.values(KIND_DIRS)) {
    await mkdir(path.join(root, sub), { recursive: true });
  }
}
```

- [ ] **2.2** `src/bootstrap/ensure-uploads.ts`

```ts
import logger from '../config/logger';
import { ensureStorageDirs } from '../integrations/storage.client';

export async function ensureUploads(): Promise<void> {
  await ensureStorageDirs();
  logger.info({ event: 'uploads.ready' }, 'Uploads directory tree ensured');
}
```

### Task 3 — Zod schemas

**File (create):** `src/api/schemas/projects.schemas.ts`

```ts
import { z } from 'zod';

const nameMax = 120;
const descriptionMax = 2000;
const localityMax = 120;

export const createProjectSchema = z.object({
  body: z.strictObject({
    name: z.string().trim().min(1, 'Name is required').max(nameMax),
    description: z.string().trim().max(descriptionMax).optional(),
    locality: z.string().trim().max(localityMax).optional(),
  }),
  query: z.object({}),
  params: z.object({}),
});

export const listProjectsSchema = z.object({
  body: z.object({}).optional().default({}),
  query: z.object({
    q: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().optional(),
    all: z.enum(['true', 'false']).optional(),
  }),
  params: z.object({}),
});

export const projectIdSchema = z.object({
  body: z.object({}).optional().default({}),
  query: z.object({}),
  params: z.strictObject({ id: z.string().min(1) }),
});

export const patchProjectSchema = z.object({
  body: z.strictObject({
    name: z.string().trim().min(1).max(nameMax).optional(),
    description: z.string().trim().max(descriptionMax).nullable().optional(),
    locality: z.string().trim().max(localityMax).nullable().optional(),
  })
    .refine(obj => Object.keys(obj).length > 0, { message: 'At least one field required' }),
  query: z.object({}),
  params: z.strictObject({ id: z.string().min(1) }),
});
```

### Task 4 — Data access layer

**File (create):** `src/api/data-access/projects.da.ts`

```ts
import prisma from '../../config/prisma';
import type { Project, Prisma } from '../../generated/prisma';

export type ListFilters = {
  ownerId?: string;     // omit for admin-all
  q?: string;
  limit: number;
  cursor?: string;
};

export async function createProject(input: {
  ownerId: string;
  name: string;
  description?: string;
  locality?: string;
}): Promise<Project> {
  return prisma.project.create({ data: input });
}

export async function listProjects(filters: ListFilters) {
  const where: Prisma.ProjectWhereInput = { deletedAt: null };
  if (filters.ownerId) where.ownerId = filters.ownerId;
  if (filters.q) where.name = { contains: filters.q, mode: 'insensitive' };

  const rows = await prisma.project.findMany({
    where,
    take: filters.limit + 1,
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    orderBy: { createdAt: 'desc' },
    include: { owner: { select: { id: true, email: true, name: true } } },
  });
  const hasMore = rows.length > filters.limit;
  const page = hasMore ? rows.slice(0, filters.limit) : rows;
  return { projects: page, nextCursor: hasMore ? page[page.length - 1].id : undefined };
}

export async function getProjectById(id: string) {
  return prisma.project.findFirst({
    where: { id, deletedAt: null },
    include: { owner: { select: { id: true, email: true, name: true } } },
  });
}

export async function patchProject(id: string, data: { name?: string; description?: string | null; locality?: string | null }) {
  return prisma.project.update({ where: { id }, data });
}

export async function softDeleteProject(id: string) {
  return prisma.project.update({ where: { id }, data: { deletedAt: new Date() } });
}
```

### Task 5 — Service layer

**File (create):** `src/api/services/projects.service.ts`

```ts
import { HttpError } from '../../lib/HttpError';
import { record as auditRecord } from './audit-log.service';
import * as da from '../data-access/projects.da';
import type { Role } from '../../generated/prisma';

export async function createProject(ownerId: string, input: { name: string; description?: string; locality?: string }) {
  const project = await da.createProject({ ownerId, ...input });
  await auditRecord({ actorId: ownerId, event: 'project.created', entity: 'Project', entityId: project.id });
  return project;
}

export async function listProjectsFor(user: { id: string; role: Role }, opts: { q?: string; limit: number; cursor?: string; all?: boolean }) {
  const filters = {
    ownerId: user.role === 'ADMIN' && opts.all ? undefined : user.id,
    q: opts.q,
    limit: opts.limit,
    cursor: opts.cursor,
  };
  return da.listProjects(filters);
}

async function loadAccessible(user: { id: string; role: Role }, id: string) {
  const project = await da.getProjectById(id);
  if (!project) throw new HttpError(404, 'Not found');
  if (project.ownerId !== user.id && user.role !== 'ADMIN') throw new HttpError(403, 'Forbidden');
  return project;
}

export async function getProject(user: { id: string; role: Role }, id: string) {
  return loadAccessible(user, id);
}

export async function patchProject(user: { id: string; role: Role }, id: string, patch: { name?: string; description?: string | null; locality?: string | null }) {
  await loadAccessible(user, id);
  const changed = Object.keys(patch).filter(k => (patch as Record<string, unknown>)[k] !== undefined);
  const project = await da.patchProject(id, patch);
  await auditRecord({ actorId: user.id, event: 'project.updated', entity: 'Project', entityId: id, metadata: { fields: changed } });
  return project;
}

export async function softDeleteProject(user: { id: string; role: Role }, id: string) {
  await loadAccessible(user, id);
  await da.softDeleteProject(id);
  await auditRecord({ actorId: user.id, event: 'project.deleted', entity: 'Project', entityId: id });
}
```

### Task 6 — Controller + routes

**Files (create):**
- `src/api/controllers/projects.controller.ts`
- `src/api/routes/projects.routes.ts`

- [ ] **6.1** `src/api/controllers/projects.controller.ts`

```ts
import type { Request, Response, NextFunction } from 'express';
import * as svc from '../services/projects.service';
import { HttpError } from '../../lib/HttpError';

function requireUser(req: Request) {
  if (!req.user) throw new HttpError(401, 'Unauthenticated');
  return req.user;
}

function publicProject(p: {
  id: string; ownerId: string; name: string; description: string | null; locality: string | null;
  createdAt: Date; updatedAt: Date;
  owner?: { id: string; email: string; name: string };
}) {
  return {
    id: p.id, ownerId: p.ownerId, name: p.name, description: p.description, locality: p.locality,
    createdAt: p.createdAt, updatedAt: p.updatedAt, ...(p.owner ? { owner: p.owner } : {}),
  };
}

export async function createProject(req: Request, res: Response, next: NextFunction) {
  try {
    const user = requireUser(req);
    const project = await svc.createProject(user.id, req.body);
    res.status(201).json({ data: { project: publicProject(project) } });
  } catch (err) { next(err); }
}

export async function listProjects(req: Request, res: Response, next: NextFunction) {
  try {
    const user = requireUser(req);
    const { q, limit, cursor, all } = req.query as unknown as { q?: string; limit: number; cursor?: string; all?: 'true' | 'false' };
    const result = await svc.listProjectsFor(user, { q, limit, cursor, all: all === 'true' });
    res.json({ data: { projects: result.projects.map(publicProject), nextCursor: result.nextCursor } });
  } catch (err) { next(err); }
}

export async function getProject(req: Request, res: Response, next: NextFunction) {
  try {
    const user = requireUser(req);
    const project = await svc.getProject(user, (req.params as { id: string }).id);
    res.json({ data: { project: publicProject(project) } });
  } catch (err) { next(err); }
}

export async function patchProject(req: Request, res: Response, next: NextFunction) {
  try {
    const user = requireUser(req);
    const project = await svc.patchProject(user, (req.params as { id: string }).id, req.body);
    res.json({ data: { project: publicProject(project) } });
  } catch (err) { next(err); }
}

export async function deleteProject(req: Request, res: Response, next: NextFunction) {
  try {
    const user = requireUser(req);
    await svc.softDeleteProject(user, (req.params as { id: string }).id);
    res.json({ data: { ok: true } });
  } catch (err) { next(err); }
}
```

- [ ] **6.2** `src/api/routes/projects.routes.ts`

```ts
import { Router } from 'express';
import * as ctrl from '../controllers/projects.controller';
import { validate, auth } from '../../middlewares';
import {
  createProjectSchema,
  listProjectsSchema,
  patchProjectSchema,
  projectIdSchema,
} from '../schemas/projects.schemas';

const router = Router();

router.use(auth);

router.post('/', validate(createProjectSchema), ctrl.createProject);
router.get('/', validate(listProjectsSchema), ctrl.listProjects);
router.get('/:id', validate(projectIdSchema), ctrl.getProject);
router.patch('/:id', validate(patchProjectSchema), ctrl.patchProject);
router.delete('/:id', validate(projectIdSchema), ctrl.deleteProject);

export default router;
```

---

## Cluster 2 — Wire server (sequential)

### Task 7 — Mount router + call bootstrap

- [ ] **7.1** In `src/api/index.ts` (or wherever routes are mounted), add:

```ts
import projectsRouter from './routes/projects.routes';
// ...
app.use('/api/projects', projectsRouter);
```

(If `api/index.ts` uses an array of routers or a different mounting style, follow the existing pattern — grep `admin.routes` for the precedent.)

- [ ] **7.2** In `src/index.ts`, before `app.listen(...)`, add:

```ts
import { ensureUploads } from './bootstrap/ensure-uploads';
// ...
await ensureUploads();
```

- [ ] **7.3** Typecheck + commit Cluster 1 + 2:

```bash
cd "C:/Users/yosefh/OneDrive - hms.co.il/Desktop/Clearance/server"
npm run typecheck
git add src prisma
git commit -m "feat(projects): storage client + project CRUD (service/da/controller/routes)"
```

---

## Cluster 3 — Unit tests (sequential)

### Task 8 — projects.service.test.ts

**File (create):** `src/api/services/projects.service.test.ts`

Follow the existing `admin-users.service.test.ts` pattern (Jest mocks for `data-access` + `audit-log.service`). Cover:

- `createProject` → calls da.createProject with ownerId + fields; writes audit `project.created`
- `listProjectsFor` USER → passes `ownerId = user.id` to da
- `listProjectsFor` ADMIN with `all=true` → passes `ownerId: undefined`
- `listProjectsFor` USER with `all=true` → STILL `ownerId = user.id` (ignored)
- `getProject` → loads via da; throws HttpError(404) if `null`; throws 403 if cross-owner non-admin; returns for admin
- `patchProject` → computes changed fields, writes audit with `{ fields: [...] }`
- `softDeleteProject` → calls da.softDeleteProject, writes audit

Read `src/api/services/admin-users.service.test.ts` before writing — mirror its mock style (`jest.mock('../data-access/admin-users.da')`).

- [ ] **8.1** Write the test file. Each test ≤ 20 lines. No snapshots.
- [ ] **8.2** Run: `npm test -- projects.service` — all green.
- [ ] **8.3** Commit: `git commit -am "test(projects): unit tests for projects.service"`

---

## Cluster 4 — Integration tests + server smoke (sequential)

### Task 9 — projects.integration.test.ts

**File (create):** `tests/integration/projects.integration.test.ts`

Reuse the phase 1a integration test harness (supertest + Prisma against the test DB). Before each test, truncate `Project` + `AuditLog` + non-admin Users, seed the admin + one USER via the existing helper.

Cover:

- `POST /api/projects` as USER → 201 + returned `{ project }` shape
- `POST` missing name → 400 with Zod error
- `GET /api/projects` as USER → only owner's rows; soft-deleted ones excluded
- `GET /api/projects?all=true` as USER → owner-scoped (flag ignored)
- `GET /api/projects?all=true` as ADMIN → cross-owner visible
- `GET /api/projects/:id` cross-owner as USER → 403
- `GET /api/projects/:id` cross-owner as ADMIN → 200
- `PATCH /api/projects/:id` → 200 + audit `project.updated` with `fields`
- `PATCH` with empty body → 400 (zod refine)
- `DELETE /api/projects/:id` → 200, subsequent GET 404, audit `project.deleted`
- `DELETE` cross-owner as USER → 403; as ADMIN → 200
- `?limit=1` + `?cursor=<id>` → pagination behavior

Read `tests/integration/admin-users.integration.test.ts` (or equivalent phase-1a test) before writing to mirror its harness.

- [ ] **9.1** Write file.
- [ ] **9.2** Run: `npm run test:integration -- projects` — all green.
- [ ] **9.3** Full run: `npm test` + `npm run test:integration` + `npm run typecheck` — all three green.
- [ ] **9.4** Commit: `git commit -am "test(projects): integration coverage for CRUD + visibility + pagination"`

---

## Cluster 5 — Client (parallel)

After server is green, shift to the client submodule.

### Task 10 — api/types additions

**File (modify):** `client/src/api/types.ts` — append:

```ts
export type Project = {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  locality: string | null;
  createdAt: string;
  updatedAt: string;
  owner?: { id: string; email: string; name: string };
};

export type ListProjectsResponse = {
  projects: Project[];
  nextCursor?: string;
};
```

### Task 11 — api/projects.api.ts

**File (create):**

```ts
// client/src/api/projects.api.ts
import { api } from '@/lib/axios';
import type { Project, ListProjectsResponse } from './types';

export async function listProjects(
  params: { q?: string; limit?: number; cursor?: string; all?: boolean } = {},
  signal?: AbortSignal,
): Promise<ListProjectsResponse> {
  const query: Record<string, string | number> = {};
  if (params.q) query.q = params.q;
  if (params.limit) query.limit = params.limit;
  if (params.cursor) query.cursor = params.cursor;
  if (params.all) query.all = 'true';
  const res = await api.get<{ data: ListProjectsResponse }>('/projects', { params: query, signal });
  return res.data.data;
}

export async function getProject(id: string, signal?: AbortSignal): Promise<Project> {
  const res = await api.get<{ data: { project: Project } }>(`/projects/${id}`, { signal });
  return res.data.data.project;
}

export async function createProject(
  body: { name: string; description?: string; locality?: string },
  signal?: AbortSignal,
): Promise<Project> {
  const res = await api.post<{ data: { project: Project } }>('/projects', body, { signal });
  return res.data.data.project;
}

export async function patchProject(
  id: string,
  body: { name?: string; description?: string | null; locality?: string | null },
  signal?: AbortSignal,
): Promise<Project> {
  const res = await api.patch<{ data: { project: Project } }>(`/projects/${id}`, body, { signal });
  return res.data.data.project;
}

export async function deleteProject(id: string, signal?: AbortSignal): Promise<void> {
  await api.delete(`/projects/${id}`, { signal });
}
```

### Task 12 — hooks/useProjects + useProject

**Files (create):**
- `client/src/hooks/useProjects.ts`
- `client/src/hooks/useProject.ts`

```ts
// client/src/hooks/useProjects.ts
import { useQuery } from '@tanstack/react-query';
import { listProjects } from '@/api/projects.api';

export function useProjects(opts: { all?: boolean; q?: string } = {}) {
  return useQuery({
    queryKey: ['projects', { all: !!opts.all, q: opts.q ?? '' }],
    queryFn: ({ signal }) => listProjects({ all: opts.all, q: opts.q, limit: 50 }, signal),
    staleTime: 0,
  });
}
```

```ts
// client/src/hooks/useProject.ts
import { useQuery } from '@tanstack/react-query';
import { getProject } from '@/api/projects.api';

export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: ['project', id],
    queryFn: ({ signal }) => getProject(id!, signal),
    enabled: !!id,
    staleTime: 0,
  });
}
```

### Task 13 — pages/projects/ProjectCard.tsx

```tsx
// client/src/pages/projects/ProjectCard.tsx
import { Link } from 'react-router';
import type { Project } from '@/api/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type Props = { project: Project; showOwner: boolean; onDelete: (p: Project) => void };

function formatSince(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

export function ProjectCard({ project, showOwner, onDelete }: Props) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
        <div className="flex flex-col gap-1 min-w-0">
          <CardTitle className="truncate">
            <Link to={`/projects/${project.id}`} className="hover:underline">{project.name}</Link>
          </CardTitle>
          {project.locality && <span className="text-xs text-muted-foreground truncate">{project.locality}</span>}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="sm">…</Button>} />
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="text-destructive" onClick={() => onDelete(project)}>Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 text-sm">
        {project.description && (
          <p className="text-muted-foreground line-clamp-2">{project.description}</p>
        )}
        <div className="mt-auto flex items-center justify-between text-xs text-muted-foreground">
          <span>{formatSince(project.createdAt)}</span>
          {showOwner && project.owner && <span className="truncate">{project.owner.email}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
```

### Task 14 — pages/projects/CreateProjectDialog.tsx

Mirror `admin/CreateUserDialog.tsx`. RHF + zod validating `{ name: min(1).max(120), description?: max(2000), locality?: max(120) }`. Submit via `useHttpClient({ fn: createProject })`. On success: invalidate `['projects']`, navigate to `/projects/<id>`, close dialog.

(Full file contents follow the exact `CreateUserDialog` structure with fields swapped — email/name/password → name/description/locality; success action changes from toast-only to `navigate(\`/projects/\${project.id}\`)`.)

### Task 15 — pages/projects/DeleteProjectConfirm.tsx

Mirror `admin/DeleteUserConfirm.tsx`. Email gate → project-name gate (type the project's name to enable Delete). On success: invalidate `['projects']`, toast "Deleted {name}", if `location.pathname.startsWith('/projects/')` then `navigate('/')`.

### Task 16 — pages/HomePage.tsx (replace)

**Replaces existing phase-1b placeholder.**

```tsx
// client/src/pages/HomePage.tsx
import { useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useProjects } from '@/hooks/useProjects';
import { Button } from '@/components/ui/button';
import { ProjectCard } from './projects/ProjectCard';
import { CreateProjectDialog } from './projects/CreateProjectDialog';
import { DeleteProjectConfirm } from './projects/DeleteProjectConfirm';
import type { Project } from '@/api/types';

export default function HomePage() {
  const { user } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);

  const { data, isLoading, isError, refetch } = useProjects({ all: showAll });
  const projects = data?.projects ?? [];
  const isAdmin = user?.role === 'ADMIN';
  const showOwner = useMemo(() => isAdmin && showAll, [isAdmin, showAll]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold">{showAll ? 'All projects' : 'My projects'}</h1>
          {isAdmin && (
            <Button variant="ghost" size="sm" onClick={() => setShowAll(v => !v)}>
              {showAll ? 'Show mine' : 'Show all'}
            </Button>
          )}
        </div>
        <Button onClick={() => setCreateOpen(true)}>Create project</Button>
      </div>

      {isError && (
        <div className="flex items-center justify-between rounded-md border border-destructive/40 bg-destructive/5 p-4">
          <span className="text-sm text-destructive">Failed to load projects.</span>
          <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
        </div>
      )}

      {!isError && isLoading && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}

      {!isError && !isLoading && projects.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed p-12 text-center">
          <p className="text-muted-foreground">No projects yet — create your first.</p>
          <Button onClick={() => setCreateOpen(true)}>Create project</Button>
        </div>
      )}

      {!isError && !isLoading && projects.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map(p => (
            <ProjectCard key={p.id} project={p} showOwner={showOwner} onDelete={setDeleteTarget} />
          ))}
        </div>
      )}

      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
      <DeleteProjectConfirm project={deleteTarget} onOpenChange={() => setDeleteTarget(null)} />
    </div>
  );
}
```

### Task 17 — pages/ProjectDetailPage.tsx

```tsx
// client/src/pages/ProjectDetailPage.tsx
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { useProject } from '@/hooks/useProject';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { DeleteProjectConfirm } from './projects/DeleteProjectConfirm';
import type { Project } from '@/api/types';

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data, isLoading, isError, error } = useProject(id);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);

  useEffect(() => {
    if (isError) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 404 || status === 403) {
        toast.error('Project not found');
        navigate('/', { replace: true });
      }
    }
  }, [isError, error, navigate]);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!data) return null;

  const project = data;
  const isOwnerOrAdmin = user?.id === project.ownerId || user?.role === 'ADMIN';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Link to="/" className="text-sm text-muted-foreground hover:underline">← Back</Link>
          </div>
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          {project.locality && <p className="text-sm text-muted-foreground">{project.locality}</p>}
          {project.owner && user?.id !== project.ownerId && (
            <p className="text-xs text-muted-foreground">Owner: {project.owner.email}</p>
          )}
        </div>
        {isOwnerOrAdmin && (
          <Button variant="outline" onClick={() => setDeleteTarget(project)}>Delete</Button>
        )}
      </div>

      {project.description && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Description</CardTitle></CardHeader>
          <CardContent className="text-sm whitespace-pre-wrap">{project.description}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Files</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">Files arrive in phase 4a.</CardContent>
      </Card>

      <DeleteProjectConfirm project={deleteTarget} onOpenChange={() => setDeleteTarget(null)} />
    </div>
  );
}
```

### Task 18 — routes.tsx (add detail route)

Add inside the `<Route element={<AppLayout />}>` block, before the admin nested routes:

```tsx
<Route path="/projects/:id" element={<ProjectDetailPage />} />
```

Import `ProjectDetailPage` from `@/pages/ProjectDetailPage` at the top.

### Orchestrator step — Typecheck + build + commit Cluster 5

```bash
cd "C:/Users/yosefh/OneDrive - hms.co.il/Desktop/Clearance/client"
npm run typecheck
npm run lint
npm run build
git add src
git commit -m "feat(projects): HomePage project grid + detail page + create/delete flows"
```

All three green. Any lint/typecheck/build error: fix before committing.

---

## Cluster 6 — E2E smoke + bumps + PRs (sequential)

### Task 19 — Manual E2E smoke

With server + client dev running:

1. Log in as admin. HomePage shows empty state.
2. Create project "Test A" (description + locality). Lands on `/projects/<id>`; detail page renders.
3. Back to `/`. Card for "Test A" visible. Creation-time shows "Today".
4. Create another user via `/admin/users`, log out, log in as that user.
5. HomePage empty. Create "Test B" as that user.
6. Log out, log in as admin. HomePage shows "Test A" only. Click "Show all" → "Test B" appears with owner email.
7. Click into "Test B" → admin can view non-owned project.
8. Click Delete on "Test B" (type project name to confirm) → toast "Deleted Test B", redirect to `/`, card gone. Stats Users unchanged (projects != users).
9. Log out. `/projects/<ANY>` → redirect to `/login`.

### Task 20 — Push + submodule bumps + PRs

- [ ] **20.1** Push server branch:
```bash
cd "C:/Users/yosefh/OneDrive - hms.co.il/Desktop/Clearance/server"
git push -u origin feat/buildcheck-phase-2
```

- [ ] **20.2** Open server PR against `integration/buildcheck`:
```bash
gh pr create --base integration/buildcheck --head feat/buildcheck-phase-2 \
  --title "feat(projects): phase 2 — Project + StoredFile + CRUD" \
  --body "..."
```

- [ ] **20.3** Push client branch:
```bash
cd "../client"
git push -u origin feat/buildcheck-phase-2
gh pr create --base main --head feat/buildcheck-phase-2 \
  --title "feat(projects): phase 2 — project list + detail pages" \
  --body "..."
```

- [ ] **20.4** Main repo: bump both submodules, update Phase Status.

```bash
cd "C:/Users/yosefh/OneDrive - hms.co.il/Desktop/Clearance"
git add server client
git commit -m "chore(submodule): bump server + client to phase 2"
# edit docs/vault/00-Index/Phase Status.md → phase 2 in-review + PR links
git add "docs/vault/00-Index/Phase Status.md"
git commit -m "docs(vault): phase 2 → in-review with PR links"
git push -u origin feat/buildcheck-phase-2
gh pr create --base integration/buildcheck --head feat/buildcheck-phase-2 \
  --title "feat: phase 2 — projects + storage (design + submodule bumps)" \
  --body "..."
```

PR bodies: mirror the phase 1b format. Include links to the design spec + companion PRs + green-bar checkboxes.

---

## Self-review checklist (run at end)

- [ ] Every design spec §1–§8 item maps to at least one task
- [ ] No `TBD` / `TODO` placeholders
- [ ] Types match across server + client (`Project`, `ListProjectsResponse`)
- [ ] Server `npm run typecheck` + `npm test` + `npm run test:integration` all exit 0
- [ ] Client `npm run typecheck` + `npm run build` + `npm run lint` all exit 0
- [ ] Smoke checklist §19 items 1–9 all pass
- [ ] Three PRs open (server, client, main), Phase Status = in-review
