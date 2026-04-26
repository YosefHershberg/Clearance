import { envSchema } from './env';

const valid = {
    PORT: '3001',
    DATABASE_URL: 'postgresql://u:p@h:5432/d',
    CORS_ORIGIN: 'http://localhost:5173',
    JWT_SECRET: 'x'.repeat(32),
    ADMIN_EMAIL: 'admin@example.com',
    ADMIN_INITIAL_PASSWORD: 'pass1234',
    ANTHROPIC_API_KEY: 'sk-ant-test-placeholder-value',
};

describe('envSchema', () => {
    it('parses a complete env', () => {
        const result = envSchema.safeParse(valid);
        expect(result.success).toBe(true);
    });

    it('rejects JWT_SECRET shorter than 32', () => {
        const result = envSchema.safeParse({ ...valid, JWT_SECRET: 'short' });
        expect(result.success).toBe(false);
    });

    it('rejects invalid ADMIN_EMAIL', () => {
        const result = envSchema.safeParse({ ...valid, ADMIN_EMAIL: 'not-an-email' });
        expect(result.success).toBe(false);
    });

    it('rejects ADMIN_INITIAL_PASSWORD shorter than 8', () => {
        const result = envSchema.safeParse({ ...valid, ADMIN_INITIAL_PASSWORD: 'short' });
        expect(result.success).toBe(false);
    });

    it('rejects non-URL CORS_ORIGIN', () => {
        const result = envSchema.safeParse({ ...valid, CORS_ORIGIN: 'not-a-url' });
        expect(result.success).toBe(false);
    });

    it('rejects ANTHROPIC_API_KEY shorter than 10', () => {
        const result = envSchema.safeParse({ ...valid, ANTHROPIC_API_KEY: 'short' });
        expect(result.success).toBe(false);
    });
});
