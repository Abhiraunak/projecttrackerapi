import { env } from './env.js';
import { HttpError } from '../lib/error.js';
const allowed = env.CORS_ORIGINS.split(',').map((o) => o.trim());
export const corsOptions = {
    origin(origin, cb) {
        // No Origin header = curl / server-to-server / same-origin
        if (!origin || allowed.includes(origin))
            return cb(null, true);
        cb(new HttpError(403, 'Origin not allowed'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    maxAge: 600,
};
//# sourceMappingURL=cors.js.map