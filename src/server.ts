import app from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './lib/prisma.js';

const server = app.listen(env.PORT, () => logger.info(`Listening on :${env.PORT}`));

function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref(); // force exit if hung
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => {
  logger.fatal(err);
  shutdown('unhandledRejection');
});
process.on('uncaughtException', (err) => {
  logger.fatal(err);
  process.exit(1);
});