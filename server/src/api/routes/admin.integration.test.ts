import request from 'supertest';
import app from '../../app';
import { truncateAll } from '../../test-helpers/db';

jest.mock('../../config/loginRateLimit', () => (req: any, res: any, next: any) => next());
import { createUser as daCreate } from '../data-access/user.da';
import { hash } from '../../integrations/password';
import { seedAdmin } from '../../bootstrap/seed-admin';
import prisma from '../../config/prisma';
import env from '../../utils/env';

beforeEach(async () => {
    await truncateAll();
    await seedAdmin();
});

afterAll(async () => {
    await prisma.$disconnect();
});

async function adminAgent() {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({
        email: env.ADMIN_EMAIL,
        password: env.ADMIN_INITIAL_PASSWORD,
    }).expect(200);
    return agent;
}

async function userAgent(email: string, password: string) {
    const passwordHash = await hash(password);
    await daCreate({ email, name: email, passwordHash, role: 'USER' });
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email, password }).expect(200);
    return agent;
}

describe('/api/admin (integration)', () => {
    it('rejects unauthenticated', async () => {
        const res = await request(app).get('/api/admin/users');
        expect(res.status).toBe(401);
    });

    it('rejects USER with 403', async () => {
        const agent = await userAgent('u@ex.com', 'password123');
        const res = await agent.get('/api/admin/users');
        expect(res.status).toBe(403);
    });

    describe('as ADMIN', () => {
        it('GET /users lists the admin itself (no other users yet)', async () => {
            const agent = await adminAgent();
            const res = await agent.get('/api/admin/users').expect(200);
            expect(res.body.data.users.length).toBe(1);
            expect(res.body.data.users[0].role).toBe('ADMIN');
        });

        it('POST /users creates a USER (never ADMIN even if role is smuggled)', async () => {
            const agent = await adminAgent();
            const res = await agent
                .post('/api/admin/users')
                .send({ email: 'new@ex.com', name: 'New', initialPassword: 'pw12345678', role: 'ADMIN' });
            // strictObject rejects the extra `role` field with 400
            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Invalid data');

            // Without the stray field, create succeeds as USER
            const ok = await agent
                .post('/api/admin/users')
                .send({ email: 'new@ex.com', name: 'New', initialPassword: 'pw12345678' })
                .expect(201);
            expect(ok.body.data.user.role).toBe('USER');
        });

        it('POST /users 409 on duplicate email', async () => {
            const agent = await adminAgent();
            await agent
                .post('/api/admin/users')
                .send({ email: 'dup@ex.com', name: 'D', initialPassword: 'pw12345678' })
                .expect(201);
            const res = await agent
                .post('/api/admin/users')
                .send({ email: 'dup@ex.com', name: 'D2', initialPassword: 'pw12345678' });
            expect(res.status).toBe(409);
            expect(res.body.message).toBe('email_in_use');
        });

        it('DELETE /users/:id refuses to delete an ADMIN target with admin_target_forbidden', async () => {
            const agent = await adminAgent();
            const adminRow = await prisma.user.findUnique({ where: { email: env.ADMIN_EMAIL } });
            const res = await agent.delete(`/api/admin/users/${adminRow!.id}`);
            expect(res.status).toBe(403);
            expect(res.body.message).toBe('admin_target_forbidden');
        });

        it('DELETE /users/:id happy path removes a USER', async () => {
            const agent = await adminAgent();
            const created = await agent
                .post('/api/admin/users')
                .send({ email: 'del@ex.com', name: 'D', initialPassword: 'pw12345678' })
                .expect(201);
            const id = created.body.data.user.id;
            await agent.delete(`/api/admin/users/${id}`).expect(200);
            expect(await prisma.user.findUnique({ where: { id } })).toBeNull();
        });

        it('PATCH /users/:id/active disables and re-enables', async () => {
            const agent = await adminAgent();
            const created = await agent
                .post('/api/admin/users')
                .send({ email: 'toggle@ex.com', name: 'T', initialPassword: 'pw12345678' })
                .expect(201);
            const id = created.body.data.user.id;
            const disabled = await agent
                .patch(`/api/admin/users/${id}/active`)
                .send({ isActive: false })
                .expect(200);
            expect(disabled.body.data.user.isActive).toBe(false);
            const enabled = await agent
                .patch(`/api/admin/users/${id}/active`)
                .send({ isActive: true })
                .expect(200);
            expect(enabled.body.data.user.isActive).toBe(true);
        });

        it('POST /users/:id/reset-password 403s when target is ADMIN', async () => {
            const agent = await adminAgent();
            const adminRow = await prisma.user.findUnique({ where: { email: env.ADMIN_EMAIL } });
            const res = await agent
                .post(`/api/admin/users/${adminRow!.id}/reset-password`)
                .send({ newPassword: 'newpw123456' });
            expect(res.status).toBe(403);
            expect(res.body.message).toBe('admin_target_forbidden');
        });

        it('POST /users/:id/reset-password changes a USER password', async () => {
            const agent = await adminAgent();
            const created = await agent
                .post('/api/admin/users')
                .send({ email: 'pw@ex.com', name: 'P', initialPassword: 'pw12345678' })
                .expect(201);
            const id = created.body.data.user.id;
            await agent
                .post(`/api/admin/users/${id}/reset-password`)
                .send({ newPassword: 'replaced-pw' })
                .expect(200);
            // login with old password fails
            await request(app).post('/api/auth/login').send({ email: 'pw@ex.com', password: 'pw12345678' }).expect(401);
            // login with new works
            await request(app).post('/api/auth/login').send({ email: 'pw@ex.com', password: 'replaced-pw' }).expect(200);
        });
    });
});
