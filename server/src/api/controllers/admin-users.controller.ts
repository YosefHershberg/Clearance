import type { Request, Response, NextFunction } from 'express';
import {
    listUsers as listUsersSvc,
    createUser as createUserSvc,
    deleteUser as deleteUserSvc,
    resetPassword as resetPasswordSvc,
    setActive as setActiveSvc,
} from '../services/admin-users.service';
import { record as auditRecord } from '../services/audit-log.service';
import { HttpError } from '../../lib/HttpError';

function actorId(req: Request): string {
    if (!req.user) throw new HttpError(401, 'Unauthenticated');
    return req.user.id;
}

function publicUser(u: { id: string; email: string; name: string; role: 'ADMIN' | 'USER'; isActive: boolean; createdAt: Date }) {
    return { id: u.id, email: u.email, name: u.name, role: u.role, isActive: u.isActive, createdAt: u.createdAt };
}

export async function listUsers(req: Request, res: Response, next: NextFunction) {
    try {
        const { q, limit, cursor } = req.query as unknown as { q?: string; limit: number; cursor?: string };
        const result = await listUsersSvc({ q, limit, cursor });
        res.json({ data: { users: result.users.map(publicUser), nextCursor: result.nextCursor } });
    } catch (err) { next(err); }
}

export async function createUser(req: Request, res: Response, next: NextFunction) {
    try {
        const aid = actorId(req);
        const body = req.body as { email: string; name: string; initialPassword: string };
        const user = await createUserSvc(body, aid);
        await auditRecord({ actorId: aid, event: 'admin.user_created', entity: 'User', entityId: user.id });
        res.status(201).json({ data: { user: publicUser(user) } });
    } catch (err) { next(err); }
}

export async function deleteUser(req: Request, res: Response, next: NextFunction) {
    try {
        const aid = actorId(req);
        const { id } = req.params as { id: string };
        await deleteUserSvc(id, aid);
        await auditRecord({ actorId: aid, event: 'admin.user_deleted', entity: 'User', entityId: id });
        res.json({ data: { ok: true } });
    } catch (err) { next(err); }
}

export async function resetPassword(req: Request, res: Response, next: NextFunction) {
    try {
        const aid = actorId(req);
        const { id } = req.params as { id: string };
        const { newPassword } = req.body as { newPassword: string };
        await resetPasswordSvc(id, newPassword, aid);
        await auditRecord({ actorId: aid, event: 'admin.user_password_reset', entity: 'User', entityId: id });
        res.json({ data: { ok: true } });
    } catch (err) { next(err); }
}

export async function setActive(req: Request, res: Response, next: NextFunction) {
    try {
        const aid = actorId(req);
        const { id } = req.params as { id: string };
        const { isActive } = req.body as { isActive: boolean };
        const user = await setActiveSvc(id, isActive, aid);
        await auditRecord({
            actorId: aid,
            event: isActive ? 'admin.user_enabled' : 'admin.user_disabled',
            entity: 'User',
            entityId: id,
        });
        res.json({ data: { user: publicUser(user) } });
    } catch (err) { next(err); }
}
