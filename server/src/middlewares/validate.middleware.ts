import { z } from 'zod';
import logger from '../config/logger';

import type { NextFunction, Request, Response } from 'express';
import type { ErrorResponse } from '../types';

export const validate = (schema: z.ZodTypeAny) =>
    (req: Request, res: Response<ErrorResponse>, next: NextFunction) => {
        try {
            const parsed = schema.parse({
                body: req.body,
                query: req.query,
                params: req.params,
            }) as { body?: unknown; query?: Record<string, unknown>; params?: Record<string, unknown> };

            // Write Zod-parsed values back so controllers see coerced values,
            // defaults, and stripped unknown keys. Express 5 exposes req.query
            // and req.params as getters — Object.assign on them mutates a
            // throwaway object, so redefine the property instead.
            if (parsed.body !== undefined) req.body = parsed.body;
            if (parsed.query !== undefined) {
                Object.defineProperty(req, 'query', { value: parsed.query, writable: true, configurable: true });
            }
            if (parsed.params !== undefined) {
                Object.defineProperty(req, 'params', { value: parsed.params, writable: true, configurable: true });
            }

            next();
        } catch (error) {
            if (error instanceof z.ZodError) {
                logger.error(error.issues);
                const errorMessages = error.issues.map((issue) => ({
                    message: `${issue.path.join('.')} is ${issue.message}`,
                }));
                return res.status(400).json({ error: 'Invalid data', details: errorMessages });
            } else {
                return res.status(500).json({ error: 'Internal Server Error' });
            }
        }
    };
