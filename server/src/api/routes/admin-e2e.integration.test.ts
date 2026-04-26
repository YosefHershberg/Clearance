import request from 'supertest';
import app from '../../app';
import { truncateAll } from '../../test-helpers/db';

jest.mock('../../config/loginRateLimit', () => (req: any, res: any, next: any) => next());

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

describe('admin e2e flow (integration)', () => {
    it('admin creates user → user logs in → admin disables → user 401 on /me', async () => {
        // Admin logs in
        const admin = request.agent(app);
        await admin.post('/api/auth/login').send({
            email: env.ADMIN_EMAIL,
            password: env.ADMIN_INITIAL_PASSWORD,
        }).expect(200);

        // Admin creates a USER
        const create = await admin
            .post('/api/admin/users')
            .send({ email: 'e2e@ex.com', name: 'E2E', initialPassword: 'pw12345678' })
            .expect(201);
        const userId = create.body.data.user.id;

        // User logs in with the initialPassword
        const user = request.agent(app);
        await user.post('/api/auth/login').send({
            email: 'e2e@ex.com',
            password: 'pw12345678',
        }).expect(200);
        await user.get('/api/auth/me').expect(200);

        // Admin disables the user
        await admin.patch(`/api/admin/users/${userId}/active`).send({ isActive: false }).expect(200);

        // User's next authed request 401s (approach 2 — DB lookup per request)
        await user.get('/api/auth/me').expect(401);

        // Audit log records the disable event
        const logs = await prisma.auditLog.findMany({
            where: { event: 'admin.user_disabled', entityId: userId },
        });
        expect(logs.length).toBe(1);
    });

    it('admin GET /stats returns userCount 2 after creating one user', async () => {
        const admin = request.agent(app);
        await admin.post('/api/auth/login').send({
            email: env.ADMIN_EMAIL,
            password: env.ADMIN_INITIAL_PASSWORD,
        }).expect(200);
        await admin
            .post('/api/admin/users')
            .send({ email: 's@ex.com', name: 'S', initialPassword: 'pw12345678' })
            .expect(201);
        const res = await admin.get('/api/admin/stats').expect(200);
        expect(res.body.data).toEqual({ userCount: 2, projectCount: 0, analysisCount: 0 });
    });
});
