import { storage } from './storage.client';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import env from '../utils/env';

describe('storage.saveBuffer', () => {
    it('writes the buffer and returns a stable sha256', async () => {
        const payload = Buffer.from('print("hello")\n', 'utf-8');
        const result = await storage.saveBuffer(
            'EXTRACTION_SCRIPT',
            `test-script-${Date.now()}.py`,
            payload,
        );
        expect(result.sizeBytes).toBe(payload.byteLength);
        expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
        const readBack = await storage.readText(result.uri);
        expect(readBack).toBe('print("hello")\n');
    });

    it('produces identical sha256 for identical content', async () => {
        const payload = Buffer.from('same-bytes', 'utf-8');
        const a = await storage.saveBuffer(
            'EXTRACTION_SCRIPT',
            `a-${Date.now()}.py`,
            payload,
        );
        const b = await storage.saveBuffer(
            'EXTRACTION_SCRIPT',
            `b-${Date.now()}.py`,
            payload,
        );
        expect(a.sha256).toBe(b.sha256);
    });
});

describe('storage.removeDirIfExists', () => {
    it('is idempotent on missing paths', async () => {
        await expect(
            storage.removeDirIfExists(
                path.join(env.UPLOADS_DIR, `nonexistent-${Date.now()}`),
            ),
        ).resolves.toBeUndefined();
    });

    it('removes an existing directory recursively', async () => {
        const dirUri = path
            .join(env.UPLOADS_DIR, `rmtest-${Date.now()}`)
            .replace(/\\/g, '/');
        const abs = path.resolve(dirUri);
        await mkdir(abs, { recursive: true });
        await writeFile(path.join(abs, 'inner.txt'), 'x');
        await storage.removeDirIfExists(dirUri);
        expect(await storage.exists(dirUri)).toBe(false);
    });
});
