import prisma from '../../config/prisma';
import type {
    ExtractionScript,
    StoredFile,
} from '../../generated/prisma/client';

export type ExtractionScriptWithFile = ExtractionScript & {
    storedFile: StoredFile;
};

export async function findLatestByHash(
    structuralHash: string,
): Promise<ExtractionScriptWithFile | null> {
    return prisma.extractionScript.findFirst({
        where: { structuralHash },
        orderBy: { createdAt: 'desc' },
        include: { storedFile: true },
    });
}

export interface CreateScriptInput {
    structuralHash: string;
    storedFileId: string;
    generatedByModel: string;
    generationCostUsd: number;
    generationMs: number;
    fixedFromScriptId?: string | null;
}

export async function createScript(
    input: CreateScriptInput,
): Promise<ExtractionScript> {
    return prisma.extractionScript.create({
        data: {
            structuralHash: input.structuralHash,
            storedFileId: input.storedFileId,
            generatedByModel: input.generatedByModel,
            generationCostUsd: input.generationCostUsd,
            generationMs: input.generationMs,
            fixedFromScriptId: input.fixedFromScriptId ?? null,
        },
    });
}
