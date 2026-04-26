import type { Request, Response, NextFunction } from 'express';
import { login as loginService, changePassword as changePasswordService } from '../services/auth.service';
import { record as auditRecord } from '../services/audit-log.service';
import { setAuthCookie, clearAuthCookie } from '../../integrations/auth-cookie';
import { HttpError } from '../../lib/HttpError';

export async function login(req: Request, res: Response, next: NextFunction) {
    try {
        const { email, password } = req.body as { email: string; password: string };
        const user = await loginService(email, password);
        setAuthCookie(res, user.id);
        await auditRecord({ actorId: user.id, event: 'auth.login', entity: 'User', entityId: user.id });
        res.json({ data: { user } });
    } catch (err) {
        next(err);
    }
}

export function logout(req: Request, res: Response) {
    const userId = req.user?.id;
    clearAuthCookie(res);
    if (userId) {
        void auditRecord({ actorId: userId, event: 'auth.logout', entity: 'User', entityId: userId });
    }
    res.json({ data: { ok: true } });
}

export function me(req: Request, res: Response, next: NextFunction) {
    if (!req.user) {
        return next(new HttpError(401, 'Unauthenticated'));
    }
    res.json({ data: { user: req.user } });
}

export async function changePassword(req: Request, res: Response, next: NextFunction) {
    try {
        if (!req.user) throw new HttpError(401, 'Unauthenticated');
        const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
        await changePasswordService(req.user.id, currentPassword, newPassword);
        await auditRecord({ actorId: req.user.id, event: 'auth.password_changed', entity: 'User', entityId: req.user.id });
        res.json({ data: { ok: true } });
    } catch (err) {
        next(err);
    }
}
