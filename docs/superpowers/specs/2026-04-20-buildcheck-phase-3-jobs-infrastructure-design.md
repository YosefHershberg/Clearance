# BuildCheck — Phase 3 — Jobs Infrastructure Design

**Date:** 2026-04-20
**Status:** Approved for implementation planning
**Phase:** 3 (server only)
**Parent spec:** [2026-04-19-buildcheck-full-redesign.md](./2026-04-19-buildcheck-full-redesign.md) §2.11, §3.10, §10, §13
**Depends on:** Phase 1a (merged; auth), Phase 2 (in-review; `Project` + Prisma migration pipeline)

Scaffolds the DB-backed job queue that phases 4a/4b/4c/5/6/7 will enqueue into. No handlers ship in this phase — just the runner loop, the model, and the boot-time recovery reaper.

---

## 1. Scope

**In scope**
- Prisma migration: `Job` model + `JobType` + `JobStatus` enums. Loose references (plain nullable `String` columns for `analysisId`, `addonRunId`, `dxfFileId`, `tavaFileId`, `addonDocumentId`) — no `@relation` to non-existent models.
- `jobs/runner.ts` — `JobRunner` interface + `DbPollingJobRunner` implementation:
  - `enqueue(input)` — insert `PENDING` row
  - `cancel(id)` — mark `CANCELLED` (only if not terminal)
  - worker loop: `FOR UPDATE SKIP LOCKED` pickup, transitions to `RUNNING`, heartbeat every 30 s, transitions to `COMPLETED` / `FAILED`
  - `start()` / `stop()` methods so the integration test can lifecycle the loop
- `jobs/handlers/index.ts` — empty registry `Record<JobType, Handler>`; phase 4a+ fills entries as handlers land.
- Missing-handler policy: pickup transitions to `FAILED` with `errorMessage: "no handler registered for <type>"`. Defensive — no enqueue paths exist in phase 3, but this makes future breakage loud instead of stuck-PENDING-forever.
- `jobs/recovery.ts` — `recoverStuckJobs()`: `UPDATE Job SET status='FAILED', errorMessage='interrupted by server restart', completedAt=now() WHERE status='RUNNING' AND (heartbeatAt IS NULL OR heartbeatAt < now() - interval '30 seconds')`. Returns the number of rows reaped for logging.
- `bootstrap/start-job-runner.ts` — runs `recoverStuckJobs()`, then `runner.start()`. Called from `src/index.ts` before `app.listen()`.
- Unit tests (`runner.test.ts`, `recovery.test.ts`): enqueue, happy-path pickup + handler dispatch + completion, handler-throws transitions to FAILED, missing-handler transitions to FAILED with expected message, heartbeat ticks, recovery reaps RUNNING+stale rows and leaves non-stale alone.
- Integration test (`jobs.integration.test.ts`): create RUNNING job row with null heartbeat → call `recoverStuckJobs()` → row is FAILED with the expected errorMessage. (No runner loop in the integration test; covered by unit tests with a fake clock.)

**Out of scope**
- No handlers for any `JobType`; those land in phases 4a (`DXF_EXTRACTION`), 5 (`TAVA_EXTRACTION`), 6 (`CORE_ANALYSIS`), 7 (`ADDON_RUN` + `ADDON_EXTRACTION`).
- No Analysis / AddonRun models or their recovery (phases 6 / 7).
- No admin UI for requeueing failed jobs (deferred).
- No client changes.
- No BullMQ adapter (documented as follow-up in §10.5 of the parent spec; not v1).

**Green bar**
- `npm run typecheck` + `npm test` + `npm run test:integration` exit 0.
- Manual boot check: start dev server with an existing RUNNING Job row in the DB → log line shows recovery count > 0 → row is now FAILED.

---

## 2. Data model

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

Generated via `npx prisma migrate dev --name phase_3_jobs`. The loose FK columns (non-@relation) are intentional — Jobs survive deletion of their targets (audit trail). Indexes support the worker's `WHERE status=... ORDER BY createdAt` query and type-based status dashboards added later.

---

## 3. Runner

### 3.1 Interface

```ts
// jobs/runner.ts
export interface JobRunner {
  enqueue(input: EnqueueInput): Promise<Job>;
  cancel(jobId: string): Promise<void>;
  start(): void;
  stop(): Promise<void>;
}

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

export type JobHandler = (job: Job) => Promise<void>;
```

### 3.2 Implementation knobs (`DbPollingJobRunner`)

- `pollIntervalMs` — default `2000`, overrideable via constructor for tests.
- `heartbeatIntervalMs` — default `30_000`.
- `staleHeartbeatMs` — default `30_000` (used by recovery).
- Internal state: `running: boolean`, `loopPromise: Promise<void> | null`, `inFlight: Set<string>` (job IDs currently being processed by this instance).

### 3.3 Worker loop

```
while (running):
  tx:
    job = prisma.$queryRaw`
      SELECT * FROM "Job"
      WHERE status = 'PENDING'
      ORDER BY "createdAt"
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `
    if !job: commit; sleep(pollIntervalMs); continue
    prisma.job.update({
      where: { id: job.id },
      data: {
        status: 'RUNNING',
        startedAt: now,
        heartbeatAt: now,
        attempts: { increment: 1 },
      }
    })
  commit

  inFlight.add(job.id)
  heartbeatTimer = setInterval(() => prisma.job.update({where:{id}, data:{heartbeatAt: now}}), heartbeatIntervalMs)

  try:
    handler = handlers[job.type]
    if !handler:
      throw new Error(`no handler registered for ${job.type}`)
    await handler(job)
    prisma.job.update({ where:{id}, data:{ status:'COMPLETED', completedAt: now, heartbeatAt: now } })
  catch err:
    prisma.job.update({ where:{id}, data:{ status:'FAILED', errorMessage: err.message, completedAt: now, heartbeatAt: now } })
  finally:
    clearInterval(heartbeatTimer)
    inFlight.delete(job.id)
```

No automatic retry in v1; manual re-enqueue arrives in a later admin UI.

### 3.4 Cancel semantics

- PENDING → `CANCELLED` (simple update).
- RUNNING → update to `CANCELLED`; the in-flight handler is not interrupted (cooperative cancellation is a v2 concern). Logged so operator can investigate if necessary.
- Terminal (`COMPLETED`/`FAILED`/`CANCELLED`) → no-op (idempotent).

### 3.5 Stop

`stop()` sets `running=false` and awaits `loopPromise`. In-flight handlers finish naturally (their heartbeat tick is cleared when they complete). Tests use `stop()` after injecting a sentinel handler that resolves.

---

## 4. Recovery

`recoverStuckJobs()` in `jobs/recovery.ts` runs a single `updateMany`:

```ts
const result = await prisma.job.updateMany({
  where: {
    status: 'RUNNING',
    OR: [
      { heartbeatAt: null },
      { heartbeatAt: { lt: new Date(Date.now() - STALE_HEARTBEAT_MS) } },
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
```

No Analysis / AddonRun recovery here — those models don't exist yet; their recovery attaches to this function (or its callers) in phases 6 / 7 when they land.

---

## 5. Boot wiring

`bootstrap/start-job-runner.ts`:

```ts
import { recoverStuckJobs } from '../jobs/recovery';
import { runner } from '../jobs/runner';
import logger from '../config/logger';

export async function startJobRunner(): Promise<void> {
  const reaped = await recoverStuckJobs();
  logger.info('jobs.runner.starting', { reaped });
  runner.start();
}
```

`src/index.ts` calls it after `ensureUploads()`, before `app.listen()`.

On SIGTERM / SIGINT (dev-only for now), `runner.stop()` is awaited before process exit — prevents orphaned RUNNING rows when nodemon restarts. Implementation: `process.on('SIGINT', async () => { await runner.stop(); process.exit(0); })` + same for SIGTERM, wired in `src/index.ts`.

---

## 6. Testing

### 6.1 Unit (`jobs/runner.test.ts`, `jobs/recovery.test.ts`)

`runner.test.ts` (Prisma fully mocked via `jest.mock`):
- `enqueue` creates a PENDING row with the provided fields
- `cancel` on PENDING → CANCELLED
- `cancel` on RUNNING → CANCELLED with a log
- `cancel` on terminal → no-op
- Worker loop: when the raw-query pickup returns a row, transitions it RUNNING then COMPLETED via the registered handler. Uses a controllable handler stub.
- Handler throws → row transitions FAILED with the error message.
- Missing handler → row transitions FAILED with `"no handler registered for <type>"`.
- Heartbeat fires on a fake timer during handler execution.

`recovery.test.ts` (Prisma mocked):
- Calls `prisma.job.updateMany` with the expected `where` clause (null OR stale heartbeat).
- Returns the affected count.

### 6.2 Integration (`jobs.integration.test.ts`, real DB)

- Seed a `Job` row with `status='RUNNING'`, `heartbeatAt=null`.
- Call `recoverStuckJobs()`.
- Assert: row is `FAILED`, `errorMessage='interrupted by server restart'`, `completedAt` set.
- Seed a fresh RUNNING job with `heartbeatAt=now` → `recoverStuckJobs()` leaves it alone.
- Seed a fresh PENDING job → `recoverStuckJobs()` leaves it alone.

The integration test does NOT boot the full `runner.start()` loop — keeping tests deterministic; worker-loop behavior is owned by unit tests with mocks.

---

## 7. Process / branching

- Branches cut:
  - Main repo `feat/buildcheck-phase-3` off `feat/buildcheck-phase-2`
  - Server submodule `feat/buildcheck-phase-3` off server `feat/buildcheck-phase-2`
- No client branch (phase 3 has no client work).
- PRs target per precedent: server → `main`, main repo → `integration/buildcheck`.

---

## 8. Risks & non-goals

- **Single-process worker.** v1 runs one worker in the Node process. `FOR UPDATE SKIP LOCKED` keeps this safe if a second worker is added later, but concurrency is not a v1 goal. If we deploy multiple instances before phase 3's swap to BullMQ, expect duplicate processing of in-flight jobs *only if* the DB can't honor the lock (it can — Postgres).
- **Stop-on-shutdown is best-effort.** The SIGTERM/SIGINT hook waits for in-flight handlers to finish naturally. A hard `kill -9` still leaves RUNNING rows; the boot-time reaper cleans them on next start. Reaping threshold is 30 s — accept that a freshly-killed job stays "RUNNING" in the dashboard for up to 30 s before recovery flips it (next start of the server happens well before that in practice, since the reaper runs at boot).
- **Handler registry is global, singleton.** Fine for v1. Testability: unit tests override handlers by poking the registry directly. Not elegant but avoids over-designing IoC for a v1 runner.
- **No retry/backoff.** Handlers are expected to be idempotent (per §10.3 of parent spec). Failed jobs stay FAILED until (future) admin requeues them.
