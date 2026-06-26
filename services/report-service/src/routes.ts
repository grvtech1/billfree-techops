import type { FastifyInstance } from 'fastify';
import { requireAuth, unauthorized, type JwtConfig } from '@billfree/service-common';
import { ReportQuerySchema, buildMonthlyReport } from './domain.js';
import type { ReportRepository } from './repository.js';
import { z } from 'zod';
import { generateAINarrative, sendMonthlyReportEmail } from './email.js';

const SendEmailReportSchema = z.object({
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  recipients: z.string().optional(),
});

export interface ReportRoutesDeps {
  repo: ReportRepository;
  jwt: JwtConfig;
  emailConfig?: {
    geminiApiKey?: string;
    smtpHost?: string;
    smtpPort?: number;
    smtpUser?: string;
    smtpPass?: string;
    smtpSecure?: boolean;
    smtpFrom?: string;
    adminEmails?: string;
  };
}

export function registerReportRoutes(
  app: FastifyInstance,
  deps: ReportRoutesDeps,
): void {
  const { repo, jwt, emailConfig } = deps;

  // Monthly operations report — any authenticated user. Response shape matches
  // the SPA's MonthlyReportView: { success, report }.
  app.get('/reports/monthly', { preHandler: requireAuth(jwt) }, async (req) => {
    const user = req.user;
    if (!user) throw unauthorized();
    const { month, year } = ReportQuerySchema.parse(req.query);
    const tickets = await repo.ticketsForMonth(year, month);
    
    // Try previous month for comparison
    const prevDate = new Date(year, month - 2, 1);
    const prevMonth = prevDate.getMonth() + 1;
    const prevYear = prevDate.getFullYear();
    const prevTickets = await repo.ticketsForMonth(prevYear, prevMonth);

    const report = buildMonthlyReport(tickets, {
      month,
      year,
      generatedBy: user.name || user.sub,
      now: new Date(),
      previousMonthTickets: prevTickets,
    });
    return { success: true, report };
  });

  // [GAP-15] Trigger manual email dispatch — admin and manager only.
  app.post('/reports/monthly/email', { preHandler: requireAuth(jwt, ['admin', 'manager']) }, async (req) => {
    const user = req.user;
    if (!user) throw unauthorized();

    const body = SendEmailReportSchema.parse(req.body || {});

    // Default to current month/year if not provided
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: 'numeric',
    });
    const parts = formatter.formatToParts(now);
    const partMap = Object.fromEntries(parts.map((p) => [p.type, p.value]));

    const defaultMonth = parseInt(partMap.month, 10);
    const defaultYear = parseInt(partMap.year, 10);

    const month = body.month ?? defaultMonth;
    const year = body.year ?? defaultYear;

    const tickets = await repo.ticketsForMonth(year, month);

    // Fetch previous month for comparison
    const prevDate = new Date(year, month - 2, 1);
    const prevMonth = prevDate.getMonth() + 1;
    const prevYear = prevDate.getFullYear();
    const prevTickets = await repo.ticketsForMonth(prevYear, prevMonth);

    const report = buildMonthlyReport(tickets, {
      month,
      year,
      generatedBy: user.name || user.sub,
      now: new Date(),
      previousMonthTickets: prevTickets,
    });

    const prevReport = prevTickets.length > 0 ? buildMonthlyReport(prevTickets, {
      month: prevMonth,
      year: prevYear,
      generatedBy: user.name || user.sub,
      now: new Date(),
    }) : null;

    // Call Gemini narrative
    const apiKey = emailConfig?.geminiApiKey;
    const { html: aiNarrativeHtml, error: aiError } = await generateAINarrative(report, apiKey);

    const targetRecipients = body.recipients || emailConfig?.adminEmails || 'admin@billfree.in';

    const result = await sendMonthlyReportEmail({
      report,
      prevReport,
      aiNarrativeHtml,
      recipients: targetRecipients,
      logger: app.log,
      smtpConfig: emailConfig ? {
        host: emailConfig.smtpHost,
        port: emailConfig.smtpPort,
        user: emailConfig.smtpUser,
        pass: emailConfig.smtpPass,
        secure: emailConfig.smtpSecure,
        from: emailConfig.smtpFrom,
      } : undefined,
    });

    return {
      success: true,
      message: result.message,
      mode: result.mode,
      aiError,
      html: result.html,
    };
  });
}

