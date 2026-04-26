import prisma from '../config/prisma';

/**
 * Deletes every row from the mutable tables in order of FK dependency.
 * Safe to call between integration tests. Does NOT drop tables.
 */
export async function truncateAll(): Promise<void> {
    await prisma.auditLog.deleteMany({});
    await prisma.job.deleteMany({});
    await prisma.sheetRender.deleteMany({});
    await prisma.extractionScript.deleteMany({});
    await prisma.dxfFile.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.storedFile.deleteMany({});
    await prisma.user.deleteMany({});
}
