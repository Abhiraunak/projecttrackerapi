import app from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './lib/prisma.js';
import { purgeExpiredSessions } from './lib/session.js';
const server = app.listen(env.PORT, () => logger.info(`Listening on :${env.PORT}`));
// Delete expired refresh tokens now and every 6 hours
const purge = () => purgeExpiredSessions().catch((err) => logger.error({ err }, 'session purge failed'));
void purge();
const purgeTimer = setInterval(purge, 6 * 60 * 60 * 1000);
purgeTimer.unref();
let shuttingDown = false;
function shutdown(signal) {
    if (shuttingDown)
        return; // SIGTERM followed by an unhandled rejection must not close the server twice
    shuttingDown = true;
    logger.info(`${signal} received, shutting down`);
    clearInterval(purgeTimer);
    server.close(async () => {
        try {
            await prisma.$disconnect();
        }
        catch (err) {
            logger.error({ err }, 'prisma disconnect failed');
        }
        process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref(); // force exit if hung
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => {
    logger.fatal({ err }, 'unhandled rejection');
    shutdown('unhandledRejection');
});
process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception');
    process.exit(1);
});
//# sourceMappingURL=server.js.map