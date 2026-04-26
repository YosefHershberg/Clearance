import { unlink } from 'node:fs/promises';
import path from 'node:path';
import prisma from '../../config/prisma';
import { ensureProjectAccess } from '../../lib/project-access';
import { runner } from '../../jobs/runner';
import * as da from '../data-access/dxf-file.da';
import env from '../../utils/env';
import type {
    UserRole,
    DxfFile,
    SheetClassification,
} from '../../generated/prisma/client';

type Actor = { id: string; role: UserRole };

export interface UploadedDxfInput {
    projectId: string;
    absoluteFilePath: string;
    filenameOnDisk: string;
    originalName: string;
    sizeBytes: number;
    sha256: string;
}

export type PublicDxfFile = {
    id: string;
    projectId: string;
    originalName: string;
    sha256: string;
    sizeBytes: number;
    extractionStatus: DxfFile['extractionStatus'];
    extractionError: string | null;
    structuralHash: string | null;
    createdAt: Date;
};

export function toPublicDxf(dxf: da.DxfFileWithStoredFile): PublicDxfFile {
    return {
        id: dxf.id,
        projectId: dxf.projectId,
        originalName: dxf.storedFile.originalName,
        sha256: dxf.storedFile.sha256,
        sizeBytes: dxf.storedFile.sizeBytes,
        extractionStatus: dxf.extractionStatus,
        extractionError: dxf.extractionError,
        structuralHash: dxf.structuralHash,
        createdAt: dxf.createdAt,
    };
}

export async function uploadDxfForProject(
    user: Actor,
    input: UploadedDxfInput,
): Promise<PublicDxfFile> {
    await ensureProjectAccess(user, input.projectId);

    const existing = await da.findByProjectAndSha(input.projectId, input.sha256);
    if (existing) {
        // byte-dedup hit: undelete the old row (if soft-deleted), discard the
        // just-uploaded file, skip the job
        await da.undeleteIfSoftDeleted(existing.id);
        await unlink(input.absoluteFilePath).catch(() => {
            // idempotent; it's fine if the file was already removed
        });
        return toPublicDxf({
            ...existing,
            deletedAt: null,
        });
    }

    const relativeUri = path
        .join(env.UPLOADS_DIR, 'dxf', input.filenameOnDisk)
        .replace(/\\/g, '/');

    const dxf = await prisma.$transaction(async (tx) => {
        await da.softDeletePriorCurrentForProject(tx as typeof prisma, input.projectId);
        return da.createStoredFileAndDxf(tx as typeof prisma, {
            projectId: input.projectId,
            storedFile: {
                uri: relativeUri,
                originalName: input.originalName,
                sizeBytes: input.sizeBytes,
                sha256: input.sha256,
            },
        });
    });

    const job = await runner.enqueue({
        type: 'DXF_EXTRACTION',
        payload: { dxfFileId: dxf.id },
        projectId: input.projectId,
        dxfFileId: dxf.id,
    });
    await da.setExtractionJobId(dxf.id, job.id);

    return toPublicDxf(dxf);
}

export async function listProjectDxfFiles(
    user: Actor,
    projectId: string,
): Promise<PublicDxfFile[]> {
    await ensureProjectAccess(user, projectId);
    const rows = await da.listByProject(projectId);
    return rows.map(toPublicDxf);
}

export interface PublicSheetRender {
    id: string;
    sheetIndex: number;
    displayName: string;
    classification: SheetClassification;
    geometryBlock: string | null;
    annotationBlock: string | null;
    svgWarning: string | null;
    filename: string; // basename of the SVG — used to build /api/renders/<dxfFileId>/<filename>
}

export type PublicDxfFileDetail = PublicDxfFile & {
    sheetRenders: PublicSheetRender[];
};

function svgFilename(uri: string): string {
    return path.basename(uri);
}

export async function getDxfFile(user: Actor, id: string): Promise<PublicDxfFileDetail> {
    const dxf = await da.findByIdWithSheets(id);
    if (!dxf) throw Object.assign(new Error('Not found'), { statusCode: 404 });
    await ensureProjectAccess(user, dxf.projectId);
    return {
        ...toPublicDxf(dxf),
        sheetRenders: dxf.sheetRenders.map((s) => ({
            id: s.id,
            sheetIndex: s.sheetIndex,
            displayName: s.displayName,
            classification: s.classification,
            geometryBlock: s.geometryBlock,
            annotationBlock: s.annotationBlock,
            svgWarning: s.svgWarning,
            filename: svgFilename(s.storedFile.uri),
        })),
    };
}
