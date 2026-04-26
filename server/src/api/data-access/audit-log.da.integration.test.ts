import { insertAuditLog, findAuditLogsByEntity } from './audit-log.da';
import { truncateAll } from '../../test-helpers/db';
import prisma from '../../config/prisma';

beforeEach(async () => {
    await truncateAll();
});

afterAll(async () => {
    await prisma.$disconnect();
});

describe('audit-log.da (integration)', () => {
    it('insertAuditLog inserts a row', async () => {
        const log = await insertAuditLog({
            actorId: 'actor-1',
            event: 'test.event',
            entity: 'User',
            entityId: 'u-1',
            metadata: { foo: 'bar' },
        });
        expect(log.id).toEqual(expect.any(String));
        expect(log.event).toBe('test.event');
    });

    it('findAuditLogsByEntity filters by entity + entityId', async () => {
        await insertAuditLog({ event: 'a', entity: 'User', entityId: 'u-1' });
        await insertAuditLog({ event: 'b', entity: 'User', entityId: 'u-2' });
        await insertAuditLog({ event: 'c', entity: 'Project', entityId: 'p-1' });
        const rows = await findAuditLogsByEntity('User', 'u-1');
        expect(rows.length).toBe(1);
        expect(rows[0].event).toBe('a');
    });
});
