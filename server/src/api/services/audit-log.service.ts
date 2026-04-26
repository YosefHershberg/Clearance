import { insertAuditLog } from '../data-access/audit-log.da';
import logger from '../../config/logger';
import type { InsertAuditLogInput } from '../data-access/audit-log.da';

export async function record(input: InsertAuditLogInput): Promise<void> {
    try {
        await insertAuditLog(input);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('audit-log.write_failed', {
            event: input.event,
            actorId: input.actorId,
            entity: input.entity,
            entityId: input.entityId,
            error: message,
        });
    }
}
