import path from 'node:path';
import crypto from 'node:crypto';
import prisma from '../../config/prisma';
import logger from '../../config/logger';
import {
    sidecar,
    type ExecuteResult,
} from '../../integrations/python-sidecar.client';
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
import env from '../../utils/env';
import type { Job, Prisma } from '../../generated/prisma/client';

const MAX_ATTEMPTS = 2;
const CODEGEN_MODEL = 'claude-opus-4-7';

type Phase =
    | { phase: 'explore'; ms: number }
    | { phase: 'render-thumbnails'; ms: number; sheetCount: number }
    | { phase: 'codegen'; ms: number; costUsd: number }
    | { phase: 'self-correct'; ms: number; costUsd: number }
    | { phase: 'execute'; attempt: number; ms: number; ok: boolean };

interface Trace {
    cacheHit: boolean | null;
    attempts: number;
    phases: Phase[];
}

function scriptFilename(): string {
    // 24-char hex id (same pattern as upload.middleware.ts — avoids a new cuid dep).
    return `extract_${crypto.randomBytes(12).toString('hex')}.py`;
}

const VALID_CLASSIFICATIONS = [
    'INDEX_PAGE', 'FLOOR_PLAN', 'CROSS_SECTION', 'ELEVATION',
    'PARKING_SECTION', 'SURVEY', 'SITE_PLAN', 'ROOF_PLAN',
    'AREA_CALCULATION', 'UNCLASSIFIED',
] as const;
type Classification = (typeof VALID_CLASSIFICATIONS)[number];

function _trimToSheetCandidates(exploration: unknown): unknown {
    // Defensive: only trim when the shape matches; anything unexpected passes
    // through untouched (old-version explorationJson without the flag, or a
    // future schema change).
    if (
        !exploration ||
        typeof exploration !== 'object' ||
        !Array.isArray((exploration as { blocks?: unknown }).blocks)
    ) {
        return exploration;
    }
    const blocks = (exploration as { blocks: Array<{ is_sheet_candidate?: boolean }> }).blocks;
    // If NO block has the flag set, the payload pre-dates the filter — leave
    // it alone rather than silently dropping every block.
    if (!blocks.some((b) => b.is_sheet_candidate === true)) {
        return exploration;
    }
    return {
        ...(exploration as Record<string, unknown>),
        blocks: blocks.filter((b) => b.is_sheet_candidate === true),
    };
}

function normalizeClassification(raw: string): Classification {
    // Accept both enum form ("FLOOR_PLAN") and the human form the AI script
    // tends to emit ("floor plan", "cross-section", "index page"). Anything
    // unrecognized falls through to UNCLASSIFIED.
    const canonical = raw.trim().toUpperCase().replace(/[\s-]+/g, '_');
    return (VALID_CLASSIFICATIONS as readonly string[]).includes(canonical)
        ? (canonical as Classification)
        : 'UNCLASSIFIED';
}

/**
 * Phase 4b: full v3.1 state machine.
 *   explore → cache-lookup → (miss: render-thumbnails + codegen) → execute → on-crash: self-correct → persist
 *
 * SheetRender rows are NOT persisted yet — that's Phase 4c.
 * Transient thumbnail dir is cleaned up in `finally` (covers ok + throw paths).
 */
export async function dxfExtractionHandler(job: Job): Promise<void> {
    const dxfFileId =
        job.dxfFileId ??
        (job.payload as { dxfFileId?: string } | null)?.dxfFileId;
    if (!dxfFileId) {
        throw new Error('dxf-extraction: job missing dxfFileId');
    }

    const dxf = await prisma.dxfFile.findUnique({
        where: { id: dxfFileId },
        include: { storedFile: true },
    });
    if (!dxf) {
        throw new Error(`dxf-extraction: DxfFile ${dxfFileId} not found`);
    }

    const reqId = `job:${job.id}`;
    const trace: Trace = { cacheHit: null, attempts: 0, phases: [] };
    const thumbnailDir = `uploads/renders/thumbs/${dxf.id}/`;

    await prisma.dxfFile.update({
        where: { id: dxf.id },
        data: { extractionStatus: 'EXTRACTING' },
    });

    try {
        // Phase 1 — explore (fingerprint only)
        const tExplore = Date.now();
        const { explorationJson, structuralHash } = await sidecar.explore({
            storedFileUri: dxf.storedFile.uri,
            reqId,
        });
        trace.phases.push({ phase: 'explore', ms: Date.now() - tExplore });

        // Phase 2 — cache lookup, else thumbnails + codegen
        let script = await findLatestByHash(structuralHash);
        if (script) {
            trace.cacheHit = true;
            logger.info('dxf-extraction.cache-hit', {
                dxfFileId: dxf.id,
                structuralHash: structuralHash.slice(0, 12),
            });
        } else {
            trace.cacheHit = false;

            // Phase 1.5 — render thumbnails (cache miss only)
            const tThumbs = Date.now();
            const { thumbnails } = await sidecar.renderThumbnails({
                storedFileUri: dxf.storedFile.uri,
                explorationJson,
                thumbnailDir,
                reqId,
            });
            trace.phases.push({
                phase: 'render-thumbnails',
                ms: Date.now() - tThumbs,
                sheetCount: thumbnails.length,
            });

            // Phase 2 — multimodal codegen
            const tCodegen = Date.now();
            const absThumbnails = thumbnails.map((t) => ({
                sheetKey: t.sheetKey,
                pngPath: path.resolve(t.pngUri),
            }));
            // Trim blocks to sheet candidates only. Real architectural DXFs
            // have thousands of library-primitive block defs (doors,
            // furniture, symbols) the AI doesn't need — sending them all
            // blows the Anthropic rate limit and wastes tokens. The
            // structuralHash is computed from the full exploration, so
            // cache integrity is unaffected.
            const codegenExploration = _trimToSheetCandidates(explorationJson);
            const { code, costUsd, ms } = await generateExtractionScript({
                explorationJson: codegenExploration,
                thumbnails: absThumbnails,
                reqId,
            });
            const saved = await storage.saveBuffer(
                'EXTRACTION_SCRIPT',
                scriptFilename(),
                Buffer.from(code, 'utf-8'),
            );
            const storedFile = await prisma.storedFile.create({
                data: {
                    kind: 'EXTRACTION_SCRIPT',
                    uri: saved.uri,
                    sha256: saved.sha256,
                    sizeBytes: saved.sizeBytes,
                    originalName: path.basename(saved.uri),
                },
            });
            await createScript({
                structuralHash,
                storedFileId: storedFile.id,
                generatedByModel: CODEGEN_MODEL,
                generationCostUsd: costUsd,
                generationMs: ms,
            });
            script = await findLatestByHash(structuralHash);
            if (!script) {
                throw new Error(
                    'dxf-extraction: script cache invariant violated',
                );
            }
            trace.phases.push({
                phase: 'codegen',
                ms: Date.now() - tCodegen,
                costUsd,
            });
        }

        // Phase 3+4 — execute, self-correct once on crash
        const outputDir = `uploads/renders/${dxf.id}/`;
        let result: ExecuteResult | null = null;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            trace.attempts = attempt;
            const tExec = Date.now();
            result = await sidecar.execute({
                storedFileUri: dxf.storedFile.uri,
                scriptUri: script.storedFile.uri,
                outputDir,
                reqId,
            });
            trace.phases.push({
                phase: 'execute',
                attempt,
                ms: Date.now() - tExec,
                ok: result.ok,
            });
            if (result.ok) break;
            if (attempt === 1) {
                // Self-correction: text-only, traceback-driven. No thumbnails.
                const tFix = Date.now();
                const brokenCode = await storage.readText(
                    script.storedFile.uri,
                );
                const {
                    code: fixedCode,
                    costUsd: fixCost,
                    ms: fixMs,
                } = await fixExtractionScript({
                    brokenCode,
                    traceback: result.traceback,
                    reqId,
                });
                const savedFix = await storage.saveBuffer(
                    'EXTRACTION_SCRIPT',
                    scriptFilename(),
                    Buffer.from(fixedCode, 'utf-8'),
                );
                const fixedFile = await prisma.storedFile.create({
                    data: {
                        kind: 'EXTRACTION_SCRIPT',
                        uri: savedFix.uri,
                        sha256: savedFix.sha256,
                        sizeBytes: savedFix.sizeBytes,
                        originalName: path.basename(savedFix.uri),
                    },
                });
                await createScript({
                    structuralHash,
                    storedFileId: fixedFile.id,
                    generatedByModel: CODEGEN_MODEL,
                    generationCostUsd: fixCost,
                    generationMs: fixMs,
                    fixedFromScriptId: script.id,
                });
                script = await findLatestByHash(structuralHash);
                if (!script) {
                    throw new Error(
                        'dxf-extraction: script cache invariant violated after fix',
                    );
                }
                trace.phases.push({
                    phase: 'self-correct',
                    ms: Date.now() - tFix,
                    costUsd: fixCost,
                });
            }
        }

        if (!result || !result.ok) {
            const traceback =
                result && !result.ok ? result.traceback : 'unknown failure';
            await prisma.dxfFile.update({
                where: { id: dxf.id },
                data: {
                    extractionStatus: 'FAILED',
                    extractionError: traceback.slice(-2000),
                    extractionTrace: trace as unknown as Prisma.InputJsonValue,
                    structuralHash,
                    explorationJson:
                        explorationJson as Prisma.InputJsonValue,
                },
            });
            throw new Error('dxf-extraction: exhausted retries');
        }

        // Phase 5 — persist complianceData + SheetRender rows
        // Pre-pass: compute SHA256s outside the transaction so it holds no disk I/O.
        const renderEntries = await Promise.all(
            result.renders.map(async (render) => ({
                render,
                sha256: await computeFileSha256(path.resolve(render.filename)),
            })),
        );

        await prisma.$transaction(
            async (tx) => {
                for (const { render, sha256 } of renderEntries) {
                const storedFile = await tx.storedFile.create({
                    data: {
                        kind: 'RENDER',
                        uri: render.filename,
                        originalName: path.basename(render.filename),
                        sha256,
                        sizeBytes: render.sizeBytes,
                    },
                });
                await tx.sheetRender.create({
                    data: {
                        dxfFileId: dxf.id,
                        storedFileId: storedFile.id,
                        sheetIndex: render.sheetIndex,
                        displayName: render.displayName,
                        classification: normalizeClassification(render.classification),
                        geometryBlock: render.geometryBlock ?? null,
                        annotationBlock: render.annotationBlock ?? null,
                        svgWarning: render.svgWarning ?? null,
                    },
                });
            }
                await tx.dxfFile.update({
                    where: { id: dxf.id },
                    data: {
                        explorationJson: explorationJson as Prisma.InputJsonValue,
                        structuralHash,
                        complianceData: result.complianceData as Prisma.InputJsonValue,
                        extractionTrace: trace as unknown as Prisma.InputJsonValue,
                        extractionStatus: 'COMPLETED',
                    },
                });
            },
            // Persisting up to ~32 SheetRender + StoredFile rows sequentially
            // can overrun Prisma's 5s default commit window on remote DBs.
            { timeout: 60_000, maxWait: 10_000 },
        );
        // Cleanup happens HERE on the happy path only — not in a finally.
        // An axios timeout on /render-thumbnails aborts our HTTP connection
        // but the sidecar keeps rendering and writing PNGs; a finally-level
        // rmdir races that writer and causes ENOENT crashes mid-render.
        // On failure paths we leave the dir; a subsequent run with the same
        // dxfFileId overwrites, and stale dirs are scoped per-file so they
        // never grow unbounded for a single upload.
        await storage.removeDirIfExists(thumbnailDir);

        logger.info('dxf-extraction.completed', {
            dxfFileId: dxf.id,
            structuralHash: structuralHash.slice(0, 12),
            cacheHit: trace.cacheHit,
            attempts: trace.attempts,
        });
    } catch (err) {
        // Any failure before the explicit FAILED-transition block (explore
        // throws, codegen rate-limit, saveBuffer disk-full, etc.) would
        // otherwise leak the row in EXTRACTING forever. The conditional
        // where clause naturally no-ops if the explicit "both crashed"
        // block already wrote FAILED, so this never double-writes.
        const message = err instanceof Error ? err.message : String(err);
        await prisma.dxfFile
            .update({
                where: { id: dxf.id, extractionStatus: 'EXTRACTING' },
                data: {
                    extractionStatus: 'FAILED',
                    extractionError: message.slice(-2000),
                    extractionTrace: trace as unknown as Prisma.InputJsonValue,
                },
            })
            .catch(() => {
                /* already FAILED by the explicit block, or row gone —
                 * don't mask original error */
            });
        throw err;
    }
}
