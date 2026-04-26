import env from '../utils/env';
import logger from '../config/logger';
import { hash } from '../integrations/password';
import {
    findUserByEmail,
    createUser,
} from '../api/data-access/user.da';
import prisma from '../config/prisma';
import { record as auditRecord } from '../api/services/audit-log.service';

export async function seedAdmin(): Promise<void> {
    const existing = await findUserByEmail(env.ADMIN_EMAIL);

    if (!existing) {
        const passwordHash = await hash(env.ADMIN_INITIAL_PASSWORD);
        const admin = await createUser({
            email: env.ADMIN_EMAIL,
            name: env.ADMIN_EMAIL.split('@')[0],
            passwordHash,
            role: 'ADMIN',
        });
        await auditRecord({
            actorId: null,
            event: 'admin.seeded',
            entity: 'User',
            entityId: admin.id,
        });
        logger.info('admin.seeded', { adminId: admin.id, email: admin.email });
        return;
    }

    if (existing.role === 'ADMIN' && existing.isActive === true) {
        return; // no-op
    }

    // Drift: repair role + active without touching passwordHash
    await prisma.user.update({
        where: { id: existing.id },
        data: { role: 'ADMIN', isActive: true },
    });
    logger.warn('admin.drift_repaired', {
        adminId: existing.id,
        priorRole: existing.role,
        priorActive: existing.isActive,
    });
}
