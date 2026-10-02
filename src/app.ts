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

const app = express();

app.set('trust proxy', 1);   // behind Nginx/ALB/Render etc., so rate limiting sees real IPs
app.disable('x-powered-by');

app.use(pinoHttp({ logger }));
app.use(helmet());           // CSP, HSTS, noSniff, frameguard...
app.use(cors(corsOptions));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use(cookieParser());
app.use(hpp());
app.use(compression());

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/v1/auth', authRoutes);

const PORT = process.env.PORT || 4000;

// Start the server
app.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`);
});

app.use(notFound);
app.use(errorHandler);       // must be last

export default app;