import prisma from '../../config/prisma';
import type {
    DxfFile,
    SheetRender,
    StoredFile,
} from '../../generated/prisma/client';

export type SheetRenderForServing = SheetRender & {
    storedFile: StoredFile;
    dxfFile: Pick<DxfFile, 'projectId' | 'deletedAt'>;
};

export async function findByDxfAndFilename(
    dxfFileId: string,
    filename: string,
): Promise<SheetRenderForServing | null> {
    return prisma.sheetRender.findFirst({
        where: {
            dxfFileId,
            storedFile: { originalName: filename },
        },
        include: {
            storedFile: true,
            dxfFile: { select: { projectId: true, deletedAt: true } },
        },
    });
}
