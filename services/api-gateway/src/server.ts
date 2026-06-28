import Fastify, { type FastifyBaseLogger, type FastifyInstance, type FastifyRequest } from 'fastify';
import httpProxy, { type FastifyHttpProxyOptions } from '@fastify/http-proxy';
import rateLimit from '@fastify/rate-limit';
import cors from '@fastify/cors';
import {
  extractToken,
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
  // Tighter limit applied specifically to the unauthenticated /auth/* surface
  // (token minting) to blunt credential-stuffing. Defaults to a small number.
  authRateLimitMax?: number;
  // Tighter limit for the expensive /api/reports surface (DB-heavy + Gemini).
  reportRateLimitMax?: number;
  logger?: FastifyBaseLogger | boolean;
}

/**
 * The single public entry point. Responsibilities the services should NOT each
 * re-implement: CORS, edge rate-limiting, and authentication. Authenticated
 * requests are reverse-proxied to the owning service (which re-verifies the JWT
 * — defense in depth). `/auth/*` is public so clients can obtain a token.
 */
// A dead or slow upstream must fail FAST at the edge rather than tie up gateway
// connections for the undici default (10s connect). Bounding the connect time
// turns an unreachable service into a quick 5xx instead of a hung request —
// genuine production resilience, and it also keeps the proxy tests deterministic
// across platforms (Windows holds an unresolved host open far longer than Linux).
const PROXY_UNDICI = {
  connect: { timeout: 2_000 },
  headersTimeout: 30_000,
  bodyTimeout: 30_000,
} as const;

export async function buildServer(deps: GatewayDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? false, trustProxy: true });

  registerErrorHandler(app);
  await app.register(cors, { origin: deps.corsOrigins ?? true, credentials: true });
  // [GAP-03] Per-user rate limiting (GAS Auth.gs uses 30 req/min per user via UserCache).
  // Extract the JWT `sub` claim to key on authenticated user; fall back to IP for
  // unauthenticated routes (e.g. /auth/token).
  await app.register(rateLimit, {
    max: deps.rateLimitMax ?? 30,
    timeWindow: '1 minute',
    keyGenerator: (req) => {
      // Token may arrive as a Bearer header (machine clients) or the httpOnly
      // session cookie (browser SPA). Decode the payload (no verification — the
      // auth preHandler verifies later) just to key the limit per user.
      const token = extractToken(req);
      if (token) {
        try {
          const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
          if (payload.sub) return `user:${payload.sub}`;
        } catch { /* fall through to IP */ }
      }
      return `ip:${req.ip}`;
    },
  });
  registerMetrics(app, 'api-gateway');
  registerHealth(app);

  // @fastify/http-proxy v11 types its preHandler with an unusual `this` binding
  // (ProxyPreHandlerHookHandler); our standard Fastify preHandler is runtime-
  // compatible, so cast it to the proxy's expected type.
  const auth = requireAuth(deps.jwt) as unknown as FastifyHttpProxyOptions['preHandler'];

  // Public — token issuance. Stricter per-route rate limit than the global one
  // because this is the unauthenticated, abuse-prone surface (token minting).
  await app.register(httpProxy, {
    upstream: deps.upstreams.auth,
    prefix: '/auth',
    rewritePrefix: '/auth',
    undici: PROXY_UNDICI,
    config: {
      rateLimit: {
        max: deps.authRateLimitMax ?? 20,
        timeWindow: '1 minute',
        keyGenerator: (req: FastifyRequest) => `ip:${req.ip}`,
      },
    },
  });

  // Protected — JWT enforced at the edge, then proxied.
  await app.register(httpProxy, {
    upstream: deps.upstreams.tickets,
    prefix: '/api/tickets',
    rewritePrefix: '/tickets',
    preHandler: auth,
    undici: PROXY_UNDICI,
  });
  await app.register(httpProxy, {
    upstream: deps.upstreams.analytics,
    prefix: '/api/analytics',
    rewritePrefix: '/analytics',
    preHandler: auth,
    undici: PROXY_UNDICI,
  });
  await app.register(httpProxy, {
    upstream: deps.upstreams.calllog,
    prefix: '/api/calls',
    rewritePrefix: '/calls',
    preHandler: auth,
    undici: PROXY_UNDICI,
  });
  await app.register(httpProxy, {
    upstream: deps.upstreams.reports,
    prefix: '/api/reports',
    rewritePrefix: '/reports',
    preHandler: auth,
    undici: PROXY_UNDICI,
    // Reports are expensive: they load a month of tickets into memory and call
    // the Gemini API. A much tighter per-caller limit than the global default
    // protects the DB pool and caps Gemini spend. Keyed per-user (JWT sub).
    config: {
      rateLimit: {
        max: deps.reportRateLimitMax ?? 10,
        timeWindow: '1 minute',
      },
    },
  });

  // Public external-channel intake (WhatsApp chatbot) — API-key auth, no JWT.
  // Proxied to ticket-service /intake/*, which re-checks the key (defense in depth).
  if (deps.intakeApiKey) {
    const apiKeyGuard = requireApiKey(deps.intakeApiKey) as unknown as FastifyHttpProxyOptions['preHandler'];
    await app.register(httpProxy, {
      upstream: deps.upstreams.tickets,
      prefix: '/api/intake',
      rewritePrefix: '/intake',
      preHandler: apiKeyGuard,
      undici: PROXY_UNDICI,
    });

    // [GAP-06] CDR webhook proxy → calllog-service /calls/webhook, API-key auth.
    await app.register(httpProxy, {
      upstream: deps.upstreams.calllog,
      prefix: '/api/calls/webhook',
      rewritePrefix: '/calls/webhook',
      preHandler: apiKeyGuard,
      undici: PROXY_UNDICI,
    });
  }
  // [GAP-22] Client error reporting — replaces GAS 'logclienterror' action.
  // The SPA's ErrorBoundary posts errors here; they're emitted via structured
  // logging (picked up by K8s / Cloud Logging) for observability.
  app.post('/api/errors', {
    // Unauthenticated endpoint — keep a tight per-IP limit so it can't be used
    // to flood log storage.
    config: { rateLimit: { max: 30, timeWindow: '1 minute', keyGenerator: (req: FastifyRequest) => `ip:${req.ip}` } },
  }, async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    app.log.error({
      event: 'CLIENT_ERROR',
      context: String(body.context ?? '').slice(0, 200),
      message: String(body.message ?? '').slice(0, 1000),
      stack: String(body.stack ?? '').slice(0, 2000),
      url: String(body.url ?? '').slice(0, 500),
      userAgent: String(body.userAgent ?? '').slice(0, 300),
    });
    return { success: true };
  });

  return app;
}
