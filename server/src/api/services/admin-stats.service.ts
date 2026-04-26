import prisma from '../../config/prisma';

export type Stats = {
    userCount: number;
    projectCount: number;
    analysisCount: number;
};

export async function getStats(): Promise<Stats> {
    const userCount = await prisma.user.count();
    // projectCount and analysisCount are 0 until Phase 2 / Phase 6 add those models.
    return { userCount, projectCount: 0, analysisCount: 0 };
}
