import { getStats } from './admin-stats.service';
import prisma from '../../config/prisma';

jest.mock('../../config/prisma', () => ({
    __esModule: true,
    default: {
        user: { count: jest.fn() },
    },
}));

const mockedCount = (prisma.user.count as unknown as jest.Mock);

describe('admin-stats.service', () => {
    afterEach(() => jest.clearAllMocks());

    it('returns userCount from prisma and 0 for the deferred counts', async () => {
        mockedCount.mockResolvedValueOnce(7);
        const s = await getStats();
        expect(s).toEqual({ userCount: 7, projectCount: 0, analysisCount: 0 });
    });
});
