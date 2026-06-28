import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import {
  registerErrorHandler,
  registerHealth,
  registerMetrics,
  type JwtConfig,
} from '@billfree/service-common';
import { registerAuthRoutes, type Directory } from './routes.js';

// Re-exported so directory.ts and tests keep importing it from './server.js'.
export type { Directory } from './routes.js';

export interface AuthServerDeps {
  jwt: JwtConfig;
  directory: Directory;
  tokenTtlSeconds?: number;
  // [GAP-01] Accepted Google OAuth Client IDs (from GOOGLE_CLIENT_IDS env var).
  googleClientIds?: string[];
  logger?: FastifyBaseLogger | boolean;
}

export function buildServer(deps: AuthServerDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false });
  registerErrorHandler(app);
  registerMetrics(app, 'auth-service');
  registerHealth(app);

  // Enforce Google Auth in production, unless explicitly bypassed via env var (e.g. for testing/demo).
  const requireGoogleAuth =
    process.env.NODE_ENV === 'production' && process.env.REQUIRE_GOOGLE_AUTH !== 'false';

  registerAuthRoutes(app, {
    jwt: deps.jwt,
    directory: deps.directory,
    tokenTtlSeconds: deps.tokenTtlSeconds,
    googleClientIds: deps.googleClientIds,
    requireGoogleAuth,
  });

  return app;
}
