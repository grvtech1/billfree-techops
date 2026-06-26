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
import { PgReportRepository } from './repository.js';
import { startMonthlyReportScheduler } from './scheduler.js';

const reportEnvShape = {
  ...dbEnvShape,
  ...jwtEnvShape,
  GEMINI_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z.string().transform((v) => v === 'true').optional().default('false'),
  SMTP_FROM: z.string().optional().default('reports@billfree.in'),
  ADMIN_EMAILS: z.string().optional().default('admin@billfree.in,manager@billfree.in'),
};

const env = loadEnv(reportEnvShape);

const logger = createLogger({
  service: env.SERVICE_NAME,
  level: env.LOG_LEVEL,
  pretty: env.NODE_ENV === 'development',
});

const pool = createPool({ connectionString: env.DATABASE_URL, max: env.DB_POOL_MAX });

const repo = new PgReportRepository(pool);

const emailConfig = {
  geminiApiKey: env.GEMINI_API_KEY,
  smtpHost: env.SMTP_HOST,
  smtpPort: env.SMTP_PORT,
  smtpUser: env.SMTP_USER,
  smtpPass: env.SMTP_PASS,
  smtpSecure: env.SMTP_SECURE,
  smtpFrom: env.SMTP_FROM,
  adminEmails: env.ADMIN_EMAILS,
};

const app = buildServer({
  repo,
  jwt: { secret: env.JWT_SECRET, issuer: env.JWT_ISSUER },
  serviceName: env.SERVICE_NAME,
  readiness: () => pingDb(pool),
  logger,
  emailConfig,
});

// Start background scheduler
const stopScheduler = startMonthlyReportScheduler({
  repo,
  logger,
  emailConfig,
});

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
    stopScheduler();
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

