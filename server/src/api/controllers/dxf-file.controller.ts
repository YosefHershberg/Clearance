import type { Request, Response, NextFunction } from 'express';
import { HttpError } from '../../lib/HttpError';
import { computeFileSha256 } from '../../lib/file-hash';
import { decodeOriginalName } from '../../middlewares';
import * as svc from '../services/dxf-file.service';

function requireUser(req: Request) {
    if (!req.user) throw new HttpError(401, 'Unauthenticated');
    return req.user;
}

export async function uploadDxf(req: Request, res: Response, next: NextFunction) {
    try {
        const user = requireUser(req);
        const projectId = (req.params as { projectId: string }).projectId;
        const file = req.file;
        if (!file) throw new HttpError(400, 'file_required');

        const sha256 = await computeFileSha256(file.path);
        const originalName = decodeOriginalName(file.originalname);

        const dxf = await svc.uploadDxfForProject(user, {
            projectId,
            absoluteFilePath: file.path,
            filenameOnDisk: file.filename,
            originalName,
            sizeBytes: file.size,
            sha256,
        });

        res.status(201).json({ data: { dxfFile: dxf } });
    } catch (err) {
        next(err);
    }
}

export async function listProjectDxfFiles(req: Request, res: Response, next: NextFunction) {
    try {
        const user = requireUser(req);
        const projectId = (req.params as { projectId: string }).projectId;
        const dxfFiles = await svc.listProjectDxfFiles(user, projectId);
        res.json({ data: { dxfFiles } });
    } catch (err) {
        next(err);
    }
}

export async function getDxfFile(req: Request, res: Response, next: NextFunction) {
    try {
        const user = requireUser(req);
        const id = (req.params as { id: string }).id;
        const dxfFile = await svc.getDxfFile(user, id);
        res.json({ data: { dxfFile } });
    } catch (err) {
        next(err);
    }
}
