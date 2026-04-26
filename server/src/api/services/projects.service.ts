import { HttpError } from '../../lib/HttpError';
import { record as auditRecord } from './audit-log.service';
import * as da from '../data-access/projects.da';
import type { UserRole } from '../../generated/prisma/client';

type Actor = { id: string; role: UserRole };

export async function createProject(
    ownerId: string,
    input: { name: string; description?: string; locality?: string },
) {
    const project = await da.createProject({ ownerId, ...input });
    await auditRecord({
        actorId: ownerId,
        event: 'project.created',
        entity: 'Project',
        entityId: project.id,
    });
    return project;
}

export async function listProjectsFor(
    user: Actor,
    opts: { q?: string; limit: number; cursor?: string; all?: boolean },
) {
    const filters = {
        ownerId: user.role === 'ADMIN' && opts.all ? undefined : user.id,
        q: opts.q,
        limit: opts.limit,
        cursor: opts.cursor,
    };
    return da.listProjects(filters);
}

async function loadAccessible(user: Actor, id: string): Promise<da.ProjectWithOwner> {
    const project = await da.getProjectById(id);
    if (!project) throw new HttpError(404, 'Not found');
    if (project.ownerId !== user.id && user.role !== 'ADMIN') {
        throw new HttpError(403, 'Forbidden');
    }
    return project;
}

export async function getProject(user: Actor, id: string) {
    return loadAccessible(user, id);
}

export async function patchProject(
    user: Actor,
    id: string,
    patch: {
        name?: string;
        description?: string | null;
        locality?: string | null;
    },
) {
    await loadAccessible(user, id);
    const changed = Object.keys(patch).filter(
        (k) => (patch as Record<string, unknown>)[k] !== undefined,
    );
    const project = await da.patchProject(id, patch);
    await auditRecord({
        actorId: user.id,
        event: 'project.updated',
        entity: 'Project',
        entityId: id,
        metadata: { fields: changed },
    });
    return project;
}

export async function softDeleteProject(user: Actor, id: string) {
    await loadAccessible(user, id);
    await da.softDeleteProject(id);
    await auditRecord({
        actorId: user.id,
        event: 'project.deleted',
        entity: 'Project',
        entityId: id,
    });
}
