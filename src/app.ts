import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import hpp from 'hpp';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import { logger } from './config/logger.js';
import { corsOptions } from './config/cors.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import authRoutes from './modules/auth/auth.routes.js';
import projectRoutes from './modules/projects/projects.routes.js';
import attendanceRoutes from './modules/attendance/attendance.routes.js';
import { env } from './config/env.js';
import { requireCsrfHeader } from './middleware/csrf.js';

const app = express();

app.set('trust proxy', 1);   // behind Nginx/ALB/Render etc., so rate limiting sees real IPs
app.disable('x-powered-by');

app.use(pinoHttp({ logger }));
app.use(helmet());           // CSP, HSTS, noSniff, frameguard...
app.use(cors(corsOptions));
if (env.COOKIE_SAMESITE === 'none') app.use(requireCsrfHeader);
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(cookieParser());
app.use(hpp());
app.use(compression());

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/projects', projectRoutes);
app.use('/api/v1/attendance', attendanceRoutes);

app.use(notFound);
app.use(errorHandler);   // must be last

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => logger.info(`Server is running on port ${PORT}`));

export default app;