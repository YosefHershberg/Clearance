import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { FileKind } from '../generated/prisma/client';
import env from '../utils/env';

const KIND_DIRS: Record<FileKind, string> = {
    DXF: 'dxf',
    TAVA: 'tava',
    ADDON: 'addon',
    RENDER: 'renders',
    EXTRACTION_SCRIPT: 'scripts',
};

export interface StorageClient {
    writeStream(kind: FileKind, filename: string): NodeJS.WritableStream;
    readStream(uri: string): NodeJS.ReadableStream;
    delete(uri: string): Promise<void>;
    exists(uri: string): Promise<boolean>;
    resolveUri(kind: FileKind, filename: string): string;
    saveBuffer(
        kind: FileKind,
        filename: string,
        data: Buffer,
    ): Promise<{ uri: string; sha256: string; sizeBytes: number }>;
    readText(uri: string): Promise<string>;
    removeDirIfExists(uri: string): Promise<void>;
}

class LocalStorageClient implements StorageClient {
    private root = path.resolve(env.UPLOADS_DIR);

    private absolute(uri: string): string {
        return path.isAbsolute(uri) ? uri : path.resolve(uri);
    }

    resolveUri(kind: FileKind, filename: string): string {
        return path
            .join(env.UPLOADS_DIR, KIND_DIRS[kind], filename)
            .replace(/\\/g, '/');
    }

    writeStream(kind: FileKind, filename: string): NodeJS.WritableStream {
        const abs = path.join(this.root, KIND_DIRS[kind], filename);
        return createWriteStream(abs);
    }

    readStream(uri: string): NodeJS.ReadableStream {
        return createReadStream(this.absolute(uri));
    }

    async delete(uri: string): Promise<void> {
        await unlink(this.absolute(uri));
    }

    async exists(uri: string): Promise<boolean> {
        try {
            await stat(this.absolute(uri));
            return true;
        } catch {
            return false;
        }
    }

    async saveBuffer(
        kind: FileKind,
        filename: string,
        data: Buffer,
    ): Promise<{ uri: string; sha256: string; sizeBytes: number }> {
        const uri = this.resolveUri(kind, filename);
        const abs = this.absolute(uri);
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, data);
        const sha256 = createHash('sha256').update(data).digest('hex');
        return { uri, sha256, sizeBytes: data.byteLength };
    }

    async readText(uri: string): Promise<string> {
        return (await readFile(this.absolute(uri))).toString('utf-8');
    }

    async removeDirIfExists(uri: string): Promise<void> {
        const abs = this.absolute(uri);
        await rm(abs, { recursive: true, force: true });
    }
}

export const storage: StorageClient = new LocalStorageClient();

export async function ensureStorageDirs(): Promise<void> {
    const root = path.resolve(env.UPLOADS_DIR);
    for (const sub of Object.values(KIND_DIRS)) {
        await mkdir(path.join(root, sub), { recursive: true });
    }
}
