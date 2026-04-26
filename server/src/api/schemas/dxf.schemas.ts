import { z } from 'zod';

export const projectIdParamSchema = z.object({
    body: z.object({}).optional().default({}),
    query: z.object({}),
    params: z.strictObject({ projectId: z.string().min(1) }),
});

export const dxfIdParamSchema = z.object({
    body: z.object({}).optional().default({}),
    query: z.object({}),
    params: z.strictObject({ id: z.string().min(1) }),
});
