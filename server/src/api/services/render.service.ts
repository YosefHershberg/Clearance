import path from 'node:path';
import fs from 'node:fs';
import { HttpError } from '../../lib/HttpError';
import { ensureProjectAccess } from '../../lib/project-access';
import env from '../../utils/env';
import * as da from '../data-access/sheet-render.da';
import type { UserRole } from '../../generated/prisma/client';

type Actor = { id: string; role: UserRole };

export interface RenderToServe {
    absolutePath: string;
}

/**
 * Resolves the on-disk path for a sheet render if the caller has access.
 * Throws HttpError for missing sheet, soft-deleted DxfFile, forbidden access,
 * path-escape, or missing file on disk.
 */
export async function resolveRenderForServing(
    user: Actor,
    dxfFileId: string,
    filename: string,
): Promise<RenderToServe> {
    const sheet = await da.findByDxfAndFilename(dxfFileId, filename);
    if (!sheet) throw new HttpError(404, 'render_not_found');
    if (sheet.dxfFile.deletedAt) throw new HttpError(404, 'render_not_found');

    await ensureProjectAccess(user, sheet.dxfFile.projectId);

    const root = path.resolve(env.UPLOADS_DIR);
    // storedFile.uri already carries the `uploads/` prefix (see
    // storage.client.resolveUri), so don't prepend UPLOADS_DIR again.
    const abs = path.resolve(sheet.storedFile.uri);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
        throw new HttpError(400, 'path_escape');
    }
    if (!fs.existsSync(abs)) throw new HttpError(404, 'file_missing');

    return { absolutePath: abs };
}
