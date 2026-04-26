import logger from '../config/logger';
import { recoverStuckJobs } from '../jobs/recovery';
import { runner } from '../jobs/runner';

export async function startJobRunner(): Promise<void> {
    const reaped = await recoverStuckJobs();
    logger.info('jobs.runner.starting', { reaped });
    runner.start();
}
