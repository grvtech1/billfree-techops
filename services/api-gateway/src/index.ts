import { z } from 'zod';
import { createLogger, jwtEnvShape, loadEnv } from '@billfree/service-common';
import { buildServer } from './server.js';

const env = loadEnv({
  ...jwtEnvShape,
  TICKET_SERVICE_URL: z.string().url(),
  ANALYTICS_SERVICE_URL: z.string().url(),
  AUTH_SERVICE_URL: z.string().url(),
  CALLLOG_SERVICE_URL: z.string().url(),
  REPORT_SERVICE_URL: z.string().url(),
  INTAKE_API_KEY: z.string().min(16).optional(),
  CORS_ORIGINS: z.string().default('*'),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  REPORT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
});

const logger = createLogger({
  service: env.SERVICE_NAME,
  level: env.LOG_LEVEL,
  pretty: env.NODE_ENV === 'development',
});

async function main(): Promise<void> {
  const corsOrigins = env.CORS_ORIGINS === '*' ? true : env.CORS_ORIGINS.split(',').map((s) => s.trim());

  const app = await buildServer({
    jwt: { secret: env.JWT_SECRET, issuer: env.JWT_ISSUER },
    upstreams: {
      auth: env.AUTH_SERVICE_URL,
      tickets: env.TICKET_SERVICE_URL,
      analytics: env.ANALYTICS_SERVICE_URL,
      calllog: env.CALLLOG_SERVICE_URL,
      reports: env.REPORT_SERVICE_URL,
    },
    intakeApiKey: env.INTAKE_API_KEY,
    corsOrigins,
    rateLimitMax: env.RATE_LIMIT_MAX,
    authRateLimitMax: env.AUTH_RATE_LIMIT_MAX,
    reportRateLimitMax: env.REPORT_RATE_LIMIT_MAX,
    logger,
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: '0.0.0.0', port: env.PORT });
  logger.info({ port: env.PORT }, `${env.SERVICE_NAME} listening`);
}

void main().catch((err) => {
  logger.error({ err }, 'failed to start');
  process.exit(1);
});
