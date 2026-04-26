import { z } from 'zod';

export const loginSchema = z.object({
    body: z.strictObject({
        email: z.string().email(),
        password: z.string().min(1),
    }),
    query: z.object({}),
    params: z.object({}),
});

export const changePasswordSchema = z.object({
    body: z.strictObject({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(8),
    }),
    query: z.object({}),
    params: z.object({}),
});
