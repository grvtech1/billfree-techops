import { createLogger, jwtEnvShape, loadEnv } from '@billfree/service-common';
import { z } from 'zod';
import { buildServer } from './server.js';
import { staticDirectory } from './directory.js';

// GOOGLE_CLIENT_IDS: comma-separated list of accepted OAuth `aud` values.
const env = loadEnv({
  ...jwtEnvShape,
  GOOGLE_CLIENT_IDS: z.string().optional().default(''),
  REQUIRE_GOOGLE_AUTH: z.enum(['true', 'false']).optional(),
  // Cross-origin SPA (e.g. Cloudflare Pages) needs 'none'; same-origin uses 'lax'.
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).optional().default('lax'),
});

const logger = createLogger({
  service: env.SERVICE_NAME,
  level: env.LOG_LEVEL,
  pretty: env.NODE_ENV === 'development',
});

const googleClientIds = env.GOOGLE_CLIENT_IDS.split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Fail-fast: in production we require Google verification by default. If it is
// enabled but no client IDs are configured, the audience check would have
// nothing to validate against — refuse to start rather than boot into an
// auth-bypass state.
const requireGoogleAuth =
  env.NODE_ENV === 'production' && env.REQUIRE_GOOGLE_AUTH !== 'false';
if (requireGoogleAuth && googleClientIds.length === 0) {
  logger.error(
    'GOOGLE_CLIENT_IDS is required when Google auth is enforced (production). ' +
      'Set GOOGLE_CLIENT_IDS or explicitly set REQUIRE_GOOGLE_AUTH=false for non-prod.',
  );
  process.exit(1);
}

const app = buildServer({
  jwt: { secret: env.JWT_SECRET, issuer: env.JWT_ISSUER },
  directory: staticDirectory,
  googleClientIds,
  // Secure cookies over HTTPS in production; 'none' sameSite also implies secure.
  cookieSecure: env.NODE_ENV === 'production' || env.COOKIE_SAMESITE === 'none',
  cookieSameSite: env.COOKIE_SAMESITE,
  logger,
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down');
  try {
    await app.close();
  } catch (err) {
    logger.error({ err }, 'error during shutdown');
  } finally {
    process.exit(0);
  }
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
