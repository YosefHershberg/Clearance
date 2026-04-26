import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export async function computeFileSha256(absolutePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = createHash('sha256');
        createReadStream(absolutePath)
            .on('data', (chunk) => hash.update(chunk))
            .on('error', reject)
            .on('end', () => resolve(hash.digest('hex')));
    });
}
