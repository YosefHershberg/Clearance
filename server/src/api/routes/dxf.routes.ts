import { Router } from 'express';
import * as ctrl from '../controllers/dxf-file.controller';
import { auth, uploadDxf as uploadDxfMiddleware, validate } from '../../middlewares';
import { projectIdParamSchema, dxfIdParamSchema } from '../schemas/dxf.schemas';

// Nested under /api/projects/:projectId/dxf — mounted separately from the
// DXF-detail route which is at /api/dxf/:id.
export const projectDxfRouter = Router({ mergeParams: true });
projectDxfRouter.use(auth);
projectDxfRouter.post(
    '/',
    validate(projectIdParamSchema),
    uploadDxfMiddleware.single('file'),
    ctrl.uploadDxf,
);
projectDxfRouter.get('/', validate(projectIdParamSchema), ctrl.listProjectDxfFiles);

export const dxfRouter = Router();
dxfRouter.use(auth);
dxfRouter.get('/:id', validate(dxfIdParamSchema), ctrl.getDxfFile);
