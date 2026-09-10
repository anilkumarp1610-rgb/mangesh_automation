import { createApp } from './app.js';
import { env } from './config/env.js';
import { assertDbReachable, closePool } from './db/pool.js';
import { assertSchema } from './db/schema.js';
import { logger } from './lib/logger.js';

async function main() {
  try {
    await assertDbReachable();
    await assertSchema();
  } catch (err) {
    logger.error({ err }, 'Database unreachable at startup — check DB_* env vars');
    process.exit(1);
  }

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`tracker-backend listening on http://localhost:${env.PORT}`);
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

void main();
