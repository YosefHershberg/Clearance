import { DbPollingJobRunner } from './runner';
import { registerHandler, handlers } from './handlers';
import prisma from '../config/prisma';
import type { Job, JobType } from '../generated/prisma/client';

jest.mock('../config/prisma', () => ({
    __esModule: true,
    default: {
        job: {
            create: jest.fn(),
            update: jest.fn(),
            findUnique: jest.fn(),
        },
        $transaction: jest.fn(),
    },
}));

const mockedCreate = prisma.job.create as jest.MockedFunction<typeof prisma.job.create>;
const mockedUpdate = prisma.job.update as jest.MockedFunction<typeof prisma.job.update>;
const mockedFindUnique = prisma.job.findUnique as jest.MockedFunction<typeof prisma.job.findUnique>;
const mockedTx = prisma.$transaction as jest.MockedFunction<typeof prisma.$transaction>;

function baseJob(overrides: Partial<Job> = {}): Job {
    return {
        id: 'j1',
        type: 'DXF_EXTRACTION' as JobType,
        status: 'RUNNING',
        payload: {},
        errorMessage: null,
        attempts: 1,
        heartbeatAt: new Date(),
        projectId: null,
        analysisId: null,
        addonRunId: null,
        dxfFileId: null,
        tavaFileId: null,
        addonDocumentId: null,
        startedAt: new Date(),
        completedAt: null,
        createdAt: new Date(),
        ...overrides,
    } as Job;
}

beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(handlers) as JobType[]) {
        delete handlers[key];
    }
});

describe('DbPollingJobRunner', () => {
    describe('enqueue', () => {
        it('inserts a PENDING row with the provided fields', async () => {
            const runner = new DbPollingJobRunner();
            mockedCreate.mockResolvedValueOnce(baseJob({ status: 'PENDING' }));
            await runner.enqueue({
                type: 'DXF_EXTRACTION' as JobType,
                payload: { foo: 'bar' },
                projectId: 'p1',
                dxfFileId: 'd1',
            });
            expect(mockedCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    type: 'DXF_EXTRACTION',
                    payload: { foo: 'bar' },
                    projectId: 'p1',
                    dxfFileId: 'd1',
                }),
            });
        });
    });

    describe('cancel', () => {
        it('no-ops on missing job', async () => {
            mockedFindUnique.mockResolvedValueOnce(null);
            const runner = new DbPollingJobRunner();
            await runner.cancel('gone');
            expect(mockedUpdate).not.toHaveBeenCalled();
        });

        it('PENDING → CANCELLED', async () => {
            mockedFindUnique.mockResolvedValueOnce(baseJob({ status: 'PENDING' }));
            mockedUpdate.mockResolvedValueOnce(baseJob({ status: 'CANCELLED' }));
            const runner = new DbPollingJobRunner();
            await runner.cancel('j1');
            expect(mockedUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'j1' },
                    data: expect.objectContaining({ status: 'CANCELLED' }),
                }),
            );
        });

        it('RUNNING → CANCELLED (with update)', async () => {
            mockedFindUnique.mockResolvedValueOnce(baseJob({ status: 'RUNNING' }));
            mockedUpdate.mockResolvedValueOnce(baseJob({ status: 'CANCELLED' }));
            const runner = new DbPollingJobRunner();
            await runner.cancel('j1');
            expect(mockedUpdate).toHaveBeenCalled();
        });

        it('terminal → no-op', async () => {
            mockedFindUnique.mockResolvedValueOnce(baseJob({ status: 'COMPLETED' }));
            const runner = new DbPollingJobRunner();
            await runner.cancel('j1');
            expect(mockedUpdate).not.toHaveBeenCalled();
        });
    });

    describe('worker loop', () => {
        async function runOneIteration(
            runner: DbPollingJobRunner,
            pickupSequence: Array<Job | null>,
        ) {
            let call = 0;
            mockedTx.mockImplementation(async (fn: unknown) => {
                const next = pickupSequence[call] ?? null;
                call++;
                if (typeof fn !== 'function') return next;
                // Provide a minimal tx proxy. The loop uses tx.$queryRaw + tx.job.update.
                const txProxy = {
                    $queryRaw: async () => (next ? [next] : []),
                    job: { update: async () => next },
                };
                return await (fn as (tx: typeof txProxy) => Promise<Job | null>)(txProxy);
            });
            runner.start();
            while (call < pickupSequence.length) {
                await new Promise((r) => setImmediate(r));
            }
            await runner.stop();
        }

        it('picks up PENDING job, runs registered handler, marks COMPLETED', async () => {
            const handler = jest.fn().mockResolvedValue(undefined);
            registerHandler('DXF_EXTRACTION' as JobType, handler);
            mockedUpdate.mockResolvedValue(baseJob({ status: 'COMPLETED' }));
            const runner = new DbPollingJobRunner({ pollIntervalMs: 1, heartbeatIntervalMs: 1_000_000 });
            await runOneIteration(runner, [baseJob({ status: 'PENDING' }), null]);
            expect(handler).toHaveBeenCalledTimes(1);
            expect(mockedUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ status: 'COMPLETED' }),
                }),
            );
        });

        it('marks FAILED with the error message when handler throws', async () => {
            registerHandler('DXF_EXTRACTION' as JobType, async () => {
                throw new Error('boom');
            });
            mockedUpdate.mockResolvedValue(baseJob({ status: 'FAILED' }));
            const runner = new DbPollingJobRunner({ pollIntervalMs: 1, heartbeatIntervalMs: 1_000_000 });
            await runOneIteration(runner, [baseJob({ status: 'PENDING' }), null]);
            expect(mockedUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ status: 'FAILED', errorMessage: 'boom' }),
                }),
            );
        });

        it('marks FAILED with missing-handler message when no handler registered', async () => {
            mockedUpdate.mockResolvedValue(baseJob({ status: 'FAILED' }));
            const runner = new DbPollingJobRunner({ pollIntervalMs: 1, heartbeatIntervalMs: 1_000_000 });
            await runOneIteration(runner, [baseJob({ status: 'PENDING' }), null]);
            expect(mockedUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        status: 'FAILED',
                        errorMessage: 'no handler registered for DXF_EXTRACTION',
                    }),
                }),
            );
        });
    });
});
