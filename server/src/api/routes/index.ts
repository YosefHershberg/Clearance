import express from 'express';
import authRoutes from './auth.routes';
import adminRoutes from './admin.routes';
import projectsRoutes from './projects.routes';
import { projectDxfRouter, dxfRouter } from './dxf.routes';
import { rendersRouter } from './renders.routes';

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/admin', adminRoutes);
router.use('/projects', projectsRoutes);
router.use('/projects/:projectId/dxf', projectDxfRouter);
router.use('/dxf', dxfRouter);
router.use('/renders', rendersRouter);

export default router;
