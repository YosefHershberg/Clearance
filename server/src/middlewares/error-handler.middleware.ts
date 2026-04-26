import { HttpError } from '../lib/HttpError';
import env from '../utils/env';

import type { NextFunction, Request, Response } from 'express';
import type { ErrorResponse } from '../types';

export function errorHandler(
    err: Error,
    _req: Request,
    res: Response<ErrorResponse>,
    _next: NextFunction,
) {
    if (err instanceof HttpError) {
        return res.status(err.statusCode).json({ message: err.message });
    }

    return res.status(500).json({
        message: err.message,
        stack: env.NODE_ENV === 'production' ? undefined : err.stack,
    });
}
