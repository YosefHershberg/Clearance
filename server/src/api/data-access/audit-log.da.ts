import prisma from '../../config/prisma';
import type { AuditLog, Prisma } from '../../generated/prisma/client';

export type InsertAuditLogInput = {
    actorId?: string | null;
    event: string;
    entity?: string | null;
    entityId?: string | null;
    metadata?: Prisma.InputJsonValue;
};

export async function insertAuditLog(input: InsertAuditLogInput): Promise<AuditLog> {
    return prisma.auditLog.create({
        data: {
            actorId: input.actorId ?? null,
            event: input.event,
            entity: input.entity ?? null,
            entityId: input.entityId ?? null,
            metadata: input.metadata,
        },
    });
}

export async function findAuditLogsByEntity(entity: string, entityId: string): Promise<AuditLog[]> {
    return prisma.auditLog.findMany({
        where: { entity, entityId },
        orderBy: { createdAt: 'desc' },
    });
}
