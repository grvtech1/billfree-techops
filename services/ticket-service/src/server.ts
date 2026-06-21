import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import {
  registerErrorHandler,
  registerHealth,
  registerMetrics,
  type JwtConfig,
} from '@billfree/service-common';
import { registerTicketRoutes } from './routes.js';
import { registerIntakeRoutes } from './intake.js';
import type { AgentRepository, AuditRepository, TicketRepository } from './repository.js';

export interface ServerDeps {
  repo: TicketRepository;
  audit: AuditRepository;
  jwt: JwtConfig;
  // External-channel intake (WhatsApp bot). Registered only when both are set,
  // so the JWT-only deployments/tests are unaffected.
  agents?: AgentRepository;
  intakeApiKey?: string;
  serviceName?: string;
  readiness?: () => Promise<boolean>;
  // Pass a pino logger (assignable to FastifyBaseLogger) or `false` in tests.
  logger?: FastifyBaseLogger | boolean;
}

/**
 * Build the Fastify app with all dependencies injected. Keeping construction in
 * a pure factory (no process.env, no real DB) is what lets the tests exercise
 * the full HTTP surface via app.inject() against an in-memory fake repository.
 */
export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false, disableRequestLogging: false });

  registerErrorHandler(app);
  registerMetrics(app, deps.serviceName ?? 'ticket-service');
  registerHealth(app, { readiness: deps.readiness });
  registerTicketRoutes(app, { repo: deps.repo, audit: deps.audit, jwt: deps.jwt });
  if (deps.intakeApiKey && deps.agents) {
    registerIntakeRoutes(app, {
      repo: deps.repo,
      agents: deps.agents,
      audit: deps.audit,
      apiKey: deps.intakeApiKey,
    });
  }

  return app;
}
