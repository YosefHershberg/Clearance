import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import env from '../utils/env';

const ONE_MB = 1024 * 1024;
export const DXF_MAX_SIZE = 100 * ONE_MB;

function generateFilename(ext: string): string {
    // cuid-ish: random 24-char base36 id — no need to import cuid here
    return `${crypto.randomBytes(12).toString('hex')}${ext}`;
}

const dxfStorage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, path.join(path.resolve(env.UPLOADS_DIR), 'dxf'));
    },
    filename: (_req, _file, cb) => {
        cb(null, generateFilename('.dxf'));
    },
});

export const uploadDxf = multer({
    storage: dxfStorage,
    limits: { fileSize: DXF_MAX_SIZE, files: 1 },
    fileFilter: (_req, file, cb) => {
        if (!file.originalname.toLowerCase().endsWith('.dxf')) {
            cb(new Error('dxf_extension_required'));
            return;
        }
        cb(null, true);
    },
});

/**
 * multer decodes filename headers as latin1 by default, which mangles Hebrew
 * file names. Re-encoding latin1 → utf-8 recovers them in the common case.
 * Falls back to the original string when the re-encode is a no-op or throws.
 */
export function decodeOriginalName(name: string): string {
    try {
        const recovered = Buffer.from(name, 'latin1').toString('utf8');
        return recovered && recovered !== name ? recovered : name;
    } catch {
        return name;
    }
}
