# Phase 3 — Jobs Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship the DB-backed `Job` queue scaffolding that phases 4+ enqueue into. One model, one polling worker, one boot-time reaper. No handlers.

**Design spec:** [2026-04-20-buildcheck-phase-3-jobs-infrastructure-design.md](../specs/2026-04-20-buildcheck-phase-3-jobs-infrastructure-design.md)

**Server-only. No client changes.**

---

## Clusters

```
Cluster 0 (sequential): schema + migration
  └─> Cluster 1 (parallel): runner, handlers registry, recovery, bootstrap
          └─> Cluster 2 (sequential): wire bootstrap into src/index.ts + SIGTERM/SIGINT
                  └─> Cluster 3 (sequential): unit tests
                          └─> Cluster 4 (sequential): integration test + full green bar
                                  └─> Cluster 5 (sequential): submodule bump + PRs
```

Preflight: branches cut. `cd server` is the working directory for cluster 0–4.

---

## Task 1 — Schema + migration (Cluster 0, sequential)

**Files:**
- Modify: `server/prisma/schema.prisma`
- Generate: `server/prisma/migrations/<ts>_phase_3_jobs/migration.sql`

- [ ] **1.1** Append to `prisma/schema.prisma`:

```prisma
enum JobType {
  DXF_EXTRACTION
  TAVA_EXTRACTION
  ADDON_EXTRACTION
  CORE_ANALYSIS
  ADDON_RUN
}

enum JobStatus {
  PENDING
  RUNNING
  COMPLETED
  FAILED
  CANCELLED
}

model Job {
  id              String    @id @default(cuid())
  type            JobType
  status          JobStatus @default(PENDING)
  payload         Json
  errorMessage    String?
  attempts        Int       @default(0)
  heartbeatAt     DateTime?

  projectId       String?
  analysisId      String?
  addonRunId      String?
  dxfFileId       String?
  tavaFileId      String?
  addonDocumentId String?

  startedAt       DateTime?
  completedAt     DateTime?
  createdAt       DateTime  @default(now())

  @@index([status, createdAt])
  @@index([type, status])
}
```

- [ ] **1.2** `npx prisma migrate dev --name phase_3_jobs`. Expect one new migration folder.

- [ ] **1.3** Add `prisma.job.deleteMany({})` to `src/test-helpers/db.ts` (ordering: before `project.deleteMany`).

- [ ] **1.4** `npm run typecheck` → exit 0. Commit:

```bash
git add prisma/schema.prisma prisma/migrations src/test-helpers/db.ts
git commit -m "feat(db): phase 3 — Job model + JobType + JobStatus + migration"
```

---

## Cluster 1 — Runner + registry + recovery + bootstrap (parallel)

All four files are disjoint. Write in parallel; commit together.

### Task 2 — `src/jobs/handlers/index.ts`

```ts
import type { JobType, Job } from '../../generated/prisma/client';

export type JobHandler = (job: Job) => Promise<void>;

export const handlers: Partial<Record<JobType, JobHandler>> = {};

export function registerHandler(type: JobType, handler: JobHandler): void {
    handlers[type] = handler;
}
```

### Task 3 — `src/jobs/recovery.ts`

```ts
import prisma from '../config/prisma';
import logger from '../config/logger';

export const STALE_HEARTBEAT_MS = 30_000;

export async function recoverStuckJobs(): Promise<number> {
    const cutoff = new Date(Date.now() - STALE_HEARTBEAT_MS);
    const result = await prisma.job.updateMany({
        where: {
            status: 'RUNNING',
            OR: [
                { heartbeatAt: null },
                { heartbeatAt: { lt: cutoff } },
            ],
        },
        data: {
            status: 'FAILED',
            errorMessage: 'interrupted by server restart',
            completedAt: new Date(),
        },
    });
    logger.info('jobs.recovery.reaped', { count: result.count });
    return result.count;
}
```

### Task 4 — `src/jobs/runner.ts`

Implements the DB-polling worker per design §3. Uses `$queryRaw` for the pickup SQL (needed for `FOR UPDATE SKIP LOCKED`), then `prisma.job.update` for state transitions.

```ts
import prisma from '../config/prisma';
import logger from '../config/logger';
import type { Job, JobType, Prisma } from '../generated/prisma/client';
import { handlers } from './handlers';

export type EnqueueInput = {
    type: JobType;
    payload: Prisma.InputJsonValue;
    projectId?: string;
    analysisId?: string;
    addonRunId?: string;
    dxfFileId?: string;
    tavaFileId?: string;
    addonDocumentId?: string;
};

export interface JobRunner {
    enqueue(input: EnqueueInput): Promise<Job>;
    cancel(jobId: string): Promise<void>;
    start(): void;
    stop(): Promise<void>;
}

type Options = {
    pollIntervalMs?: number;
    heartbeatIntervalMs?: number;
};

const TERMINAL: ReadonlySet<Job['status']> = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

export class DbPollingJobRunner implements JobRunner {
    private running = false;
    private loopPromise: Promise<void> | null = null;
    private readonly pollIntervalMs: number;
    private readonly heartbeatIntervalMs: number;

    constructor(opts: Options = {}) {
        this.pollIntervalMs = opts.pollIntervalMs ?? 2000;
        this.heartbeatIntervalMs = opts.heartbeatIntervalMs ?? 30_000;
    }

    async enqueue(input: EnqueueInput): Promise<Job> {
        return prisma.job.create({
            data: {
                type: input.type,
                payload: input.payload,
                projectId: input.projectId ?? null,
                analysisId: input.analysisId ?? null,
                addonRunId: input.addonRunId ?? null,
                dxfFileId: input.dxfFileId ?? null,
                tavaFileId: input.tavaFileId ?? null,
                addonDocumentId: input.addonDocumentId ?? null,
            },
        });
    }

    async cancel(jobId: string): Promise<void> {
        const job = await prisma.job.findUnique({ where: { id: jobId } });
        if (!job) return;
        if (TERMINAL.has(job.status)) return;
        if (job.status === 'RUNNING') {
            logger.warn('jobs.cancel.running', { jobId });
        }
        await prisma.job.update({
            where: { id: jobId },
            data: { status: 'CANCELLED', completedAt: new Date() },
        });
    }

    start(): void {
        if (this.running) return;
        this.running = true;
        this.loopPromise = this.loop().catch((err) => {
            logger.error('jobs.runner.loop_crash', {
                error: err instanceof Error ? err.message : String(err),
            });
            this.running = false;
        });
    }

    async stop(): Promise<void> {
        this.running = false;
        if (this.loopPromise) await this.loopPromise;
        this.loopPromise = null;
    }

    private async loop(): Promise<void> {
        while (this.running) {
            const job = await this.pickUpNextJob();
            if (!job) {
                await sleep(this.pollIntervalMs);
                continue;
            }
            await this.process(job);
        }
    }

    private async pickUpNextJob(): Promise<Job | null> {
        return prisma.$transaction(async (tx) => {
            const rows = await tx.$queryRaw<Job[]>`
                SELECT * FROM "Job"
                WHERE status = 'PENDING'
                ORDER BY "createdAt"
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            `;
            const row = rows[0];
            if (!row) return null;
            return tx.job.update({
                where: { id: row.id },
                data: {
                    status: 'RUNNING',
                    startedAt: new Date(),
                    heartbeatAt: new Date(),
                    attempts: { increment: 1 },
                },
            });
        });
    }

    private async process(job: Job): Promise<void> {
        const heartbeat = setInterval(() => {
            prisma.job
                .update({ where: { id: job.id }, data: { heartbeatAt: new Date() } })
                .catch((err) => logger.warn('jobs.heartbeat.fail', {
                    jobId: job.id,
                    error: err instanceof Error ? err.message : String(err),
                }));
        }, this.heartbeatIntervalMs);

        try {
            const handler = handlers[job.type];
            if (!handler) {
                throw new Error(`no handler registered for ${job.type}`);
            }
            await handler(job);
            await prisma.job.update({
                where: { id: job.id },
                data: { status: 'COMPLETED', completedAt: new Date(), heartbeatAt: new Date() },
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error('jobs.handler_failed', { jobId: job.id, type: job.type, error: message });
            await prisma.job.update({
                where: { id: job.id },
                data: { status: 'FAILED', errorMessage: message, completedAt: new Date(), heartbeatAt: new Date() },
            });
        } finally {
            clearInterval(heartbeat);
        }
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export const runner: JobRunner = new DbPollingJobRunner();
```

### Task 5 — `src/bootstrap/start-job-runner.ts`

```ts
import logger from '../config/logger';
import { recoverStuckJobs } from '../jobs/recovery';
import { runner } from '../jobs/runner';

export async function startJobRunner(): Promise<void> {
    const reaped = await recoverStuckJobs();
    logger.info('jobs.runner.starting', { reaped });
    runner.start();
}
```

### Orchestrator commit (Cluster 1):

```bash
cd server
npm run typecheck
git add src/jobs src/bootstrap/start-job-runner.ts
git commit -m "feat(jobs): DbPollingJobRunner + handler registry + boot-recovery reaper"
```

---

## Cluster 2 — Wire boot + graceful shutdown (sequential)

### Task 6 — `src/index.ts`

Add:
- Import `startJobRunner` + `runner`.
- Call `await startJobRunner()` after `ensureUploads()`, before `app.listen()`.
- Register `SIGINT` + `SIGTERM` handlers that await `runner.stop()` and exit 0.

```ts
import app from './app';
import env from './utils/env';
import logger from './config/logger';
import { connectToDatabase } from './config/database';
import { seedAdmin } from './bootstrap/seed-admin';
import { ensureUploads } from './bootstrap/ensure-uploads';
import { startJobRunner } from './bootstrap/start-job-runner';
import { runner } from './jobs/runner';

const port = env.PORT || 3001;

async function main() {
    await connectToDatabase();
    await seedAdmin();
    await ensureUploads();
    await startJobRunner();
    const server = app.listen(port, () => {
        logger.info(`Listening: http://localhost:${port}`);
    });

    const shutdown = async (signal: string) => {
        logger.info('shutdown.begin', { signal });
        await runner.stop();
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(1), 10_000).unref();
    };
    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
    logger.error('Boot failure', { error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
});
```

- [ ] **6.1** `npm run typecheck` → exit 0. Commit:

```bash
git commit -am "feat(jobs): wire startJobRunner + graceful shutdown"
```

---

## Cluster 3 — Unit tests (sequential)

### Task 7 — `src/jobs/recovery.test.ts`

Mocks `prisma.job.updateMany`. Asserts the `where` clause includes `status: 'RUNNING'` and an `OR` for `heartbeatAt: null | lt: cutoff`; asserts count is returned.

### Task 8 — `src/jobs/runner.test.ts`

Pattern: `jest.mock('../config/prisma', () => ({ __esModule: true, default: { job: { create, update, findUnique }, $transaction, $queryRaw } }))`.

Covers (follow the spec §6.1 list):
- `enqueue` calls `prisma.job.create` with the expected shape
- `cancel` on PENDING → `prisma.job.update` with `status: 'CANCELLED'`
- `cancel` on RUNNING → update + warn log (spy on logger)
- `cancel` on terminal (`COMPLETED`) → no update call
- Worker loop happy path: `$transaction` returns a job; registered handler runs; final `job.update` has `status: 'COMPLETED'`
- Handler throws → final `update` has `status: 'FAILED'` and `errorMessage: <thrown>`
- Missing handler → final `update` has `status: 'FAILED'` and `errorMessage: "no handler registered for <type>"`

Use short-interval runner (`new DbPollingJobRunner({ pollIntervalMs: 1, heartbeatIntervalMs: 10_000 })`) + `await runner.stop()` after one iteration via setting the pickup to return null on the second call.

- [ ] **7.1** Write `recovery.test.ts`.
- [ ] **7.2** Write `runner.test.ts`.
- [ ] **7.3** `npm test -- jobs` → green (expect ~10 new tests).
- [ ] **7.4** Commit:

```bash
git commit -am "test(jobs): unit coverage for runner + recovery"
```

---

## Cluster 4 — Integration test + green bar (sequential)

### Task 9 — `src/jobs/jobs.integration.test.ts`

```ts
import prisma from '../config/prisma';
import { truncateAll } from '../test-helpers/db';
import { recoverStuckJobs } from './recovery';

beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await prisma.$disconnect(); });

describe('recoverStuckJobs', () => {
    it('reaps a RUNNING job with null heartbeat', async () => {
        const job = await prisma.job.create({
            data: { type: 'DXF_EXTRACTION', status: 'RUNNING', payload: {}, heartbeatAt: null },
        });
        const count = await recoverStuckJobs();
        expect(count).toBe(1);
        const after = await prisma.job.findUnique({ where: { id: job.id } });
        expect(after?.status).toBe('FAILED');
        expect(after?.errorMessage).toBe('interrupted by server restart');
        expect(after?.completedAt).not.toBeNull();
    });

    it('reaps a RUNNING job with stale heartbeat', async () => {
        const stale = new Date(Date.now() - 120_000);
        const job = await prisma.job.create({
            data: { type: 'DXF_EXTRACTION', status: 'RUNNING', payload: {}, heartbeatAt: stale },
        });
        await recoverStuckJobs();
        const after = await prisma.job.findUnique({ where: { id: job.id } });
        expect(after?.status).toBe('FAILED');
    });

    it('leaves a RUNNING job with fresh heartbeat alone', async () => {
        const job = await prisma.job.create({
            data: { type: 'DXF_EXTRACTION', status: 'RUNNING', payload: {}, heartbeatAt: new Date() },
        });
        const count = await recoverStuckJobs();
        expect(count).toBe(0);
        const after = await prisma.job.findUnique({ where: { id: job.id } });
        expect(after?.status).toBe('RUNNING');
    });

    it('leaves a PENDING job alone', async () => {
        await prisma.job.create({
            data: { type: 'DXF_EXTRACTION', status: 'PENDING', payload: {} },
        });
        const count = await recoverStuckJobs();
        expect(count).toBe(0);
    });
});
```

- [ ] **9.1** Write the file. Note: filename ends `*.integration.test.ts` so the integration Jest config picks it up.
- [ ] **9.2** Run:
```bash
npm run test:integration -- jobs
```
All 4 tests green.
- [ ] **9.3** Full green bar — all three must exit 0:
```bash
npm run typecheck
npm test
npm run test:integration
```
- [ ] **9.4** Commit:
```bash
git commit -am "test(jobs): integration coverage for boot-recovery reaper"
```

---

## Cluster 5 — Submodule bump + PRs (sequential)

### Task 10 — Push server + open PR

```bash
cd server
git push -u origin feat/buildcheck-phase-3
gh pr create --base integration/buildcheck --head feat/buildcheck-phase-3 \
  --title "feat(jobs): phase 3 — Job queue + polling runner + boot-recovery reaper" \
  --body "..."
```

PR body: mirror phase 2's format. Include:
- What's new (model + runner + recovery + bootstrap)
- Green bar counts (unit + integration test deltas)
- "No handlers yet — phase 4a enqueues the first `DXF_EXTRACTION`"
- Companion: main-repo PR ref

### Task 11 — Main repo: bump + Phase Status + PR

```bash
cd ..
git add server
git commit -m "chore(submodule): bump server to phase 3 tip"
```

Update `docs/vault/00-Index/Phase Status.md`:
- frontmatter `current_phase: 3`, `current_status: in-review`, update `updated`
- Current callout: phase 3 in-review with PR link
- Phase log row: `in-review` + PR link

```bash
git add "docs/vault/00-Index/Phase Status.md"
git commit -m "docs(vault): phase 3 -> in-review"
git push -u origin feat/buildcheck-phase-3
gh pr create --base integration/buildcheck --head feat/buildcheck-phase-3 \
  --title "feat: phase 3 — jobs infrastructure (design + submodule bump)" \
  --body "..."
```

---

## Self-review

- [ ] Every spec §1–§8 item maps to a task
- [ ] No placeholders / TODOs
- [ ] Types match across runner / recovery / tests
- [ ] `npm run typecheck` + `npm test` + `npm run test:integration` all exit 0
- [ ] Two PRs open (server + main-repo), Phase Status = in-review
