import app from './app';
import env from './utils/env';
import logger from './config/logger';
import { connectToDatabase } from './config/database';
import { seedAdmin } from './bootstrap/seed-admin';
import { ensureUploads } from './bootstrap/ensure-uploads';
import { startJobRunner } from './bootstrap/start-job-runner';
import { registerHandlers } from './bootstrap/register-handlers';
import { runner } from './jobs/runner';

const port = env.PORT || 3001;

async function main() {
    await connectToDatabase();
    await seedAdmin();
    await ensureUploads();
    registerHandlers();
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
