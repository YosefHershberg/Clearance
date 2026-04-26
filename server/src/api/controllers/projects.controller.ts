import type { Request, Response, NextFunction } from 'express';
import * as svc from '../services/projects.service';
import { HttpError } from '../../lib/HttpError';

type RawProject = {
    id: string;
    ownerId: string;
    name: string;
    description: string | null;
    locality: string | null;
    createdAt: Date;
    updatedAt: Date;
    owner?: { id: string; email: string; name: string };
};

function requireUser(req: Request) {
    if (!req.user) throw new HttpError(401, 'Unauthenticated');
    return req.user;
}

function publicProject(p: RawProject) {
    return {
        id: p.id,
        ownerId: p.ownerId,
        name: p.name,
        description: p.description,
        locality: p.locality,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        ...(p.owner ? { owner: p.owner } : {}),
    };
}

export async function createProject(req: Request, res: Response, next: NextFunction) {
    try {
        const user = requireUser(req);
        const project = await svc.createProject(user.id, req.body);
        res.status(201).json({ data: { project: publicProject(project) } });
    } catch (err) { next(err); }
}

export async function listProjects(req: Request, res: Response, next: NextFunction) {
    try {
        const user = requireUser(req);
        const { q, limit, cursor, all } = req.query as unknown as {
            q?: string;
            limit: number;
            cursor?: string;
            all?: 'true' | 'false';
        };
        const result = await svc.listProjectsFor(user, {
            q,
            limit,
            cursor,
            all: all === 'true',
        });
        res.json({
            data: {
                projects: result.projects.map(publicProject),
                nextCursor: result.nextCursor,
            },
        });
    } catch (err) { next(err); }
}

export async function getProject(req: Request, res: Response, next: NextFunction) {
    try {
        const user = requireUser(req);
        const project = await svc.getProject(user, (req.params as { id: string }).id);
        res.json({ data: { project: publicProject(project) } });
    } catch (err) { next(err); }
}

export async function patchProject(req: Request, res: Response, next: NextFunction) {
    try {
        const user = requireUser(req);
        const project = await svc.patchProject(
            user,
            (req.params as { id: string }).id,
            req.body,
        );
        res.json({ data: { project: publicProject(project) } });
    } catch (err) { next(err); }
}

export async function deleteProject(req: Request, res: Response, next: NextFunction) {
    try {
        const user = requireUser(req);
        await svc.softDeleteProject(user, (req.params as { id: string }).id);
        res.json({ data: { ok: true } });
    } catch (err) { next(err); }
}
