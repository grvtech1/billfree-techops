import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ok,
  registerErrorHandler,
  registerHealth,
  registerMetrics,
  requireAuth,
  type JwtConfig,
} from '@billfree/service-common';
import type { AnalyticsRepository } from './repository.js';

const TopPosQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) });

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

  const auth = requireAuth(deps.jwt);

  app.get('/analytics/status-breakdown', { preHandler: auth }, async () =>
    ok(await deps.repo.statusBreakdown()),
  );

  app.get('/analytics/top-pos', { preHandler: auth }, async (req) => {
    const { limit } = TopPosQuery.parse(req.query);
    return ok(await deps.repo.topPos(limit));
  });

  app.get('/analytics/agent-leaderboard', { preHandler: auth }, async () =>
    ok(await deps.repo.agentLeaderboard()),
  );

  return app;
}
