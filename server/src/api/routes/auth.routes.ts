import { Router } from 'express';
import * as ctrl from '../controllers/auth.controller';
import { validate, auth } from '../../middlewares';
import { loginSchema, changePasswordSchema } from '../schemas/auth.schemas';
import loginRateLimit from '../../config/loginRateLimit';

const router = Router();

router.post('/login', loginRateLimit, validate(loginSchema), ctrl.login);
router.post('/logout', ctrl.logout);
router.get('/me', auth, ctrl.me);
router.post('/change-password', auth, validate(changePasswordSchema), ctrl.changePassword);

export default router;
