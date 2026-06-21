import {
  createLogger,
  createPool,
  dbEnvShape,
  jwtEnvShape,
  loadEnv,
  pingDb,
} from '@billfree/service-common';
import { buildServer } from './server.js';
import { PgAnalyticsRepository } from './repository.js';

const env = loadEnv({ ...dbEnvShape, ...jwtEnvShape });
const logger = createLogger({
  service: env.SERVICE_NAME,
  level: env.LOG_LEVEL,
  pretty: env.NODE_ENV === 'development',
});
const pool = createPool({ connectionString: env.DATABASE_URL, max: env.DB_POOL_MAX });

const app = buildServer({
  repo: new PgAnalyticsRepository(pool),
  jwt: { secret: env.JWT_SECRET, issuer: env.JWT_ISSUER },
  readiness: () => pingDb(pool),
  logger,
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down');
  await app.close();
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

app
  .listen({ host: '0.0.0.0', port: env.PORT })
  .then(() => logger.info({ port: env.PORT }, `${env.SERVICE_NAME} listening`))
  .catch((err) => {
    logger.error({ err }, 'failed to start');
    process.exit(1);
  });
