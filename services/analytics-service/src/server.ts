import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import {
  registerErrorHandler,
  registerHealth,
  registerMetrics,
  type JwtConfig,
} from '@billfree/service-common';
import type { AnalyticsRepository } from './repository.js';
import { registerAnalyticsRoutes } from './routes.js';

export interface AnalyticsServerDeps {
  repo: AnalyticsRepository;
  jwt: JwtConfig;
  readiness?: () => Promise<boolean>;
  logger?: FastifyBaseLogger | boolean;
}

export function buildServer(deps: AnalyticsServerDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false });
  registerErrorHandler(app);
  registerMetrics(app, 'analytics-service');
  registerHealth(app, { readiness: deps.readiness });
  registerAnalyticsRoutes(app, { repo: deps.repo, jwt: deps.jwt });
  return app;
}
