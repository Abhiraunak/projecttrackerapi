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
import drawingRoutes from './modules/drawings/drawings.routes.js';
import userRoutes from './modules/users/users.routes.js';
import { env } from './config/env.js';
import { requireCsrfHeader } from './middleware/csrf.js';
import catalogRoutes from './modules/materials/catalog.routes.js';
import inventoryRoutes from './modules/inventory/inventory.routes.js';
import boqRoutes from './modules/boqs/boqs.routes.js';
import { jsonBody } from './middleware/jsonBody.js';
import auditRoutes from './modules/audit/audit.routes.js';
import pushRoutes from './modules/push/push.routes.js';
import accessRoutes from './modules/access/access.routes.js';
import adminRoutes from './modules/admin/admin.routes.js';
import materialPlanRoutes from './modules/materialPlan/plan.routes.js';
import orderRoutes from './modules/orders/orders.routes.js';
import alertRoutes from './modules/alerts/alerts.routes.js';
import requestRoutes from './modules/requests/requests.routes.js';
import dashboardRoutes from './modules/dashboard/dashboard.routes.js';
const app = express();
app.set('trust proxy', 1); // behind Nginx/ALB/Render etc., so rate limiting sees real IPs
app.disable('x-powered-by');
app.use(pinoHttp({ logger }));
app.use(helmet()); // CSP, HSTS, noSniff, frameguard...
app.use(cors(corsOptions));
if (env.COOKIE_SAMESITE === 'none')
    app.use(requireCsrfHeader);
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use(jsonBody);
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(cookieParser());
app.use(hpp());
app.use(compression());
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/projects', projectRoutes);
app.use('/api/v1/attendance', attendanceRoutes);
app.use('/api/v1/drawings', drawingRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/materials', catalogRoutes);
app.use('/api/v1', inventoryRoutes);
app.use('/api/v1', auditRoutes);
app.use('/api/v1/boqs', boqRoutes);
app.use('/api/v1/push', pushRoutes);
app.use('/api/v1', accessRoutes); // GET /me/access
app.use('/api/v1/admin', adminRoutes); // admin page
app.use('/api/v1', inventoryRoutes);
app.use('/api/v1', materialPlanRoutes);
app.use('/api/v1', orderRoutes);
app.use('/api/v1', alertRoutes);
app.use('/api/v1', requestRoutes);
app.use('/api/v1', dashboardRoutes);
app.use(notFound);
app.use(errorHandler); // must be last
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => logger.info(`Server is running on port ${PORT}`));
export default app;
//# sourceMappingURL=app.js.map