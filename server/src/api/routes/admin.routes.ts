import { Router } from 'express';
import * as ctrl from '../controllers/admin-users.controller';
import * as statsCtrl from '../controllers/admin-stats.controller';
import { validate, auth, requireAdmin } from '../../middlewares';
import {
    listUsersSchema,
    createUserSchema,
    idParamSchema,
    resetPasswordSchema,
    setActiveSchema,
} from '../schemas/admin-users.schemas';

const router = Router();

router.use(auth, requireAdmin);

router.get('/users', validate(listUsersSchema), ctrl.listUsers);
router.post('/users', validate(createUserSchema), ctrl.createUser);
router.delete('/users/:id', validate(idParamSchema), ctrl.deleteUser);
router.post('/users/:id/reset-password', validate(resetPasswordSchema), ctrl.resetPassword);
router.patch('/users/:id/active', validate(setActiveSchema), ctrl.setActive);
router.get('/stats', statsCtrl.stats);

export default router;
