import prisma from '../../config/prisma';
import type { Project, Prisma } from '../../generated/prisma/client';

export type ListFilters = {
    ownerId?: string;
    q?: string;
    limit: number;
    cursor?: string;
};

export type ProjectWithOwner = Project & {
    owner: { id: string; email: string; name: string };
};

export async function createProject(input: {
    ownerId: string;
    name: string;
    description?: string;
    locality?: string;
}): Promise<Project> {
    return prisma.project.create({ data: input });
}

export async function listProjects(filters: ListFilters): Promise<{
    projects: ProjectWithOwner[];
    nextCursor?: string;
}> {
    const where: Prisma.ProjectWhereInput = { deletedAt: null };
    if (filters.ownerId) where.ownerId = filters.ownerId;
    if (filters.q) where.name = { contains: filters.q, mode: 'insensitive' };

    const rows = await prisma.project.findMany({
        where,
        take: filters.limit + 1,
        ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
        orderBy: { createdAt: 'desc' },
        include: { owner: { select: { id: true, email: true, name: true } } },
    });
    const hasMore = rows.length > filters.limit;
    const page = hasMore ? rows.slice(0, filters.limit) : rows;
    return {
        projects: page,
        nextCursor: hasMore ? page[page.length - 1].id : undefined,
    };
}

export async function getProjectById(id: string): Promise<ProjectWithOwner | null> {
    return prisma.project.findFirst({
        where: { id, deletedAt: null },
        include: { owner: { select: { id: true, email: true, name: true } } },
    });
}

export async function patchProject(
    id: string,
    data: {
        name?: string;
        description?: string | null;
        locality?: string | null;
    },
): Promise<Project> {
    return prisma.project.update({ where: { id }, data });
}

export async function softDeleteProject(id: string): Promise<Project> {
    return prisma.project.update({
        where: { id },
        data: { deletedAt: new Date() },
    });
}
