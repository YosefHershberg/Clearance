import { z } from 'zod';
import * as dotenv from 'dotenv';

dotenv.config();

export const envSchema = z.object({
    PORT: z.string(),
    DATABASE_URL: z.string(),
    CORS_ORIGIN: z.string().url(),
    JWT_SECRET: z.string().min(32),
    ADMIN_EMAIL: z.string().email(),
    ADMIN_INITIAL_PASSWORD: z.string().min(8),
    UPLOADS_DIR: z.string().default('uploads'),
    PYTHON_SIDECAR_URL: z.string().url().default('http://localhost:3002'),
    ANTHROPIC_API_KEY: z.string().min(10, 'ANTHROPIC_API_KEY required'),
});

const parsedResults = envSchema.safeParse(process.env);

if (!parsedResults.success) {
    console.error(parsedResults.error);
    throw new Error('Environment variables are not correctly set');
}

const env = parsedResults.data;

export default { ...env, NODE_ENV: process.env.NODE_ENV || 'development' };
