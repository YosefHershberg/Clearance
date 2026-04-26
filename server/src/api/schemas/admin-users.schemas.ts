import { z } from 'zod';

// GET/DELETE routes: req.body is undefined in Express 5 (body-parser never runs
// without a content-type), so body must be .optional().default({}) — not z.object({}).
export const listUsersSchema = z.object({
    body: z.object({}).optional().default({}),
    query: z.object({
        q: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        cursor: z.string().optional(),
    }),
    params: z.object({}),
});

export const createUserSchema = z.object({
    body: z.strictObject({
        email: z.string().email(),
        name: z.string().min(1).max(120),
        initialPassword: z.string().min(8),
    }),
    query: z.object({}),
    params: z.object({}),
});

export const idParamSchema = z.object({
    body: z.object({}).optional().default({}),
    query: z.object({}),
    params: z.strictObject({ id: z.string().min(1) }),
});

export const resetPasswordSchema = z.object({
    body: z.strictObject({
        newPassword: z.string().min(8),
    }),
    query: z.object({}),
    params: z.strictObject({ id: z.string().min(1) }),
});

export const setActiveSchema = z.object({
    body: z.strictObject({
        isActive: z.boolean(),
    }),
    query: z.object({}),
    params: z.strictObject({ id: z.string().min(1) }),
});
