import prisma from '../../config/prisma';
import type { DxfFile, StoredFile } from '../../generated/prisma/client';

export type DxfFileWithStoredFile = DxfFile & { storedFile: StoredFile };

export async function findByProjectAndSha(
    projectId: string,
    sha256: string,
): Promise<DxfFileWithStoredFile | null> {
    return prisma.dxfFile.findFirst({
        where: {
            projectId,
            storedFile: { sha256 },
        },
        include: { storedFile: true },
        orderBy: { createdAt: 'desc' },
    });
}

export async function undeleteIfSoftDeleted(id: string): Promise<void> {
    await prisma.dxfFile.updateMany({
        where: { id, deletedAt: { not: null } },
        data: { deletedAt: null },
    });
}

export async function softDeletePriorCurrentForProject(
    tx: typeof prisma,
    projectId: string,
): Promise<void> {
    await tx.dxfFile.updateMany({
        where: { projectId, deletedAt: null },
        data: { deletedAt: new Date() },
    });
}

export async function createStoredFileAndDxf(
    tx: typeof prisma,
    input: {
        projectId: string;
        storedFile: {
            uri: string;
            originalName: string;
            sizeBytes: number;
            sha256: string;
        };
    },
): Promise<DxfFileWithStoredFile> {
    const stored = await tx.storedFile.create({
        data: {
            kind: 'DXF',
            uri: input.storedFile.uri,
            originalName: input.storedFile.originalName,
            sizeBytes: input.storedFile.sizeBytes,
            sha256: input.storedFile.sha256,
        },
    });
    return tx.dxfFile.create({
        data: {
            projectId: input.projectId,
            storedFileId: stored.id,
            extractionStatus: 'PENDING',
        },
        include: { storedFile: true },
    });
}

export async function setExtractionJobId(
    id: string,
    jobId: string,
): Promise<void> {
    await prisma.dxfFile.update({
        where: { id },
        data: { extractionJobId: jobId },
    });
}

export async function listByProject(projectId: string): Promise<DxfFileWithStoredFile[]> {
    return prisma.dxfFile.findMany({
        where: { projectId, deletedAt: null },
        include: { storedFile: true },
        orderBy: { createdAt: 'desc' },
    });
}

export async function findById(id: string): Promise<DxfFileWithStoredFile | null> {
    return prisma.dxfFile.findFirst({
        where: { id, deletedAt: null },
        include: { storedFile: true },
    });
}

export async function findByIdWithSheets(id: string) {
    return prisma.dxfFile.findFirst({
        where: { id, deletedAt: null },
        include: {
            storedFile: true,
            sheetRenders: {
                orderBy: { sheetIndex: 'asc' },
                include: { storedFile: true },
            },
        },
    });
}

export type DxfFileDetail = NonNullable<Awaited<ReturnType<typeof findByIdWithSheets>>>;
