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
                data: {
                    status: 'FAILED',
                    errorMessage: message,
                    completedAt: new Date(),
                    heartbeatAt: new Date(),
                },
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
