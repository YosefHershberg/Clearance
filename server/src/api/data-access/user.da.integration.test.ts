import {
    createUser,
    findUserByEmail,
    findUserById,
    updateUserPassword,
    setUserActive,
    deleteUserById,
    listUsers,
} from './user.da';
import { truncateAll } from '../../test-helpers/db';
import prisma from '../../config/prisma';

beforeEach(async () => {
    await truncateAll();
});

afterAll(async () => {
    await prisma.$disconnect();
});

describe('user.da (integration)', () => {
    it('createUser inserts and returns the row', async () => {
        const u = await createUser({
            email: 'a@example.com',
            name: 'A',
            passwordHash: 'h',
            role: 'USER',
        });
        expect(u.id).toEqual(expect.any(String));
        expect(u.email).toBe('a@example.com');
        expect(u.role).toBe('USER');
        expect(u.isActive).toBe(true);
    });

    it('findUserByEmail returns the user or null', async () => {
        await createUser({ email: 'a@example.com', name: 'A', passwordHash: 'h', role: 'USER' });
        expect(await findUserByEmail('a@example.com')).not.toBeNull();
        expect(await findUserByEmail('missing@example.com')).toBeNull();
    });

    it('findUserById returns the user or null', async () => {
        const u = await createUser({ email: 'a@example.com', name: 'A', passwordHash: 'h', role: 'USER' });
        expect(await findUserById(u.id)).not.toBeNull();
        expect(await findUserById('missing')).toBeNull();
    });

    it('updateUserPassword updates passwordHash', async () => {
        const u = await createUser({ email: 'a@example.com', name: 'A', passwordHash: 'old', role: 'USER' });
        await updateUserPassword(u.id, 'new');
        const after = await findUserById(u.id);
        expect(after!.passwordHash).toBe('new');
    });

    it('setUserActive toggles isActive', async () => {
        const u = await createUser({ email: 'a@example.com', name: 'A', passwordHash: 'h', role: 'USER' });
        await setUserActive(u.id, false);
        expect((await findUserById(u.id))!.isActive).toBe(false);
        await setUserActive(u.id, true);
        expect((await findUserById(u.id))!.isActive).toBe(true);
    });

    it('deleteUserById removes the row', async () => {
        const u = await createUser({ email: 'a@example.com', name: 'A', passwordHash: 'h', role: 'USER' });
        await deleteUserById(u.id);
        expect(await findUserById(u.id)).toBeNull();
    });

    it('listUsers paginates by createdAt cursor and filters by q', async () => {
        await createUser({ email: 'alice@ex.com', name: 'Alice', passwordHash: 'h', role: 'USER' });
        await createUser({ email: 'bob@ex.com',   name: 'Bob',   passwordHash: 'h', role: 'USER' });
        await createUser({ email: 'carol@ex.com', name: 'Carol', passwordHash: 'h', role: 'USER' });

        const page1 = await listUsers({ limit: 2 });
        expect(page1.users.length).toBe(2);
        expect(page1.nextCursor).toEqual(expect.any(String));

        const page2 = await listUsers({ limit: 2, cursor: page1.nextCursor! });
        expect(page2.users.length).toBe(1);
        expect(page2.nextCursor).toBeNull();

        const filtered = await listUsers({ limit: 10, q: 'ali' });
        expect(filtered.users.length).toBe(1);
        expect(filtered.users[0].name).toBe('Alice');
    });
});
