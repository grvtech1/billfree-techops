import { createLogger, jwtEnvShape, loadEnv } from '@billfree/service-common';
import { buildServer } from './server.js';
import { staticDirectory } from './directory.js';

const env = loadEnv({ ...jwtEnvShape });
const logger = createLogger({
  service: env.SERVICE_NAME,
  level: env.LOG_LEVEL,
  pretty: env.NODE_ENV === 'development',
});

const app = buildServer({
  jwt: { secret: env.JWT_SECRET, issuer: env.JWT_ISSUER },
  directory: staticDirectory,
  logger,
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down');
  await app.close();
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
