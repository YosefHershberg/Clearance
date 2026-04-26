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
