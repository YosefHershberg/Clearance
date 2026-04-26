import { dxfExtractionHandler } from './dxf-extraction.handler';
import prisma from '../../config/prisma';
import { sidecar } from '../../integrations/python-sidecar.client';
import {
    generateExtractionScript,
    fixExtractionScript,
} from '../../integrations/anthropic.client';
import { storage } from '../../integrations/storage.client';
import {
    findLatestByHash,
    createScript,
} from '../../api/data-access/extraction-script.da';
import { computeFileSha256 } from '../../lib/file-hash';
import type { Job } from '../../generated/prisma/client';

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
}));

jest.mock('../../integrations/storage.client', () => ({
    storage: {
        saveBuffer: jest.fn(),
        readText: jest.fn(),
        removeDirIfExists: jest.fn(),
    },
}));

jest.mock('../../api/data-access/extraction-script.da', () => ({
    findLatestByHash: jest.fn(),
    createScript: jest.fn(),
}));

jest.mock('../../lib/file-hash', () => ({
    computeFileSha256: jest.fn(async () => 'f'.repeat(64)),
}));

jest.mock('../../config/prisma', () => {
    const tx = {
        storedFile: {
            create: jest.fn(),
        },
        sheetRender: {
            create: jest.fn(),
        },
        dxfFile: {
            update: jest.fn(),
        },
    };
    return {
        __esModule: true,
        default: {
            dxfFile: {
                findUnique: jest.fn(),
                update: jest.fn(),
            },
            storedFile: {
                create: jest.fn(),
            },
            // Expose tx so tests can inspect tx.sheetRender.create / tx.storedFile.create calls.
            __tx: tx,
            $transaction: jest.fn(
                async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
            ),
        },
    };
});

const mockedFindUnique = prisma.dxfFile.findUnique as jest.MockedFunction<
    typeof prisma.dxfFile.findUnique
>;
const mockedDxfUpdate = prisma.dxfFile.update as jest.MockedFunction<
    typeof prisma.dxfFile.update
>;
const mockedStoredFileCreate = prisma.storedFile
    .create as jest.MockedFunction<typeof prisma.storedFile.create>;

const mockedExplore = sidecar.explore as jest.MockedFunction<
    typeof sidecar.explore
>;
const mockedRenderThumbnails =
    sidecar.renderThumbnails as jest.MockedFunction<
        typeof sidecar.renderThumbnails
    >;
const mockedExecute = sidecar.execute as jest.MockedFunction<
    typeof sidecar.execute
>;

const mockedGenerate = generateExtractionScript as jest.MockedFunction<
    typeof generateExtractionScript
>;
const mockedFix = fixExtractionScript as jest.MockedFunction<
    typeof fixExtractionScript
>;

const mockedSaveBuffer = storage.saveBuffer as jest.MockedFunction<
    typeof storage.saveBuffer
>;
const mockedReadText = storage.readText as jest.MockedFunction<
    typeof storage.readText
>;
const mockedRemoveDir = storage.removeDirIfExists as jest.MockedFunction<
    typeof storage.removeDirIfExists
>;

const mockedFindLatestByHash = findLatestByHash as jest.MockedFunction<
    typeof findLatestByHash
>;
const mockedCreateScript = createScript as jest.MockedFunction<
    typeof createScript
>;

const mockedSha = computeFileSha256 as jest.MockedFunction<
    typeof computeFileSha256
>;

type PrismaMock = typeof prisma & {
    __tx: {
        storedFile: { create: jest.Mock };
        sheetRender: { create: jest.Mock };
        dxfFile: { update: jest.Mock };
    };
    $transaction: jest.Mock;
};
const mockedTx = (prisma as unknown as PrismaMock).__tx;
const mockedTransaction = (prisma as unknown as PrismaMock).$transaction;

function fakeJob(overrides: Partial<Job> = {}): Job {
    return {
        id: 'job-1',
        type: 'DXF_EXTRACTION',
        status: 'RUNNING',
        payload: {},
        errorMessage: null,
        attempts: 1,
        heartbeatAt: new Date(),
        projectId: null,
        analysisId: null,
        addonRunId: null,
        dxfFileId: 'dxf-1',
        tavaFileId: null,
        addonDocumentId: null,
        startedAt: new Date(),
        completedAt: null,
        createdAt: new Date(),
        ...overrides,
    } as Job;
}

const DXF_ROW = {
    id: 'dxf-1',
    projectId: 'p-1',
    storedFile: { uri: 'uploads/dxf/abc.dxf' },
};

const EXPLORE_RESULT = {
    explorationJson: { blocks: [{ name: 'B' }] },
    structuralHash: 'hash-xyz',
    ms: 99,
};

function cachedScript(id: string, uri: string) {
    return {
        id,
        structuralHash: 'hash-xyz',
        storedFileId: `${id}-sf`,
        generatedByModel: 'claude-opus-4-7',
        generationCostUsd: 0.5 as unknown as never,
        generationMs: 1000,
        fixedFromScriptId: null,
        createdAt: new Date(),
        storedFile: {
            id: `${id}-sf`,
            kind: 'EXTRACTION_SCRIPT',
            store: 'LOCAL',
            uri,
            originalName: 'x.py',
            sizeBytes: 10,
            sha256: 'f'.repeat(64),
            createdAt: new Date(),
        },
    } as never;
}

describe('dxfExtractionHandler — state machine', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockedDxfUpdate.mockResolvedValue({ id: 'dxf-1' } as never);
        mockedRemoveDir.mockResolvedValue(undefined);
        mockedSha.mockResolvedValue('f'.repeat(64));
        mockedTx.storedFile.create.mockImplementation(
            async (args: { data: unknown }) => ({
                id: `rsf-${Math.random().toString(36).slice(2, 8)}`,
                ...(args.data as Record<string, unknown>),
            }),
        );
        mockedTx.sheetRender.create.mockImplementation(
            async (args: { data: unknown }) => ({
                id: `sr-${Math.random().toString(36).slice(2, 8)}`,
                ...(args.data as Record<string, unknown>),
            }),
        );
        mockedTx.dxfFile.update.mockResolvedValue({ id: 'dxf-1' } as never);
    });

    it('Path 1 — cache hit: skips thumbnails + codegen, executes once, COMPLETED', async () => {
        mockedFindUnique.mockResolvedValueOnce(DXF_ROW as never);
        mockedExplore.mockResolvedValueOnce(EXPLORE_RESULT);
        mockedFindLatestByHash.mockResolvedValueOnce(
            cachedScript('s1', 'uploads/scripts/s1.py'),
        );
        mockedExecute.mockResolvedValueOnce({
            ok: true,
            complianceData: { setbacks: { front: 3 } },
            renders: [
                {
                    filename: 'renders/dxf-1/render_01.svg',
                    sheetIndex: 1,
                    displayName: 'Sheet 1',
                    classification: 'FLOOR_PLAN',
                    sizeBytes: 25_000,
                },
            ],
            ms: 500,
        });

        await dxfExtractionHandler(fakeJob());

        expect(mockedRenderThumbnails).not.toHaveBeenCalled();
        expect(mockedGenerate).not.toHaveBeenCalled();
        expect(mockedFix).not.toHaveBeenCalled();
        expect(mockedExecute).toHaveBeenCalledTimes(1);
        // Cache-hit path still persists sheet renders.
        expect(mockedTransaction).toHaveBeenCalledTimes(1);
        expect(mockedTx.sheetRender.create).toHaveBeenCalledTimes(1);
        // Transaction's dxfFile.update carries the final status payload.
        const txUpdateArg = mockedTx.dxfFile.update.mock.calls[
            mockedTx.dxfFile.update.mock.calls.length - 1
        ][0] as { data: Record<string, unknown> };
        expect(txUpdateArg.data).toMatchObject({
            extractionStatus: 'COMPLETED',
            structuralHash: 'hash-xyz',
            complianceData: { setbacks: { front: 3 } },
        });
        // trace.cacheHit === true
        const traceSent = txUpdateArg.data.extractionTrace as {
            cacheHit: boolean;
        };
        expect(traceSent.cacheHit).toBe(true);
        // finally cleanup
        expect(mockedRemoveDir).toHaveBeenCalledWith('uploads/renders/thumbs/dxf-1/');
    });

    it('Path 2 — cache miss, first execute succeeds', async () => {
        mockedFindUnique.mockResolvedValueOnce(DXF_ROW as never);
        mockedExplore.mockResolvedValueOnce(EXPLORE_RESULT);
        // First lookup = miss, second lookup (after createScript) = hit with new row
        mockedFindLatestByHash
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(
                cachedScript('s-new', 'uploads/scripts/s-new.py'),
            );
        mockedRenderThumbnails.mockResolvedValueOnce({
            thumbnails: [
                { sheetKey: 'VP1', pngUri: 'uploads/renders/thumbs/dxf-1/1.png', dotCount: 5 },
            ],
            ms: 1000,
        });
        mockedGenerate.mockResolvedValueOnce({
            code: 'print("hi")',
            costUsd: 1.23,
            ms: 30_000,
        });
        mockedSaveBuffer.mockResolvedValueOnce({
            uri: 'uploads/scripts/s-new.py',
            sha256: 'a'.repeat(64),
            sizeBytes: 42,
        });
        mockedStoredFileCreate.mockResolvedValueOnce({ id: 's-new-sf' } as never);
        mockedCreateScript.mockResolvedValueOnce({ id: 's-new' } as never);
        mockedExecute.mockResolvedValueOnce({
            ok: true,
            complianceData: { heights: { max_height: 10 } },
            renders: [
                {
                    filename: 'renders/dxf-1/render_01.svg',
                    sheetIndex: 1,
                    displayName: 'קומת קרקע',
                    classification: 'FLOOR_PLAN',
                    geometryBlock: 'VP1',
                    annotationBlock: 'VP2',
                    sizeBytes: 30_000,
                },
                {
                    filename: 'renders/dxf-1/render_02.svg',
                    sheetIndex: 2,
                    displayName: 'חתך A-A',
                    classification: 'CROSS_SECTION',
                    sizeBytes: 28_000,
                },
            ],
            ms: 400,
        });

        await dxfExtractionHandler(fakeJob());

        expect(mockedRenderThumbnails).toHaveBeenCalledTimes(1);
        expect(mockedGenerate).toHaveBeenCalledTimes(1);
        expect(mockedSaveBuffer).toHaveBeenCalledTimes(1);
        expect(mockedStoredFileCreate).toHaveBeenCalledTimes(1);
        expect(mockedCreateScript).toHaveBeenCalledTimes(1);
        expect(mockedCreateScript.mock.calls[0][0]).toMatchObject({
            structuralHash: 'hash-xyz',
            storedFileId: 's-new-sf',
            generatedByModel: 'claude-opus-4-7',
            generationCostUsd: 1.23,
        });
        expect(mockedExecute).toHaveBeenCalledTimes(1);
        expect(mockedFix).not.toHaveBeenCalled();

        // Transaction opened once; sha256 precomputed for each render.
        expect(mockedTransaction).toHaveBeenCalledTimes(1);
        expect(mockedSha).toHaveBeenCalledTimes(2);

        // Two StoredFile(RENDER) rows created.
        expect(mockedTx.storedFile.create).toHaveBeenCalledTimes(2);
        expect(mockedTx.storedFile.create).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                data: expect.objectContaining({
                    kind: 'RENDER',
                    uri: 'renders/dxf-1/render_01.svg',
                    originalName: 'render_01.svg',
                    sizeBytes: 30_000,
                }),
            }),
        );

        // Two SheetRender rows created with correct mapping.
        expect(mockedTx.sheetRender.create).toHaveBeenCalledTimes(2);
        expect(mockedTx.sheetRender.create).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                data: expect.objectContaining({
                    dxfFileId: 'dxf-1',
                    sheetIndex: 1,
                    displayName: 'קומת קרקע',
                    classification: 'FLOOR_PLAN',
                    geometryBlock: 'VP1',
                    annotationBlock: 'VP2',
                    svgWarning: null,
                }),
            }),
        );
        expect(mockedTx.sheetRender.create).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                data: expect.objectContaining({
                    sheetIndex: 2,
                    displayName: 'חתך A-A',
                    classification: 'CROSS_SECTION',
                }),
            }),
        );

        const txUpdateArg = mockedTx.dxfFile.update.mock.calls[
            mockedTx.dxfFile.update.mock.calls.length - 1
        ][0] as { data: Record<string, unknown> };
        expect(txUpdateArg.data).toMatchObject({
            extractionStatus: 'COMPLETED',
            complianceData: { heights: { max_height: 10 } },
        });
        const traceSent = txUpdateArg.data.extractionTrace as {
            cacheHit: boolean;
        };
        expect(traceSent.cacheHit).toBe(false);
        expect(mockedRemoveDir).toHaveBeenCalledWith('uploads/renders/thumbs/dxf-1/');
    });

    it('Path 2b — codegen prompt is trimmed to is_sheet_candidate blocks only', async () => {
        // Real-world DXFs have thousands of library-primitive block defs
        // (doors, symbols) that aren't rendered and shouldn't enter the prompt.
        // Shipping the full set blows Anthropic's per-minute rate limit and
        // wastes tokens. Handler must pass ONLY candidate blocks to the
        // multimodal codegen call, but the structuralHash (derived from the
        // full exploration) must still be persisted.
        mockedFindUnique.mockResolvedValueOnce(DXF_ROW as never);
        mockedExplore.mockResolvedValueOnce({
            explorationJson: {
                source: { sha256: 'x' },
                layers: [],
                hints: {},
                blocks: [
                    { name: 'SHEET_01', is_sheet_candidate: true },
                    { name: 'LIB_DOOR_A', is_sheet_candidate: false },
                    { name: 'LIB_DOOR_B', is_sheet_candidate: false },
                ],
            },
            structuralHash: 'hash-trim',
            ms: 50,
        });
        mockedFindLatestByHash
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(cachedScript('s-trim', 'uploads/scripts/s-trim.py'));
        mockedRenderThumbnails.mockResolvedValueOnce({
            thumbnails: [
                { sheetKey: 'SHEET_01', pngUri: 'uploads/renders/thumbs/dxf-1/1.png', dotCount: 3 },
            ],
            ms: 500,
        });
        mockedGenerate.mockResolvedValueOnce({
            code: 'print("trimmed")',
            costUsd: 0.1,
            ms: 1000,
        });
        mockedSaveBuffer.mockResolvedValueOnce({
            uri: 'uploads/scripts/s-trim.py',
            sha256: 'b'.repeat(64),
            sizeBytes: 10,
        });
        mockedStoredFileCreate.mockResolvedValueOnce({ id: 's-trim-sf' } as never);
        mockedCreateScript.mockResolvedValueOnce({ id: 's-trim' } as never);
        mockedExecute.mockResolvedValueOnce({
            ok: true,
            complianceData: {},
            renders: [
                {
                    filename: 'renders/dxf-1/render_01.svg',
                    sheetIndex: 1,
                    displayName: 'Only sheet',
                    classification: 'FLOOR_PLAN',
                    sizeBytes: 1000,
                },
            ],
            ms: 100,
        });

        await dxfExtractionHandler(fakeJob());

        expect(mockedGenerate).toHaveBeenCalledTimes(1);
        const codegenArg = mockedGenerate.mock.calls[0][0] as {
            explorationJson: { blocks: Array<{ name: string }>; source: { sha256: string } };
        };
        // Blocks: filtered to the single candidate.
        expect(codegenArg.explorationJson.blocks).toHaveLength(1);
        expect(codegenArg.explorationJson.blocks[0].name).toBe('SHEET_01');
        // Siblings (source, layers, hints) preserved so the prompt still has
        // the top-level context the codegen needs.
        expect(codegenArg.explorationJson.source).toEqual({ sha256: 'x' });
    });

    it('Path 3 — cache miss, first execute crashes, fix succeeds on retry', async () => {
        mockedFindUnique.mockResolvedValueOnce(DXF_ROW as never);
        mockedExplore.mockResolvedValueOnce(EXPLORE_RESULT);
        // lookups: miss → new script → fixed script
        mockedFindLatestByHash
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(
                cachedScript('s-orig', 'uploads/scripts/s-orig.py'),
            )
            .mockResolvedValueOnce(
                cachedScript('s-fix', 'uploads/scripts/s-fix.py'),
            );
        mockedRenderThumbnails.mockResolvedValueOnce({
            thumbnails: [
                { sheetKey: 'VP1', pngUri: 'uploads/renders/thumbs/dxf-1/1.png', dotCount: 3 },
            ],
            ms: 900,
        });
        mockedGenerate.mockResolvedValueOnce({
            code: 'broken',
            costUsd: 1.0,
            ms: 25_000,
        });
        mockedSaveBuffer
            .mockResolvedValueOnce({
                uri: 'uploads/scripts/s-orig.py',
                sha256: 'a'.repeat(64),
                sizeBytes: 10,
            })
            .mockResolvedValueOnce({
                uri: 'uploads/scripts/s-fix.py',
                sha256: 'b'.repeat(64),
                sizeBytes: 12,
            });
        mockedStoredFileCreate
            .mockResolvedValueOnce({ id: 's-orig-sf' } as never)
            .mockResolvedValueOnce({ id: 's-fix-sf' } as never);
        mockedCreateScript
            .mockResolvedValueOnce({ id: 's-orig' } as never)
            .mockResolvedValueOnce({ id: 's-fix' } as never);
        mockedExecute
            .mockResolvedValueOnce({
                ok: false,
                traceback: 'Traceback: NameError foo',
                ms: 200,
            })
            .mockResolvedValueOnce({
                ok: true,
                complianceData: { parking: { bay_count: 4 } },
                renders: [
                    {
                        filename: 'renders/dxf-1/render_01.svg',
                        sheetIndex: 1,
                        displayName: 'Sheet 1',
                        classification: 'FLOOR_PLAN',
                        sizeBytes: 25_000,
                    },
                ],
                ms: 300,
            });
        mockedReadText.mockResolvedValueOnce('broken');
        mockedFix.mockResolvedValueOnce({
            code: 'fixed',
            costUsd: 0.4,
            ms: 15_000,
        });

        await dxfExtractionHandler(fakeJob());

        expect(mockedExecute).toHaveBeenCalledTimes(2);
        expect(mockedFix).toHaveBeenCalledTimes(1);
        expect(mockedFix.mock.calls[0][0]).toMatchObject({
            brokenCode: 'broken',
            traceback: 'Traceback: NameError foo',
        });
        // Second createScript call carries fixedFromScriptId = original id.
        expect(mockedCreateScript).toHaveBeenCalledTimes(2);
        expect(mockedCreateScript.mock.calls[1][0]).toMatchObject({
            structuralHash: 'hash-xyz',
            storedFileId: 's-fix-sf',
            fixedFromScriptId: 's-orig',
        });
        // Self-correct success path persists the render from the winning attempt.
        expect(mockedTx.sheetRender.create).toHaveBeenCalledTimes(1);
        // Final DxfFile update (inside the transaction) = COMPLETED + complianceData from second execute.
        const txUpdateArg = mockedTx.dxfFile.update.mock.calls[
            mockedTx.dxfFile.update.mock.calls.length - 1
        ][0] as { data: Record<string, unknown> };
        expect(txUpdateArg.data).toMatchObject({
            extractionStatus: 'COMPLETED',
            complianceData: { parking: { bay_count: 4 } },
        });
        expect(mockedRemoveDir).toHaveBeenCalledWith('uploads/renders/thumbs/dxf-1/');
    });

    it('Path 4 — both attempts crash: FAILED, extractionError populated, finally runs, handler throws', async () => {
        mockedFindUnique.mockResolvedValueOnce(DXF_ROW as never);
        mockedExplore.mockResolvedValueOnce(EXPLORE_RESULT);
        mockedFindLatestByHash
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(
                cachedScript('s-orig', 'uploads/scripts/s-orig.py'),
            )
            .mockResolvedValueOnce(
                cachedScript('s-fix', 'uploads/scripts/s-fix.py'),
            );
        mockedRenderThumbnails.mockResolvedValueOnce({
            thumbnails: [
                { sheetKey: 'VP1', pngUri: 'uploads/renders/thumbs/dxf-1/1.png', dotCount: 1 },
            ],
            ms: 800,
        });
        mockedGenerate.mockResolvedValueOnce({
            code: 'broken',
            costUsd: 1.0,
            ms: 25_000,
        });
        mockedSaveBuffer
            .mockResolvedValueOnce({
                uri: 'uploads/scripts/s-orig.py',
                sha256: 'a'.repeat(64),
                sizeBytes: 10,
            })
            .mockResolvedValueOnce({
                uri: 'uploads/scripts/s-fix.py',
                sha256: 'b'.repeat(64),
                sizeBytes: 12,
            });
        mockedStoredFileCreate
            .mockResolvedValueOnce({ id: 's-orig-sf' } as never)
            .mockResolvedValueOnce({ id: 's-fix-sf' } as never);
        mockedCreateScript
            .mockResolvedValueOnce({ id: 's-orig' } as never)
            .mockResolvedValueOnce({ id: 's-fix' } as never);
        const longTb = 'Z'.repeat(3000) + 'TAIL_MARKER';
        mockedExecute
            .mockResolvedValueOnce({ ok: false, traceback: 'first tb', ms: 200 })
            .mockResolvedValueOnce({ ok: false, traceback: longTb, ms: 200 });
        mockedReadText.mockResolvedValueOnce('broken');
        mockedFix.mockResolvedValueOnce({
            code: 'still-broken',
            costUsd: 0.4,
            ms: 15_000,
        });

        await expect(dxfExtractionHandler(fakeJob())).rejects.toThrow(
            /exhausted retries/,
        );

        expect(mockedExecute).toHaveBeenCalledTimes(2);
        // FAILED update landed; complianceData NOT in payload.
        const failUpdate = mockedDxfUpdate.mock.calls
            .map((c) => c[0])
            .find(
                (u) =>
                    (u.data as { extractionStatus?: string }).extractionStatus ===
                    'FAILED',
            );
        expect(failUpdate).toBeDefined();
        expect(failUpdate!.data).toMatchObject({
            extractionStatus: 'FAILED',
            structuralHash: 'hash-xyz',
        });
        expect(failUpdate!.data).toHaveProperty('explorationJson');
        // error = last 2000 chars of second traceback
        const errMsg = (failUpdate!.data as { extractionError: string })
            .extractionError;
        expect(errMsg.length).toBeLessThanOrEqual(2000);
        expect(errMsg).toContain('TAIL_MARKER');
        // complianceData was never set.
        expect(
            (failUpdate!.data as { complianceData?: unknown }).complianceData,
        ).toBeUndefined();
        // Cleanup deliberately skipped on failure paths: a finally-level
        // rmdir races a still-rendering sidecar when axios times out
        // client-side (the sidecar has no abort signal), causing ENOENT
        // on mid-flight matplotlib.savefig calls.
        expect(mockedRemoveDir).not.toHaveBeenCalled();
    });

    it('Path 5 — pre-execute failure (explore throws): DxfFile FAILED, handler re-throws, no cleanup on failure path', async () => {
        mockedFindUnique.mockResolvedValueOnce(DXF_ROW as never);
        const boom = new Error('sidecar unreachable');
        mockedExplore.mockRejectedValueOnce(boom);

        await expect(dxfExtractionHandler(fakeJob())).rejects.toThrow(
            'sidecar unreachable',
        );

        // See Path 4 rationale — cleanup only runs on the happy path.
        expect(mockedRemoveDir).not.toHaveBeenCalled();

        // DxfFile was updated to FAILED with the error message tail
        const failUpdate = mockedDxfUpdate.mock.calls
            .map((c) => c[0])
            .find(
                (u) =>
                    (u.data as { extractionStatus?: string }).extractionStatus ===
                    'FAILED',
            );
        expect(failUpdate).toBeDefined();
        expect(
            (failUpdate!.data as { extractionError: string }).extractionError,
        ).toContain('sidecar unreachable');
        // where clause must guard against double-writes from the explicit FAILED block
        expect(failUpdate!.where).toMatchObject({
            id: 'dxf-1',
            extractionStatus: 'EXTRACTING',
        });

        // We failed before phase 2 — none of these should have been called.
        expect(mockedRenderThumbnails).not.toHaveBeenCalled();
        expect(mockedGenerate).not.toHaveBeenCalled();
        expect(mockedExecute).not.toHaveBeenCalled();
    });

    it('normalizes unknown classification strings to UNCLASSIFIED', async () => {
        mockedFindUnique.mockResolvedValueOnce(DXF_ROW as never);
        mockedExplore.mockResolvedValueOnce(EXPLORE_RESULT);
        mockedFindLatestByHash.mockResolvedValueOnce(
            cachedScript('s-cached', 'uploads/scripts/x.py'),
        );
        mockedExecute.mockResolvedValueOnce({
            ok: true,
            complianceData: {},
            renders: [
                {
                    filename: 'renders/dxf-1/render_01.svg',
                    sheetIndex: 1,
                    displayName: 's1',
                    classification: 'NOT_A_REAL_CLASSIFICATION',
                    sizeBytes: 30_000,
                },
            ],
            ms: 500,
        });

        await dxfExtractionHandler(fakeJob());

        const createCall = mockedTx.sheetRender.create.mock.calls[0][0] as {
            data: { classification: string };
        };
        expect(createCall.data.classification).toBe('UNCLASSIFIED');
    });

    it('throws early if dxfFileId missing from job', async () => {
        await expect(
            dxfExtractionHandler(fakeJob({ dxfFileId: null, payload: {} })),
        ).rejects.toThrow(/missing dxfFileId/);
        expect(mockedFindUnique).not.toHaveBeenCalled();
    });
});
