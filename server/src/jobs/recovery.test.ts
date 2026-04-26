import { recoverStuckJobs, STALE_HEARTBEAT_MS } from './recovery';
import prisma from '../config/prisma';

jest.mock('../config/prisma', () => ({
    __esModule: true,
    default: {
        job: { updateMany: jest.fn() },
    },
}));

const mockedUpdateMany = prisma.job.updateMany as jest.MockedFunction<typeof prisma.job.updateMany>;

describe('recoverStuckJobs', () => {
    beforeEach(() => jest.clearAllMocks());

    it('returns the count of affected rows', async () => {
        mockedUpdateMany.mockResolvedValueOnce({ count: 3 });
        const count = await recoverStuckJobs();
        expect(count).toBe(3);
    });

    it('targets RUNNING rows with null or stale heartbeat', async () => {
        mockedUpdateMany.mockResolvedValueOnce({ count: 0 });
        const before = Date.now();
        await recoverStuckJobs();
        const call = mockedUpdateMany.mock.calls[0][0];
        expect(call.where?.status).toBe('RUNNING');
        const or = call.where?.OR as Array<{ heartbeatAt: unknown }>;
        expect(or).toHaveLength(2);
        expect(or[0]).toEqual({ heartbeatAt: null });
        const staleClause = or[1].heartbeatAt as { lt: Date };
        expect(staleClause.lt).toBeInstanceOf(Date);
        const cutoffMs = staleClause.lt.getTime();
        expect(cutoffMs).toBeGreaterThanOrEqual(before - STALE_HEARTBEAT_MS - 50);
        expect(cutoffMs).toBeLessThanOrEqual(Date.now() - STALE_HEARTBEAT_MS + 50);
    });

    it('marks reaped rows FAILED with the expected message', async () => {
        mockedUpdateMany.mockResolvedValueOnce({ count: 1 });
        await recoverStuckJobs();
        const call = mockedUpdateMany.mock.calls[0][0];
        expect(call.data).toMatchObject({
            status: 'FAILED',
            errorMessage: 'interrupted by server restart',
        });
        expect(call.data?.completedAt).toBeInstanceOf(Date);
    });
});
