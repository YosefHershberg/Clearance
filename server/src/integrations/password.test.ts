import { hash, compare } from './password';

describe('password integration', () => {
    it('hash → compare roundtrip returns true', async () => {
        const hashed = await hash('my-password');
        expect(await compare('my-password', hashed)).toBe(true);
    });

    it('compare returns false for wrong password', async () => {
        const hashed = await hash('my-password');
        expect(await compare('wrong', hashed)).toBe(false);
    });

    it('produces different hashes for identical plaintext (salt)', async () => {
        const a = await hash('x');
        const b = await hash('x');
        expect(a).not.toBe(b);
    });

    it('uses bcrypt cost 10 (hash starts with $2a$10$ or $2b$10$)', async () => {
        const hashed = await hash('x');
        expect(hashed).toMatch(/^\$2[ab]\$10\$/);
    });
});
