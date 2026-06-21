import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import httpProxy from '@fastify/http-proxy';
import rateLimit from '@fastify/rate-limit';
import cors from '@fastify/cors';
import {
  registerErrorHandler,
  registerHealth,
  registerMetrics,
  requireApiKey,
  requireAuth,
  type JwtConfig,
} from '@billfree/service-common';

export interface GatewayDeps {
  jwt: JwtConfig;
  upstreams: { auth: string; tickets: string; analytics: string; calllog: string; reports: string };
  // Shared key for the public external-channel intake (WhatsApp bot). When set,
  // /api/intake/* is exposed and guarded by the key instead of a user JWT.
  intakeApiKey?: string;
  corsOrigins?: string[] | boolean;
  rateLimitMax?: number;
  logger?: FastifyBaseLogger | boolean;
}

/**
 * The single public entry point. Responsibilities the services should NOT each
 * re-implement: CORS, edge rate-limiting, and authentication. Authenticated
 * requests are reverse-proxied to the owning service (which re-verifies the JWT
 * — defense in depth). `/auth/*` is public so clients can obtain a token.
 */
export async function buildServer(deps: GatewayDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? false, trustProxy: true });

  registerErrorHandler(app);
  await app.register(cors, { origin: deps.corsOrigins ?? true, credentials: true });
  await app.register(rateLimit, { max: deps.rateLimitMax ?? 100, timeWindow: '1 minute' });
  registerMetrics(app, 'api-gateway');
  registerHealth(app);

  const auth = requireAuth(deps.jwt);

  // Public — token issuance.
  await app.register(httpProxy, {
    upstream: deps.upstreams.auth,
    prefix: '/auth',
    rewritePrefix: '/auth',
  });

  // Protected — JWT enforced at the edge, then proxied.
  await app.register(httpProxy, {
    upstream: deps.upstreams.tickets,
    prefix: '/api/tickets',
    rewritePrefix: '/tickets',
    preHandler: auth,
  });
  await app.register(httpProxy, {
    upstream: deps.upstreams.analytics,
    prefix: '/api/analytics',
    rewritePrefix: '/analytics',
    preHandler: auth,
  });
  await app.register(httpProxy, {
    upstream: deps.upstreams.calllog,
    prefix: '/api/calls',
    rewritePrefix: '/calls',
    preHandler: auth,
  });
  await app.register(httpProxy, {
    upstream: deps.upstreams.reports,
    prefix: '/api/reports',
    rewritePrefix: '/reports',
    preHandler: auth,
  });

  // Public external-channel intake (WhatsApp chatbot) — API-key auth, no JWT.
  // Proxied to ticket-service /intake/*, which re-checks the key (defense in depth).
  if (deps.intakeApiKey) {
    await app.register(httpProxy, {
      upstream: deps.upstreams.tickets,
      prefix: '/api/intake',
      rewritePrefix: '/intake',
      preHandler: requireApiKey(deps.intakeApiKey),
    });
  }

  return app;
}
