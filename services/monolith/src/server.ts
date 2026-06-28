import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import {
  registerErrorHandler,
  registerHealth,
  registerMetrics,
  type JwtConfig,
  type Pool,
} from '@billfree/service-common';
import { registerAuthRoutes, staticDirectory } from '@billfree/auth-service';
import {
  registerTicketRoutes,
  registerIntakeRoutes,
  PgTicketRepository,
  PgAuditRepository,
  PgAgentRepository,
} from '@billfree/ticket-service';
import { registerAnalyticsRoutes, PgAnalyticsRepository } from '@billfree/analytics-service';
import { registerCallLogRoutes, PgCallEventRepository } from '@billfree/calllog-service';
import { registerReportRoutes, PgReportRepository } from '@billfree/report-service';

export interface MonolithEmailConfig {
  geminiApiKey?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  smtpSecure?: boolean;
  smtpFrom?: string;
  adminEmails?: string;
}

export interface MonolithDeps {
  // One shared connection pool for every module — the whole point of the
  // modular monolith: one process, one DB connection budget, in-process calls.
  pool: Pool;
  jwt: JwtConfig;
  // Enables the WhatsApp/portal intake + CDR webhook routes when set.
  intakeApiKey?: string;
  // Google OAuth audiences + whether to enforce verification (production).
  googleClientIds?: string[];
  requireGoogleAuth?: boolean;
  cookieSecure?: boolean;
  cookieSameSite?: 'lax' | 'strict' | 'none';
  emailConfig?: MonolithEmailConfig;
  corsOrigins?: string[] | boolean;
  rateLimitMax?: number;
  readiness?: () => Promise<boolean>;
  logger?: FastifyBaseLogger | boolean;
}

/**
 * The modular monolith: a single Fastify instance that mounts every domain
 * module (auth, tickets, intake, analytics, call-log, reports) on ONE process
 * and ONE Postgres pool. Each module reuses the exact route + repository code
 * the standalone microservices ship, so behaviour is identical — only the
 * deployment topology changes (1 pod instead of gateway + 6 services).
 *
 * Routes are already namespaced (/auth/*, /tickets/*, /analytics/*, /calls/*,
 * /reports/*) so they compose without collisions, and each module applies its
 * own requireAuth — no central gateway needed for edge auth.
 */
export async function buildMonolith(deps: MonolithDeps): Promise<FastifyInstance> {
  const logOpt = deps.logger && typeof deps.logger === 'object'
    ? { loggerInstance: deps.logger as FastifyBaseLogger }
    : { logger: (deps.logger ?? false) as boolean };
  const app = Fastify({ ...logOpt, trustProxy: true });

  registerErrorHandler(app);
  await app.register(cors, { origin: deps.corsOrigins ?? true, credentials: true });
  await app.register(cookie); // so the composed auth routes can set/clear the session cookie
  await app.register(rateLimit, { max: deps.rateLimitMax ?? 100, timeWindow: '1 minute' });
  registerMetrics(app, 'monolith');
  registerHealth(app, { readiness: deps.readiness });

  // Shared repositories over the single pool.
  const ticketRepo = new PgTicketRepository(deps.pool);
  const auditRepo = new PgAuditRepository(deps.pool);
  const agentRepo = new PgAgentRepository(deps.pool);

  // ── Auth ─────────────────────────────────────────────────────────────
  registerAuthRoutes(app, {
    jwt: deps.jwt,
    directory: staticDirectory,
    googleClientIds: deps.googleClientIds,
    requireGoogleAuth: deps.requireGoogleAuth ?? false,
    cookieSecure: deps.cookieSecure,
    cookieSameSite: deps.cookieSameSite,
  });

  // ── Tickets (+ optional external intake) ─────────────────────────────
  registerTicketRoutes(app, { repo: ticketRepo, audit: auditRepo, jwt: deps.jwt });
  if (deps.intakeApiKey) {
    registerIntakeRoutes(app, {
      repo: ticketRepo,
      agents: agentRepo,
      audit: auditRepo,
      apiKey: deps.intakeApiKey,
    });
  }

  // ── Analytics ────────────────────────────────────────────────────────
  registerAnalyticsRoutes(app, { repo: new PgAnalyticsRepository(deps.pool), jwt: deps.jwt });

  // ── Call log (+ CDR webhook when an intake key is configured) ────────
  registerCallLogRoutes(app, {
    repo: new PgCallEventRepository(deps.pool),
    jwt: deps.jwt,
    intakeApiKey: deps.intakeApiKey,
  });

  // ── Reports ──────────────────────────────────────────────────────────
  registerReportRoutes(app, {
    repo: new PgReportRepository(deps.pool),
    jwt: deps.jwt,
    emailConfig: deps.emailConfig,
  });

  return app;
}
