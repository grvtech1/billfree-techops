import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import {
  registerErrorHandler,
  registerHealth,
  registerMetrics,
  type JwtConfig,
} from '@billfree/service-common';
import { registerReportRoutes } from './routes.js';
import type { ReportRepository } from './repository.js';

export interface ServerDeps {
  repo: ReportRepository;
  jwt: JwtConfig;
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
  registerMetrics(app, deps.serviceName ?? 'report-service');
  registerHealth(app, { readiness: deps.readiness });
  registerReportRoutes(app, { repo: deps.repo, jwt: deps.jwt });

  return app;
}
