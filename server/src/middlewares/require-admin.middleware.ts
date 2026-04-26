import type { NextFunction, Request, Response } from 'express';

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
    if (!req.user || req.user.role !== 'ADMIN') {
        res.status(403).json({ message: 'Forbidden' });
        return;
    }
    next();
}
