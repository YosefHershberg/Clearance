import prisma from '../config/prisma';
import { truncateAll } from '../test-helpers/db';
import { recoverStuckJobs } from './recovery';

beforeEach(async () => {
    await truncateAll();
});

afterAll(async () => {
    await prisma.$disconnect();
});

describe('recoverStuckJobs (integration)', () => {
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

    it('leaves PENDING jobs alone', async () => {
        await prisma.job.create({
            data: { type: 'DXF_EXTRACTION', status: 'PENDING', payload: {} },
        });
        const count = await recoverStuckJobs();
        expect(count).toBe(0);
    });
});
