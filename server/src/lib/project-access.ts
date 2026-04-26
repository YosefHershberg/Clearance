import { HttpError } from './HttpError';
import prisma from '../config/prisma';
import type { UserRole } from '../generated/prisma/client';

type Actor = { id: string; role: UserRole };

/**
 * Loads the project if accessible by the actor; otherwise throws 404/403.
 * Shared by projects and DXF routes (and by future phases — analyses,
 * addon docs — that nest under /api/projects/:id/*).
 *
 * - 404 if the project doesn't exist or is soft-deleted (never distinguish —
 *   existence is information we don't want to leak).
 * - 403 if the actor is not the owner and not an admin.
 */
export async function ensureProjectAccess(
    user: Actor,
    projectId: string,
): Promise<{ id: string; ownerId: string }> {
    const project = await prisma.project.findFirst({
        where: { id: projectId, deletedAt: null },
        select: { id: true, ownerId: true },
    });
    if (!project) throw new HttpError(404, 'Not found');
    if (project.ownerId !== user.id && user.role !== 'ADMIN') {
        throw new HttpError(403, 'Forbidden');
    }
    return project;
}
