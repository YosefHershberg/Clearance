import fs from 'node:fs/promises';
import path from 'node:path';
import prisma from '../../config/prisma';
import env from '../../utils/env';
import { truncateAll } from '../../test-helpers/db';

// Mock ONLY the HTTP-dependent integrations (sidecar / Anthropic / storage).
// The real Prisma client + real extraction-script.da hit the real Postgres —
// that's the point of this suite: prove the state machine wires up end-to-end
// against the actual DB schema from Cluster 1.
jest.mock('../../integrations/python-sidecar.client', () => ({
    sidecar: {
        explore: jest.fn(),
        renderThumbnails: jest.fn(),
        execute: jest.fn(),
    },
}));

jest.mock('../../integrations/anthropic.client', () => ({
    generateExtractionScript: jest.fn(),
    fixExtractionScript: jest.fn(),
    EXTRACTION_CODEGEN_SYSTEM_PROMPT: 'stub',
    computeCost: jest.fn(() => 0),
}));

jest.mock('../../integrations/storage.client', () => {
    let saveCallCount = 0;
    return {
        storage: {
            saveBuffer: jest.fn(async (_kind: string, filename: string) => {
                saveCallCount += 1;
                // Unique sha256 per call so the sha256 index stays non-colliding
                // if the same test saves multiple scripts.
                const sha256 = saveCallCount.toString(16).padStart(64, '0');
                return {
                    uri: `uploads/scripts/${filename}`,
                    sha256,
                    sizeBytes: 100,
                };
            }),
            readText: jest.fn(async () => 'broken script'),
            removeDirIfExists: jest.fn(async () => {}),
            // Unused-but-implemented to satisfy the StorageClient shape if the
            // handler ever reaches for them — keep permissive.
            writeStream: jest.fn(),
            readStream: jest.fn(),
            delete: jest.fn(),
            exists: jest.fn(),
            resolveUri: jest.fn(),
        },
    };
});

// NOTE: the real config/prisma and the real extraction-script.da are NOT
// mocked — they hit the actual DB.

import { dxfExtractionHandler } from './dxf-extraction.handler';
import { sidecar } from '../../integrations/python-sidecar.client';
import {
    generateExtractionScript,
    fixExtractionScript,
} from '../../integrations/anthropic.client';
import { storage } from '../../integrations/storage.client';

beforeEach(async () => {
    await truncateAll();
    jest.clearAllMocks();
});

afterAll(async () => {
    await prisma.$disconnect();
});

interface SeedOptions {
    status?: 'PENDING' | 'EXTRACTING';
}

async function seedDxf(options: SeedOptions = {}) {
    const user = await prisma.user.create({
        data: {
            email: `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
            name: 'Test',
            passwordHash: 'hash',
            role: 'USER',
        },
    });
    const project = await prisma.project.create({
        data: { ownerId: user.id, name: 'TestProject' },
    });
    const storedFile = await prisma.storedFile.create({
        data: {
            kind: 'DXF',
            uri: 'uploads/dxf/test.dxf',
            originalName: 'test.dxf',
            sha256: 'a'.repeat(64),
            sizeBytes: 1000,
        },
    });
    const dxf = await prisma.dxfFile.create({
        data: {
            projectId: project.id,
            storedFileId: storedFile.id,
            extractionStatus: options.status ?? 'PENDING',
        },
    });
    const job = await prisma.job.create({
        data: {
            type: 'DXF_EXTRACTION',
            dxfFileId: dxf.id,
            status: 'RUNNING',
            payload: {},
        },
    });
    return { dxf, job, project, user, storedFile };
}

describe('dxfExtractionHandler (integration)', () => {
    it('cache-miss path: runs thumbnails+codegen, caches script, populates complianceData + SheetRender rows', async () => {
        (sidecar.explore as jest.Mock).mockResolvedValue({
            explorationJson: { blocks: [] },
            structuralHash: 'integ-h1',
            ms: 100,
        });
        (sidecar.renderThumbnails as jest.Mock).mockResolvedValue({
            thumbnails: [
                { sheetKey: 'VP1', pngUri: 'tmp/a.png', dotCount: 10 },
            ],
            ms: 200,
        });
        (generateExtractionScript as jest.Mock).mockResolvedValue({
            code: 'print("ok")',
            costUsd: 0.95,
            ms: 85000,
        });

        const { dxf, job } = await seedDxf();

        // Write placeholder SVG files so computeFileSha256 can read them.
        const rendersDir = path.join(env.UPLOADS_DIR, 'renders', dxf.id);
        await fs.mkdir(rendersDir, { recursive: true });
        await fs.writeFile(
            path.join(rendersDir, 'render_01.svg'),
            'x'.repeat(30_000),
        );
        await fs.writeFile(
            path.join(rendersDir, 'render_02.svg'),
            'x'.repeat(28_000),
        );

        (sidecar.execute as jest.Mock).mockResolvedValue({
            ok: true,
            complianceData: { setbacks: { front: { value_m: 3.0 } } },
            renders: [
                {
                    filename: `uploads/renders/${dxf.id}/render_01.svg`,
                    sheetIndex: 1,
                    displayName: 'קומת קרקע',
                    classification: 'FLOOR_PLAN',
                    geometryBlock: 'VP1',
                    annotationBlock: 'VP2',
                    sizeBytes: 30_000,
                },
                {
                    filename: `uploads/renders/${dxf.id}/render_02.svg`,
                    sheetIndex: 2,
                    displayName: 'חתך A-A',
                    classification: 'CROSS_SECTION',
                    sizeBytes: 28_000,
                },
            ],
            ms: 8000,
        });

        await dxfExtractionHandler(job);

        const updated = await prisma.dxfFile.findUniqueOrThrow({
            where: { id: dxf.id },
        });
        expect(updated.extractionStatus).toBe('COMPLETED');
        expect(updated.structuralHash).toBe('integ-h1');
        expect(updated.complianceData).toEqual({
            setbacks: { front: { value_m: 3.0 } },
        });

        const cached = await prisma.extractionScript.findMany({
            where: { structuralHash: 'integ-h1' },
        });
        expect(cached).toHaveLength(1);
        expect(cached[0].generatedByModel).toBe('claude-opus-4-7');
        expect(storage.removeDirIfExists).toHaveBeenCalledWith(
            `uploads/renders/thumbs/${dxf.id}/`,
        );

        // Assert SheetRender + StoredFile(RENDER) rows were persisted.
        const sheets = await prisma.sheetRender.findMany({
            where: { dxfFileId: dxf.id },
            orderBy: { sheetIndex: 'asc' },
            include: { storedFile: true },
        });
        expect(sheets).toHaveLength(2);
        expect(sheets[0].sheetIndex).toBe(1);
        expect(sheets[0].displayName).toBe('קומת קרקע');
        expect(sheets[0].classification).toBe('FLOOR_PLAN');
        expect(sheets[0].geometryBlock).toBe('VP1');
        expect(sheets[0].annotationBlock).toBe('VP2');
        expect(sheets[0].storedFile.kind).toBe('RENDER');
        expect(sheets[0].storedFile.uri).toBe(
            `uploads/renders/${dxf.id}/render_01.svg`,
        );
        expect(sheets[0].storedFile.sizeBytes).toBe(30_000);
        expect(sheets[1].classification).toBe('CROSS_SECTION');
        expect(sheets[1].displayName).toBe('חתך A-A');

        await fs.rm(rendersDir, { recursive: true, force: true });
    });

    it('cache-hit path: skips thumbnails and codegen', async () => {
        // Seed one ExtractionScript + StoredFile for a known hash.
        const scriptFile = await prisma.storedFile.create({
            data: {
                kind: 'EXTRACTION_SCRIPT',
                uri: 'uploads/scripts/cached.py',
                originalName: 'cached.py',
                sha256: 'b'.repeat(64),
                sizeBytes: 500,
            },
        });
        await prisma.extractionScript.create({
            data: {
                structuralHash: 'integ-h1',
                storedFileId: scriptFile.id,
                generatedByModel: 'claude-opus-4-7',
                generationCostUsd: 1.0,
                generationMs: 80000,
            },
        });

        (sidecar.explore as jest.Mock).mockResolvedValue({
            explorationJson: { blocks: [] },
            structuralHash: 'integ-h1',
            ms: 100,
        });
        (sidecar.execute as jest.Mock).mockResolvedValue({
            ok: true,
            complianceData: { setbacks: {} },
            renders: [],
            ms: 8000,
        });

        const { dxf, job } = await seedDxf();
        await dxfExtractionHandler(job);

        expect(sidecar.renderThumbnails).not.toHaveBeenCalled();
        expect(generateExtractionScript).not.toHaveBeenCalled();

        const updated = await prisma.dxfFile.findUniqueOrThrow({
            where: { id: dxf.id },
        });
        expect(updated.extractionStatus).toBe('COMPLETED');
        const trace = updated.extractionTrace as { cacheHit: boolean };
        expect(trace.cacheHit).toBe(true);

        // No new script created — only the pre-seeded one.
        const scripts = await prisma.extractionScript.findMany({
            where: { structuralHash: 'integ-h1' },
        });
        expect(scripts).toHaveLength(1);
    });

    it('self-correction path: first execute crashes, fix succeeds, two ExtractionScript rows with lineage', async () => {
        (sidecar.explore as jest.Mock).mockResolvedValue({
            explorationJson: { blocks: [] },
            structuralHash: 'integ-h2',
            ms: 100,
        });
        (sidecar.renderThumbnails as jest.Mock).mockResolvedValue({
            thumbnails: [],
            ms: 10,
        });
        (generateExtractionScript as jest.Mock).mockResolvedValue({
            code: 'broken',
            costUsd: 1.0,
            ms: 80000,
        });
        (fixExtractionScript as jest.Mock).mockResolvedValue({
            code: 'fixed',
            costUsd: 0.15,
            ms: 30000,
        });
        (sidecar.execute as jest.Mock)
            .mockResolvedValueOnce({
                ok: false,
                traceback: 'RuntimeError: boom',
                ms: 2000,
            })
            .mockResolvedValueOnce({
                ok: true,
                complianceData: {},
                renders: [],
                ms: 7000,
            });

        const { dxf, job } = await seedDxf();
        await dxfExtractionHandler(job);

        const rows = await prisma.extractionScript.findMany({
            where: { structuralHash: 'integ-h2' },
            orderBy: { createdAt: 'asc' },
        });
        expect(rows).toHaveLength(2);
        // Second row is the fix; its fixedFromScriptId points to the first.
        expect(rows[1].fixedFromScriptId).toBe(rows[0].id);
        expect(rows[0].fixedFromScriptId).toBeNull();

        const updated = await prisma.dxfFile.findUniqueOrThrow({
            where: { id: dxf.id },
        });
        expect(updated.extractionStatus).toBe('COMPLETED');
    });

    it('exhausted retries: both attempts crash → FAILED, no complianceData, error populated', async () => {
        (sidecar.explore as jest.Mock).mockResolvedValue({
            explorationJson: { blocks: [] },
            structuralHash: 'integ-h3',
            ms: 100,
        });
        (sidecar.renderThumbnails as jest.Mock).mockResolvedValue({
            thumbnails: [],
            ms: 10,
        });
        (generateExtractionScript as jest.Mock).mockResolvedValue({
            code: 'broken',
            costUsd: 1.0,
            ms: 80000,
        });
        (fixExtractionScript as jest.Mock).mockResolvedValue({
            code: 'still-broken',
            costUsd: 0.15,
            ms: 30000,
        });
        (sidecar.execute as jest.Mock).mockResolvedValue({
            ok: false,
            traceback: 'RuntimeError: persistent',
            ms: 2000,
        });

        const { dxf, job } = await seedDxf();
        await expect(dxfExtractionHandler(job)).rejects.toThrow(/exhausted/);

        const updated = await prisma.dxfFile.findUniqueOrThrow({
            where: { id: dxf.id },
        });
        expect(updated.extractionStatus).toBe('FAILED');
        expect(updated.complianceData).toBeNull();
        expect(updated.extractionError).toContain('persistent');
        // Cleanup intentionally skipped on the failure path: a finally-level
        // rmdir races an in-flight sidecar renderer (axios client-side
        // timeouts don't tell the sidecar to abort), causing ENOENT crashes
        // mid-render. Orphans are scoped per-dxfFileId and get overwritten
        // on the next run for the same file.
        expect(storage.removeDirIfExists).not.toHaveBeenCalled();
    });

    it('pre-execute failure (explore throws): FAILED + catch block ran, no cleanup on failure path', async () => {
        (sidecar.explore as jest.Mock).mockRejectedValue(
            new Error('sidecar unreachable'),
        );

        const { dxf, job } = await seedDxf();
        await expect(dxfExtractionHandler(job)).rejects.toThrow(
            'sidecar unreachable',
        );

        const updated = await prisma.dxfFile.findUniqueOrThrow({
            where: { id: dxf.id },
        });
        expect(updated.extractionStatus).toBe('FAILED');
        expect(updated.extractionError).toContain('sidecar unreachable');
        expect(sidecar.renderThumbnails).not.toHaveBeenCalled();
        expect(generateExtractionScript).not.toHaveBeenCalled();
        expect(sidecar.execute).not.toHaveBeenCalled();
        // See companion test above for rationale: cleanup only runs on the
        // happy path to avoid racing a still-rendering sidecar.
        expect(storage.removeDirIfExists).not.toHaveBeenCalled();
    });
});
