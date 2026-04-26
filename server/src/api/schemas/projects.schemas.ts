import { z } from 'zod';

const nameMax = 120;
const descriptionMax = 2000;
const localityMax = 120;

export const createProjectSchema = z.object({
    body: z.strictObject({
        name: z.string().trim().min(1, 'Name is required').max(nameMax),
        description: z.string().trim().max(descriptionMax).optional(),
        locality: z.string().trim().max(localityMax).optional(),
    }),
    query: z.object({}),
    params: z.object({}),
});

export const listProjectsSchema = z.object({
    body: z.object({}).optional().default({}),
    query: z.object({
        q: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        cursor: z.string().optional(),
        all: z.enum(['true', 'false']).optional(),
    }),
    params: z.object({}),
});

export const projectIdSchema = z.object({
    body: z.object({}).optional().default({}),
    query: z.object({}),
    params: z.strictObject({ id: z.string().min(1) }),
});

export const patchProjectSchema = z.object({
    body: z
        .strictObject({
            name: z.string().trim().min(1).max(nameMax).optional(),
            description: z.string().trim().max(descriptionMax).nullable().optional(),
            locality: z.string().trim().max(localityMax).nullable().optional(),
        })
        .refine((obj) => Object.keys(obj).length > 0, {
            message: 'At least one field required',
        }),
    query: z.object({}),
    params: z.strictObject({ id: z.string().min(1) }),
});
