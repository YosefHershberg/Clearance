import request from 'supertest';
import app from '../../app';
import { createUser } from '../data-access/user.da';
import { truncateAll } from '../../test-helpers/db';
import { hash } from '../../integrations/password';
import { seedAdmin } from '../../bootstrap/seed-admin';
import prisma from '../../config/prisma';

beforeEach(async () => {
    await truncateAll();
    await seedAdmin();
});

afterAll(async () => {
    await prisma.$disconnect();
});

describe('/api/auth (integration)', () => {
    async function createTestUser(overrides: Partial<{ email: string; password: string; active: boolean }> = {}) {
        const email = overrides.email ?? `t-${Date.now()}@ex.com`;
        const password = overrides.password ?? 'password123';
        const u = await createUser({
            email,
            name: 'Test',
            passwordHash: await hash(password),
            role: 'USER',
        });
        if (overrides.active === false) {
            await prisma.user.update({ where: { id: u.id }, data: { isActive: false } });
        }
        return { user: u, email, password };
    }

    it('POST /login returns user + sets auth cookie on valid credentials', async () => {
        const { email, password, user } = await createTestUser();
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email, password });
        expect(res.status).toBe(200);
        expect(res.body.data.user).toMatchObject({ id: user.id, email, role: 'USER' });
        const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
        expect(Array.isArray(setCookie)).toBe(true);
        expect(setCookie!.join(';')).toMatch(/auth=[^;]+/);
        expect(setCookie!.join(';')).toMatch(/HttpOnly/i);
        expect(setCookie!.join(';')).toMatch(/SameSite=Strict/i);
    });

    it('POST /login returns 401 with generic message on wrong password', async () => {
        const { email } = await createTestUser({ password: 'right' });
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email, password: 'wrong' });
        expect(res.status).toBe(401);
        expect(res.body.message).toBe('Invalid credentials');
    });

    it('POST /login returns 401 for inactive user (same generic message)', async () => {
        const { email, password } = await createTestUser({ active: false });
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email, password });
        expect(res.status).toBe(401);
        expect(res.body.message).toBe('Invalid credentials');
    });

    it('GET /me returns 401 without cookie', async () => {
        const res = await request(app).get('/api/auth/me');
        expect(res.status).toBe(401);
    });

    it('full round-trip: login → GET /me → logout', async () => {
        const { email, password, user } = await createTestUser();
        const agent = request.agent(app);
        await agent.post('/api/auth/login').send({ email, password }).expect(200);
        const meRes = await agent.get('/api/auth/me').expect(200);
        expect(meRes.body.data.user.id).toBe(user.id);
        const logoutRes = await agent.post('/api/auth/logout').expect(200);
        expect(logoutRes.body.data.ok).toBe(true);
        // cookie cleared; next /me should 401
        await agent.get('/api/auth/me').expect(401);
    });

    it('POST /change-password requires auth', async () => {
        const res = await request(app)
            .post('/api/auth/change-password')
            .send({ currentPassword: 'x', newPassword: 'yyyyyyyy' });
        expect(res.status).toBe(401);
    });

    it('POST /change-password rejects invalid current password', async () => {
        const { email, password } = await createTestUser();
        const agent = request.agent(app);
        await agent.post('/api/auth/login').send({ email, password });
        const res = await agent
            .post('/api/auth/change-password')
            .send({ currentPassword: 'wrong', newPassword: 'newpass123' });
        expect(res.status).toBe(401);
    });

    it('POST /change-password updates the password', async () => {
        const { email, password } = await createTestUser();
        const agent = request.agent(app);
        await agent.post('/api/auth/login').send({ email, password });
        await agent
            .post('/api/auth/change-password')
            .send({ currentPassword: password, newPassword: 'replaced-pw-123' })
            .expect(200);
        // old password no longer works
        await request(app).post('/api/auth/login').send({ email, password }).expect(401);
        // new password works
        await request(app)
            .post('/api/auth/login')
            .send({ email, password: 'replaced-pw-123' })
            .expect(200);
    });
});
