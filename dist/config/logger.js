import pino from 'pino';
import { isProd } from './env.js';
export const logger = pino({
    level: isProd ? 'info' : 'debug',
    redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    transport: isProd ? undefined : { target: 'pino-pretty' },
});
//# sourceMappingURL=logger.js.map