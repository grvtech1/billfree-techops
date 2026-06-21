import { z } from 'zod';
import {
  createLogger,
  createPool,
  dbEnvShape,
  jwtEnvShape,
  loadEnv,
  pingDb,
} from '@billfree/service-common';
import { buildServer } from './server.js';
import { PgAgentRepository, PgAuditRepository, PgTicketRepository } from './repository.js';

const env = loadEnv({
  ...dbEnvShape,
  ...jwtEnvShape,
  // Optional: enables the WhatsApp/portal intake routes when set (≥16 chars).
  INTAKE_API_KEY: z.string().min(16).optional(),
});

const logger = createLogger({
  service: env.SERVICE_NAME,
  level: env.LOG_LEVEL,
  pretty: env.NODE_ENV === 'development',
});

const pool = createPool({ connectionString: env.DATABASE_URL, max: env.DB_POOL_MAX });

const app = buildServer({
  repo: new PgTicketRepository(pool),
  audit: new PgAuditRepository(pool),
  agents: new PgAgentRepository(pool),
  intakeApiKey: env.INTAKE_API_KEY,
  jwt: { secret: env.JWT_SECRET, issuer: env.JWT_ISSUER },
  serviceName: env.SERVICE_NAME,
  readiness: () => pingDb(pool),
  logger,
});

if (!env.INTAKE_API_KEY) logger.warn('INTAKE_API_KEY not set — external intake routes are disabled');

async function start(): Promise<void> {
  try {
    await app.listen({ host: '0.0.0.0', port: env.PORT });
    logger.info({ port: env.PORT }, `${env.SERVICE_NAME} listening`);
  } catch (err) {
    logger.error({ err }, 'failed to start');
    process.exit(1);
  }
}

// Graceful shutdown — K8s sends SIGTERM before removing the pod; finish
// in-flight requests and close the DB pool so we don't drop connections.
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down');
  try {
    await app.close();
    await pool.end();
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'error during shutdown');
    process.exit(1);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

void start();
