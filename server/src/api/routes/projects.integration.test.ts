import request from 'supertest';
import app from '../../app';
import { truncateAll } from '../../test-helpers/db';

jest.mock('../../config/loginRateLimit', () => (_req: unknown, _res: unknown, next: () => void) => next());
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
    const user = await daCreate({ email, name: email, passwordHash, role: 'USER' });
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email, password }).expect(200);
    return { agent, user };
}

describe('/api/projects (integration)', () => {
    it('rejects unauthenticated', async () => {
        const res = await request(app).get('/api/projects');
        expect(res.status).toBe(401);
    });

    describe('POST /api/projects', () => {
        it('USER creates a project and sees it in their list', async () => {
            const { agent } = await userAgent('u1@ex.com', 'password123');
            const create = await agent
                .post('/api/projects')
                .send({ name: 'Alpha', description: 'desc', locality: 'Tel Aviv' })
                .expect(201);
            expect(create.body.data.project.name).toBe('Alpha');
            const list = await agent.get('/api/projects').expect(200);
            expect(list.body.data.projects.length).toBe(1);
            expect(list.body.data.projects[0].name).toBe('Alpha');
        });

        it('400 on missing name', async () => {
            const { agent } = await userAgent('u1@ex.com', 'password123');
            const res = await agent.post('/api/projects').send({ description: 'no name' });
            expect(res.status).toBe(400);
        });
    });

    describe('visibility', () => {
        async function seedTwoUsersWithProjects() {
            const userA = await userAgent('a@ex.com', 'password123');
            await userA.agent.post('/api/projects').send({ name: 'A-proj' }).expect(201);
            const userB = await userAgent('b@ex.com', 'password123');
            await userB.agent.post('/api/projects').send({ name: 'B-proj' }).expect(201);
            return { userA, userB };
        }

        it('USER sees only own projects', async () => {
            const { userA } = await seedTwoUsersWithProjects();
            const res = await userA.agent.get('/api/projects').expect(200);
            const names = res.body.data.projects.map((p: { name: string }) => p.name);
            expect(names).toEqual(['A-proj']);
        });

        it('USER with ?all=true still sees only own projects', async () => {
            const { userA } = await seedTwoUsersWithProjects();
            const res = await userA.agent.get('/api/projects?all=true').expect(200);
            const names = res.body.data.projects.map((p: { name: string }) => p.name);
            expect(names).toEqual(['A-proj']);
        });

        it('ADMIN with ?all=true sees projects from all owners', async () => {
            await seedTwoUsersWithProjects();
            const agent = await adminAgent();
            const res = await agent.get('/api/projects?all=true').expect(200);
            const names = res.body.data.projects.map((p: { name: string }) => p.name).sort();
            expect(names).toEqual(['A-proj', 'B-proj']);
        });

        it('ADMIN without ?all=true sees only their own (none by default)', async () => {
            await seedTwoUsersWithProjects();
            const agent = await adminAgent();
            const res = await agent.get('/api/projects').expect(200);
            expect(res.body.data.projects).toEqual([]);
        });
    });

    describe('GET /api/projects/:id', () => {
        it('403 for cross-owner as USER', async () => {
            const userA = await userAgent('a@ex.com', 'password123');
            const created = await userA.agent.post('/api/projects').send({ name: 'A' }).expect(201);
            const projectId = created.body.data.project.id;
            const userB = await userAgent('b@ex.com', 'password123');
            const res = await userB.agent.get(`/api/projects/${projectId}`);
            expect(res.status).toBe(403);
        });

        it('200 for admin viewing another user\'s project', async () => {
            const userA = await userAgent('a@ex.com', 'password123');
            const created = await userA.agent.post('/api/projects').send({ name: 'A' }).expect(201);
            const projectId = created.body.data.project.id;
            const admin = await adminAgent();
            const res = await admin.get(`/api/projects/${projectId}`).expect(200);
            expect(res.body.data.project.id).toBe(projectId);
        });

        it('404 on unknown id', async () => {
            const { agent } = await userAgent('u@ex.com', 'password123');
            const res = await agent.get('/api/projects/does-not-exist');
            expect(res.status).toBe(404);
        });
    });

    describe('PATCH /api/projects/:id', () => {
        it('updates fields and writes audit with changed fields list', async () => {
            const { agent, user } = await userAgent('u@ex.com', 'password123');
            const created = await agent.post('/api/projects').send({ name: 'Old' }).expect(201);
            const id = created.body.data.project.id;
            await agent.patch(`/api/projects/${id}`).send({ name: 'New', locality: 'Haifa' }).expect(200);
            const audit = await prisma.auditLog.findFirst({
                where: { event: 'project.updated', entityId: id },
            });
            expect(audit).not.toBeNull();
            expect((audit!.metadata as { fields: string[] }).fields).toEqual(['name', 'locality']);
            void user;
        });

        it('400 on empty body', async () => {
            const { agent } = await userAgent('u@ex.com', 'password123');
            const created = await agent.post('/api/projects').send({ name: 'X' }).expect(201);
            const res = await agent.patch(`/api/projects/${created.body.data.project.id}`).send({});
            expect(res.status).toBe(400);
        });
    });

    describe('DELETE /api/projects/:id', () => {
        it('soft-deletes and GET returns 404 afterward', async () => {
            const { agent } = await userAgent('u@ex.com', 'password123');
            const created = await agent.post('/api/projects').send({ name: 'X' }).expect(201);
            const id = created.body.data.project.id;
            await agent.delete(`/api/projects/${id}`).expect(200);
            await agent.get(`/api/projects/${id}`).expect(404);
            const row = await prisma.project.findUnique({ where: { id } });
            expect(row?.deletedAt).not.toBeNull();
        });

        it('403 when USER deletes someone else\'s project', async () => {
            const userA = await userAgent('a@ex.com', 'password123');
            const created = await userA.agent.post('/api/projects').send({ name: 'A' }).expect(201);
            const userB = await userAgent('b@ex.com', 'password123');
            const res = await userB.agent.delete(`/api/projects/${created.body.data.project.id}`);
            expect(res.status).toBe(403);
        });

        it('ADMIN can delete any project', async () => {
            const userA = await userAgent('a@ex.com', 'password123');
            const created = await userA.agent.post('/api/projects').send({ name: 'A' }).expect(201);
            const admin = await adminAgent();
            await admin.delete(`/api/projects/${created.body.data.project.id}`).expect(200);
        });
    });

    describe('pagination', () => {
        it('?limit=1 returns a cursor and subsequent page continues', async () => {
            const { agent } = await userAgent('u@ex.com', 'password123');
            await agent.post('/api/projects').send({ name: 'P1' }).expect(201);
            await agent.post('/api/projects').send({ name: 'P2' }).expect(201);
            const first = await agent.get('/api/projects?limit=1').expect(200);
            expect(first.body.data.projects.length).toBe(1);
            expect(first.body.data.nextCursor).toBeDefined();
            const next = await agent.get(`/api/projects?limit=1&cursor=${first.body.data.nextCursor}`).expect(200);
            expect(next.body.data.projects.length).toBe(1);
            expect(next.body.data.projects[0].name).not.toBe(first.body.data.projects[0].name);
        });
    });
});
