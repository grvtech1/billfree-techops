import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ok, requireAuth, type JwtConfig } from '@billfree/service-common';
import type { AnalyticsRepository } from './repository.js';

const LimitQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) });

export interface AnalyticsRoutesDeps {
  repo: AnalyticsRepository;
  jwt: JwtConfig;
}

/**
 * Register the /analytics/* routes on an existing Fastify instance. Extracted
 * from buildServer so they can run standalone (analytics-service) OR be composed
 * into the modular monolith.
 */
export function registerAnalyticsRoutes(app: FastifyInstance, deps: AnalyticsRoutesDeps): void {
  const auth = requireAuth(deps.jwt);

  app.get('/analytics/status-breakdown', { preHandler: auth }, async () =>
    ok(await deps.repo.statusBreakdown()),
  );

  app.get('/analytics/top-pos', { preHandler: auth }, async (req) => {
    const { limit } = LimitQuery.parse(req.query);
    return ok(await deps.repo.topPos(limit));
  });

  app.get('/analytics/agent-leaderboard', { preHandler: auth }, async () =>
    ok(await deps.repo.agentLeaderboard()),
  );

  // ── [GAP-16] Missing analytics endpoints ────────────────────────────────
  app.get('/analytics/top-mids-same', { preHandler: auth }, async (req) => {
    const { limit } = LimitQuery.parse(req.query);
    return ok(await deps.repo.topMidsSame(limit));
  });

  app.get('/analytics/top-mids-diff', { preHandler: auth }, async (req) => {
    const { limit } = LimitQuery.parse(req.query);
    return ok(await deps.repo.topMidsDiff(limit));
  });

  app.get('/analytics/repeat-customers', { preHandler: auth }, async (req) => {
    const { limit } = LimitQuery.parse(req.query);
    return ok(await deps.repo.repeatCustomers(limit));
  });

  app.get('/analytics/concern-trend', { preHandler: auth }, async () =>
    ok(await deps.repo.concernTrend()),
  );

  app.get('/analytics/agent-matrix', { preHandler: auth }, async () =>
    ok(await deps.repo.agentMatrix()),
  );
}
