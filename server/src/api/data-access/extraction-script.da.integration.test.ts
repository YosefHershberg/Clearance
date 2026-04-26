import { findLatestByHash, createScript } from './extraction-script.da';
import { truncateAll } from '../../test-helpers/db';
import prisma from '../../config/prisma';

beforeEach(async () => {
    await truncateAll();
});

afterAll(async () => {
    await prisma.$disconnect();
});

describe('extraction-script.da (integration)', () => {
    it('findLatestByHash returns newest by createdAt DESC when two rows share a hash', async () => {
        const sf1 = await prisma.storedFile.create({
            data: {
                kind: 'EXTRACTION_SCRIPT',
                uri: 'uploads/scripts/a.py',
                originalName: 'a.py',
                sha256: 'a'.repeat(64),
                sizeBytes: 10,
            },
        });
        const sf2 = await prisma.storedFile.create({
            data: {
                kind: 'EXTRACTION_SCRIPT',
                uri: 'uploads/scripts/b.py',
                originalName: 'b.py',
                sha256: 'b'.repeat(64),
                sizeBytes: 10,
            },
        });

        await createScript({
            structuralHash: 'h1',
            storedFileId: sf1.id,
            generatedByModel: 'claude-opus-4-7',
            generationCostUsd: 1.0,
            generationMs: 80_000,
        });
        // Small delay so createdAt differs.
        await new Promise((r) => setTimeout(r, 10));
        const newer = await createScript({
            structuralHash: 'h1',
            storedFileId: sf2.id,
            generatedByModel: 'claude-opus-4-7',
            generationCostUsd: 0.15,
            generationMs: 30_000,
            fixedFromScriptId: 'arbitrary-id',
        });

        const result = await findLatestByHash('h1');
        expect(result?.id).toBe(newer.id);
        expect(result?.storedFile.uri).toBe('uploads/scripts/b.py');
    });

    it('findLatestByHash returns null for unknown hash', async () => {
        expect(await findLatestByHash('missing')).toBeNull();
    });

    it('createScript persists fixedFromScriptId when provided', async () => {
        const sf = await prisma.storedFile.create({
            data: {
                kind: 'EXTRACTION_SCRIPT',
                uri: 'uploads/scripts/fix.py',
                originalName: 'fix.py',
                sha256: 'c'.repeat(64),
                sizeBytes: 10,
            },
        });
        const row = await createScript({
            structuralHash: 'h2',
            storedFileId: sf.id,
            generatedByModel: 'claude-opus-4-7',
            generationCostUsd: 0.5,
            generationMs: 40_000,
            fixedFromScriptId: 'prev-id',
        });
        expect(row.fixedFromScriptId).toBe('prev-id');
    });
});
