import type { Request, Response, NextFunction } from 'express';
import { getStats } from '../services/admin-stats.service';

export async function stats(_req: Request, res: Response, next: NextFunction) {
    try {
        const s = await getStats();
        res.json({ data: s });
    } catch (err) {
        next(err);
    }
}
