import type { FastifyInstance } from 'fastify';
import { requireAuth, unauthorized, type JwtConfig } from '@billfree/service-common';
import { ReportQuerySchema, buildMonthlyReport } from './domain.js';
import type { ReportRepository } from './repository.js';

export function registerReportRoutes(
  app: FastifyInstance,
  deps: { repo: ReportRepository; jwt: JwtConfig },
): void {
  const { repo, jwt } = deps;

  // Monthly operations report — any authenticated user. Response shape matches
  // the SPA's MonthlyReportView: { success, report }.
  app.get('/reports/monthly', { preHandler: requireAuth(jwt) }, async (req) => {
    const user = req.user;
    if (!user) throw unauthorized();
    const { month, year } = ReportQuerySchema.parse(req.query);
    const tickets = await repo.ticketsForMonth(year, month);
    const report = buildMonthlyReport(tickets, {
      month,
      year,
      generatedBy: user.name || user.sub,
      now: new Date(),
    });
    return { success: true, report };
  });
}
