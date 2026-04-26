import type { NextFunction, Request, Response } from 'express';
import { verifyToken, clearAuthCookie } from '../integrations/auth-cookie';
import { findUserById } from '../api/data-access/user.da';

function unauthenticated(res: Response, clearCookie = false): Response {
    if (clearCookie) clearAuthCookie(res);
    return res.status(401).json({ message: 'Unauthenticated' });
}

export async function auth(req: Request, res: Response, next: NextFunction): Promise<void> {
    const token: string | undefined = (req.cookies as Record<string, string> | undefined)?.auth;
    if (!token) {
        unauthenticated(res);
        return;
    }
    const payload = verifyToken(token);
    if (!payload) {
        unauthenticated(res, true);
        return;
    }
    const user = await findUserById(payload.sub);
    if (!user || !user.isActive) {
        unauthenticated(res, true);
        return;
    }
    req.user = { id: user.id, email: user.email, name: user.name, role: user.role };
    next();
}
