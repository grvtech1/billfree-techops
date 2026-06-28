import { z } from 'zod';
import {
  createLogger,
  createPool,
  dbEnvShape,
  jwtEnvShape,
  loadEnv,
  pingDb,
} from '@billfree/service-common';
import { buildMonolith } from './server.js';

// All env every composed module needs, validated once at boot.
const env = loadEnv({
  ...dbEnvShape,
  ...jwtEnvShape,
  INTAKE_API_KEY: z.string().min(16).optional(),
  GOOGLE_CLIENT_IDS: z.string().optional().default(''),
  REQUIRE_GOOGLE_AUTH: z.enum(['true', 'false']).optional(),
  CORS_ORIGINS: z.string().default('*'),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  GEMINI_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z
    .string()
    .transform((v) => v === 'true')
    .optional()
    .default('false'),
  SMTP_FROM: z.string().optional().default('reports@billfree.in'),
  ADMIN_EMAILS: z.string().optional().default('admin@billfree.in,manager@billfree.in'),
});

const logger = createLogger({
  service: env.SERVICE_NAME,
  level: env.LOG_LEVEL,
  pretty: env.NODE_ENV === 'development',
});

const googleClientIds = env.GOOGLE_CLIENT_IDS.split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const requireGoogleAuth =
  env.NODE_ENV === 'production' && env.REQUIRE_GOOGLE_AUTH !== 'false';

// Same fail-fast guard as auth-service: don't boot into an auth-bypass state.
if (requireGoogleAuth && googleClientIds.length === 0) {
  logger.error(
    'GOOGLE_CLIENT_IDS is required when Google auth is enforced (production). ' +
      'Set GOOGLE_CLIENT_IDS or explicitly set REQUIRE_GOOGLE_AUTH=false for non-prod.',
  );
  process.exit(1);
}

const pool = createPool({ connectionString: env.DATABASE_URL, max: env.DB_POOL_MAX });
const corsOrigins =
  env.CORS_ORIGINS === '*' ? true : env.CORS_ORIGINS.split(',').map((s) => s.trim());

async function start(): Promise<void> {
  const app = await buildMonolith({
    pool,
    jwt: { secret: env.JWT_SECRET, issuer: env.JWT_ISSUER },
    intakeApiKey: env.INTAKE_API_KEY,
    googleClientIds,
    requireGoogleAuth,
    corsOrigins,
    rateLimitMax: env.RATE_LIMIT_MAX,
    readiness: () => pingDb(pool),
    logger,
    emailConfig: {
      geminiApiKey: env.GEMINI_API_KEY,
      smtpHost: env.SMTP_HOST,
      smtpPort: env.SMTP_PORT,
      smtpUser: env.SMTP_USER,
      smtpPass: env.SMTP_PASS,
      smtpSecure: env.SMTP_SECURE,
      smtpFrom: env.SMTP_FROM,
      adminEmails: env.ADMIN_EMAILS,
    },
  });

  if (!env.INTAKE_API_KEY) logger.warn('INTAKE_API_KEY not set — external intake routes are disabled');
  // NOTE: the monthly-report scheduler is intentionally NOT run in-process here
  // (it double-sends across replicas). Run it as a Kubernetes CronJob hitting
  // POST /reports/monthly/email. The report routes themselves are fully active.

  try {
    await app.listen({ host: '0.0.0.0', port: env.PORT });
    logger.info({ port: env.PORT }, `${env.SERVICE_NAME} (monolith) listening`);
  } catch (err) {
    logger.error({ err }, 'failed to start');
    process.exit(1);
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    try {
      await app.close();
      await pool.end();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void start();
