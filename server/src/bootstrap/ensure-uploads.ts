import logger from '../config/logger';
import { ensureStorageDirs } from '../integrations/storage.client';

export async function ensureUploads(): Promise<void> {
    await ensureStorageDirs();
    logger.info('uploads.ready', { event: 'uploads.ready' });
}
