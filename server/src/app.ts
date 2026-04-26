import express from 'express';
import morgan from 'morgan';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import * as middlewares from './middlewares';
import api from './api/routes';
import { healthCheck } from './api/controllers/healthCheck.controller';
import rateLimiter from './config/rateLimit';
import env from './utils/env';

const app = express();

app.set('trust proxy', 1);

app.use(middlewares.requestId);
app.use(morgan('dev'));
app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(rateLimiter);
app.use(cookieParser());
app.use(express.json());

app.get('/health', healthCheck);

app.use('/api', api);

app.use(middlewares.notFound);
app.use(middlewares.errorHandler);

export default app;
