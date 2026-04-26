import { Router } from 'express';
import * as ctrl from '../controllers/projects.controller';
import { validate, auth } from '../../middlewares';
import {
    createProjectSchema,
    listProjectsSchema,
    patchProjectSchema,
    projectIdSchema,
} from '../schemas/projects.schemas';

const router = Router();

router.use(auth);

router.post('/', validate(createProjectSchema), ctrl.createProject);
router.get('/', validate(listProjectsSchema), ctrl.listProjects);
router.get('/:id', validate(projectIdSchema), ctrl.getProject);
router.patch('/:id', validate(patchProjectSchema), ctrl.patchProject);
router.delete('/:id', validate(projectIdSchema), ctrl.deleteProject);

export default router;
