import request from 'supertest';
import fs from 'node:fs/promises';
import path from 'node:path';
import app from '../../app';
import prisma from '../../config/prisma';
import env from '../../utils/env';
import { truncateAll } from '../../test-helpers/db';
import { hash } from '../../integrations/password';

jest.mock(
    '../../config/loginRateLimit',
    () =>
        (_req: unknown, _res: unknown, next: () => void) =>
            next(),
);

beforeEach(async () => {
    await truncateAll();
});

afterAll(async () => {
    await prisma.$disconnect();
});

async function loginAs(
    email: string,
    password: string,
    role: 'USER' | 'ADMIN' = 'USER',
) {
    const user = await prisma.user.create({
        data: {
            email,
            name: email,
            passwordHash: await hash(password),
            role,
        },
    });
    const agent = request.agent(app);
    await agent
        .post('/api/auth/login')
        .send({ email, password })
        .expect(200);
    return { agent, user };
}

async function seedSheetForOwner(ownerId: string, opts: { onDisk?: boolean } = { onDisk: true }) {
    const project = await prisma.project.create({
        data: { ownerId, name: 'p' },
    });
    const dxfSF = await prisma.storedFile.create({
        data: {
            kind: 'DXF',
            uri: 'uploads/dxf/t.dxf',
            originalName: 't.dxf',
            sha256: 'a'.repeat(64),
            sizeBytes: 1000,
        },
    });
    const dxf = await prisma.dxfFile.create({
        data: {
            projectId: project.id,
            storedFileId: dxfSF.id,
            extractionStatus: 'COMPLETED',
        },
    });

    const relUri = `uploads/renders/${dxf.id}/render_01.svg`;
    const absUri = path.resolve(relUri);
    if (opts.onDisk !== false) {
        await fs.mkdir(path.dirname(absUri), { recursive: true });
        await fs.writeFile(absUri, '<svg>hello</svg>');
    }

    const sf = await prisma.storedFile.create({
        data: {
            kind: 'RENDER',
            uri: relUri,
            originalName: 'render_01.svg',
            sha256: 'b'.repeat(64),
            sizeBytes: 18,
        },
    });
    const sheet = await prisma.sheetRender.create({
        data: {
            dxfFileId: dxf.id,
            storedFileId: sf.id,
            sheetIndex: 1,
            displayName: 's1',
            classification: 'FLOOR_PLAN',
        },
    });

    return { project, dxf, sheet, absUri };
}

async function cleanupRender(absUri: string) {
    await fs
        .rm(path.dirname(absUri), { recursive: true, force: true })
        .catch(() => {});
}

describe('/api/renders (integration)', () => {
    it('200 + correct headers + bytes when owner requests their sheet', async () => {
        const { agent, user } = await loginAs('owner1@test.com', 'password123');
        const { dxf, absUri } = await seedSheetForOwner(user.id);

        const res = await agent
            .get(`/api/renders/${dxf.id}/render_01.svg`)
            .buffer(true)
            .parse((r, cb) => {
                const chunks: Buffer[] = [];
                r.on('data', (c: Buffer) => chunks.push(c));
                r.on('end', () => cb(null, Buffer.concat(chunks)));
            });
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('image/svg+xml');
        expect(res.headers['cache-control']).toContain('immutable');
        expect(res.headers['cache-control']).toContain('max-age=31536000');
        expect((res.body as Buffer).toString('utf-8')).toBe('<svg>hello</svg>');

        await cleanupRender(absUri);
    });

    it("admin can access any project's sheet", async () => {
        const { user: owner } = await loginAs('owner2@test.com', 'password123');
        const { agent: adminAgent } = await loginAs(
            'admin1@test.com',
            'password123',
            'ADMIN',
        );
        const { dxf, absUri } = await seedSheetForOwner(owner.id);

        const res = await adminAgent.get(
            `/api/renders/${dxf.id}/render_01.svg`,
        );
        expect(res.status).toBe(200);

        await cleanupRender(absUri);
    });

    it('403 when non-owner non-admin USER requests', async () => {
        const { user: owner } = await loginAs('owner3@test.com', 'password123');
        const { agent: otherAgent } = await loginAs(
            'other@test.com',
            'password123',
        );
        const { dxf, absUri } = await seedSheetForOwner(owner.id);

        const res = await otherAgent.get(
            `/api/renders/${dxf.id}/render_01.svg`,
        );
        expect(res.status).toBe(403);

        await cleanupRender(absUri);
    });

    it('401 when unauthenticated', async () => {
        const { user: owner } = await loginAs('owner4@test.com', 'password123');
        const { dxf, absUri } = await seedSheetForOwner(owner.id);

        const res = await request(app).get(
            `/api/renders/${dxf.id}/render_01.svg`,
        );
        expect(res.status).toBe(401);

        await cleanupRender(absUri);
    });

    it('400 when filename does not match render_<digits>.svg regex', async () => {
        const { agent, user } = await loginAs('owner5@test.com', 'password123');
        const { dxf, absUri } = await seedSheetForOwner(user.id);

        const res = await agent.get(`/api/renders/${dxf.id}/not_a_render.svg`);
        expect(res.status).toBe(400);

        await cleanupRender(absUri);
    });

    it('404 when DB sheet exists but disk file missing', async () => {
        const { agent, user } = await loginAs('owner6@test.com', 'password123');
        const { dxf, absUri } = await seedSheetForOwner(user.id, {
            onDisk: false,
        });

        const res = await agent.get(`/api/renders/${dxf.id}/render_01.svg`);
        expect(res.status).toBe(404);

        await cleanupRender(absUri);
    });

    it('404 when dxfFile soft-deleted', async () => {
        const { agent, user } = await loginAs('owner7@test.com', 'password123');
        const { dxf, absUri } = await seedSheetForOwner(user.id);

        await prisma.dxfFile.update({
            where: { id: dxf.id },
            data: { deletedAt: new Date() },
        });

        const res = await agent.get(`/api/renders/${dxf.id}/render_01.svg`);
        expect(res.status).toBe(404);

        await cleanupRender(absUri);
    });

    it('404 when sheet with that filename does not exist', async () => {
        const { agent, user } = await loginAs('owner8@test.com', 'password123');
        const { dxf, absUri } = await seedSheetForOwner(user.id);

        const res = await agent.get(`/api/renders/${dxf.id}/render_99.svg`);
        expect(res.status).toBe(404);

        await cleanupRender(absUri);
    });
});
