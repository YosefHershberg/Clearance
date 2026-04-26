import { Router } from 'express';
import { auth, validate } from '../../middlewares';
import { serveRender } from '../controllers/renders.controller';
import { renderParamSchema } from '../schemas/renders.schemas';

export const rendersRouter = Router();
rendersRouter.use(auth);
rendersRouter.get(
    '/:dxfFileId/:filename',
    validate(renderParamSchema),
    serveRender,
);
