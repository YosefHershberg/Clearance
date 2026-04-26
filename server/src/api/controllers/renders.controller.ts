import type { Request, Response, NextFunction } from 'express';
import { HttpError } from '../../lib/HttpError';
import { resolveRenderForServing } from '../services/render.service';

function requireUser(req: Request) {
    if (!req.user) throw new HttpError(401, 'Unauthenticated');
    return req.user;
}

export async function serveRender(
    req: Request,
    res: Response,
    next: NextFunction,
) {
    try {
        const user = requireUser(req);
        const { dxfFileId, filename } = req.params as {
            dxfFileId: string;
            filename: string;
        };

        const { absolutePath } = await resolveRenderForServing(
            user,
            dxfFileId,
            filename,
        );

        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.sendFile(absolutePath, (err) => {
            if (err && !res.headersSent) {
                next(err);
            } else if (err) {
                // Headers already sent — can't send a clean error response.
                // sendFile destroys the socket on error; just log-and-forget.
                res.end();
            }
        });
    } catch (err) {
        next(err);
    }
}
