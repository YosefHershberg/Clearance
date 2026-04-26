import prisma from '../../config/prisma';
import { findByDxfAndFilename } from './sheet-render.da';
import { truncateAll } from '../../test-helpers/db';

beforeEach(async () => {
    await truncateAll();
});

afterAll(async () => {
    await prisma.$disconnect();
});

async function seedDxfWithSheets() {
    const user = await prisma.user.create({
        data: {
            email: `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@t.com`,
            name: 't',
            passwordHash: 'h',
            role: 'USER',
        },
    });
    const project = await prisma.project.create({
        data: { ownerId: user.id, name: 'p' },
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
    const sf1 = await prisma.storedFile.create({
        data: {
            kind: 'RENDER',
            uri: `uploads/renders/${dxf.id}/render_01.svg`,
            originalName: 'render_01.svg',
            sha256: 'b'.repeat(64),
            sizeBytes: 25_000,
        },
    });
    const sf2 = await prisma.storedFile.create({
        data: {
            kind: 'RENDER',
            uri: `uploads/renders/${dxf.id}/render_02.svg`,
            originalName: 'render_02.svg',
            sha256: 'c'.repeat(64),
            sizeBytes: 22_000,
        },
    });
    const sheet1 = await prisma.sheetRender.create({
        data: {
            dxfFileId: dxf.id,
            storedFileId: sf1.id,
            sheetIndex: 1,
            displayName: 'Sheet 1',
            classification: 'FLOOR_PLAN',
        },
    });
    const sheet2 = await prisma.sheetRender.create({
        data: {
            dxfFileId: dxf.id,
            storedFileId: sf2.id,
            sheetIndex: 2,
            displayName: 'Sheet 2',
            classification: 'CROSS_SECTION',
        },
    });
    return { dxf, sheet1, sheet2, project, user };
}

describe('sheet-render.da findByDxfAndFilename (integration)', () => {
    it('returns the sheet with storedFile + dxfFile projection when filename matches', async () => {
        const { dxf, sheet1 } = await seedDxfWithSheets();
        const result = await findByDxfAndFilename(dxf.id, 'render_01.svg');
        expect(result).not.toBeNull();
        expect(result!.id).toBe(sheet1.id);
        expect(result!.sheetIndex).toBe(1);
        expect(result!.storedFile.kind).toBe('RENDER');
        expect(result!.storedFile.uri).toBe(
            `uploads/renders/${dxf.id}/render_01.svg`,
        );
        expect(result!.dxfFile.projectId).toBe(dxf.projectId);
        expect(result!.dxfFile.deletedAt).toBeNull();
    });

    it('returns null when filename does not match any sheet', async () => {
        const { dxf } = await seedDxfWithSheets();
        const result = await findByDxfAndFilename(dxf.id, 'render_99.svg');
        expect(result).toBeNull();
    });

    it('returns null when dxfFileId does not match', async () => {
        await seedDxfWithSheets();
        const result = await findByDxfAndFilename(
            'nonexistent-id',
            'render_01.svg',
        );
        expect(result).toBeNull();
    });

    it('scopes the filename match by dxfFileId (no cross-dxf leakage)', async () => {
        const { dxf } = await seedDxfWithSheets();
        // Create a second dxf with its own render_01.svg.
        const otherProject = await prisma.project.create({
            data: {
                ownerId: (
                    await prisma.user.findFirstOrThrow({
                        where: { projects: { some: { id: dxf.projectId } } },
                    })
                ).id,
                name: 'other',
            },
        });
        const otherDxfSF = await prisma.storedFile.create({
            data: {
                kind: 'DXF',
                uri: 'uploads/dxf/other.dxf',
                originalName: 'other.dxf',
                sha256: 'd'.repeat(64),
                sizeBytes: 1000,
            },
        });
        const otherDxf = await prisma.dxfFile.create({
            data: {
                projectId: otherProject.id,
                storedFileId: otherDxfSF.id,
                extractionStatus: 'COMPLETED',
            },
        });
        const otherSF = await prisma.storedFile.create({
            data: {
                kind: 'RENDER',
                uri: `uploads/renders/${otherDxf.id}/render_01.svg`,
                originalName: 'render_01.svg',
                sha256: 'e'.repeat(64),
                sizeBytes: 5_000,
            },
        });
        await prisma.sheetRender.create({
            data: {
                dxfFileId: otherDxf.id,
                storedFileId: otherSF.id,
                sheetIndex: 1,
                displayName: 'other',
                classification: 'ELEVATION',
            },
        });

        // Querying with the first dxf's id should only find the first dxf's sheet.
        const result = await findByDxfAndFilename(dxf.id, 'render_01.svg');
        expect(result).not.toBeNull();
        expect(result!.dxfFile.projectId).toBe(dxf.projectId);
        expect(result!.classification).toBe('FLOOR_PLAN');
    });
});
