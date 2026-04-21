import { config } from './config';
import { logger } from './logger';
import { db } from './db';
import { createState } from './job';
import { FCMProvider } from './push';
import { createServer } from './server';

const state = createState();
const provider = new FCMProvider();

const app = createServer(state, provider);
const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'HTTP server listening');
});

logger.info('pushit-service started');

function shutdown(): void {
  logger.info('shutting down');
  server.close(() => {
    db.end().then(() => {
      logger.info('shutdown complete');
      process.exit(0);
    }).catch(() => {
      process.exit(1);
    });
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
