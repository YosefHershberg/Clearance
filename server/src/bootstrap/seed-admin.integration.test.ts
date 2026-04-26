import { seedAdmin } from './seed-admin';
import { findUserByEmail } from '../api/data-access/user.da';
import { truncateAll } from '../test-helpers/db';
import { compare } from '../integrations/password';
import prisma from '../config/prisma';
import env from '../utils/env';

beforeEach(async () => {
    await truncateAll();
});

afterAll(async () => {
    await prisma.$disconnect();
});

describe('seedAdmin (integration)', () => {
    it('creates the admin when no user with ADMIN_EMAIL exists', async () => {
        await seedAdmin();
        const u = await findUserByEmail(env.ADMIN_EMAIL);
        expect(u).not.toBeNull();
        expect(u!.role).toBe('ADMIN');
        expect(u!.isActive).toBe(true);
        expect(await compare(env.ADMIN_INITIAL_PASSWORD, u!.passwordHash)).toBe(true);
    });

    it('is idempotent when the admin already exists with correct role and active state', async () => {
        await seedAdmin();
        const first = await findUserByEmail(env.ADMIN_EMAIL);
        await seedAdmin();
        const second = await findUserByEmail(env.ADMIN_EMAIL);
        expect(second!.id).toBe(first!.id);
        expect(second!.passwordHash).toBe(first!.passwordHash); // never overwrites
    });

    it('repairs drift — promotes a USER row with ADMIN_EMAIL back to ADMIN + active', async () => {
        await prisma.user.create({
            data: {
                email: env.ADMIN_EMAIL,
                name: 'Drifted',
                passwordHash: 'not-touched',
                role: 'USER',
                isActive: false,
            },
        });
        await seedAdmin();
        const u = await findUserByEmail(env.ADMIN_EMAIL);
        expect(u!.role).toBe('ADMIN');
        expect(u!.isActive).toBe(true);
        expect(u!.passwordHash).toBe('not-touched'); // never overwrites passwordHash
    });
});
