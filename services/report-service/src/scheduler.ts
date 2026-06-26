import { buildMonthlyReport } from './domain.js';
import { generateAINarrative, sendMonthlyReportEmail } from './email.js';
import type { ReportRepository } from './repository.js';

export function startMonthlyReportScheduler(deps: {
  repo: ReportRepository;
  logger: {
    info: (obj: any, msg?: string) => void;
    warn: (obj: any, msg?: string) => void;
    error: (obj: any, msg?: string) => void;
  };
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
}): () => void {
  const { repo, logger, emailConfig } = deps;
  if (!emailConfig) {
    logger.warn('Email/SMTP credentials not configured — monthly report scheduler not started.');
    return () => {};
  }

  logger.info('Monthly report scheduler initialized');

  let lastSentMonthTag = '';

  const checkAndSend = async () => {
    try {
      const now = new Date();
      // Calculate current time in Asia/Kolkata timezone
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
      });
      const parts = formatter.formatToParts(now);
      const partMap = Object.fromEntries(parts.map((p) => [p.type, p.value]));

      const year = parseInt(partMap.year, 10);
      const month = parseInt(partMap.month, 10); // 1-12
      const day = parseInt(partMap.day, 10);
      const hour = parseInt(partMap.hour, 10);

      // We want to run on the 1st of the month, at 9:00 AM (hour === 9)
      if (day === 1 && hour === 9) {
        // We report on the PREVIOUS month
        const reportDate = new Date(year, month - 2, 1);
        const reportMonth = reportDate.getMonth() + 1;
        const reportYear = reportDate.getFullYear();

        const monthTag = `${reportYear}-${reportMonth}`;
        if (lastSentMonthTag === monthTag) {
          // Already sent for this period
          return;
        }

        logger.info(
          { reportMonth, reportYear },
          'Starting scheduled monthly report generation and dispatch',
        );

        // Fetch current month tickets
        const tickets = await repo.ticketsForMonth(reportYear, reportMonth);

        // Fetch previous month tickets for MoM comparison
        const prevDate = new Date(reportYear, reportMonth - 2, 1);
        const prevMonth = prevDate.getMonth() + 1;
        const prevYear = prevDate.getFullYear();
        const prevTickets = await repo.ticketsForMonth(prevYear, prevMonth);

        const report = buildMonthlyReport(tickets, {
          month: reportMonth,
          year: reportYear,
          generatedBy: 'System Scheduler',
          now: new Date(),
          previousMonthTickets: prevTickets,
        });

        const prevReport =
          prevTickets.length > 0
            ? buildMonthlyReport(prevTickets, {
                month: prevMonth,
                year: prevYear,
                generatedBy: 'System Scheduler',
                now: new Date(),
              })
            : null;

        // Generate AI narrative
        const { html: aiNarrativeHtml } = await generateAINarrative(
          report,
          emailConfig.geminiApiKey,
        );

        // Send email
        const targetRecipients = emailConfig.adminEmails || 'admin@billfree.in';
        await sendMonthlyReportEmail({
          report,
          prevReport,
          aiNarrativeHtml,
          recipients: targetRecipients,
          logger,
          smtpConfig: {
            host: emailConfig.smtpHost,
            port: emailConfig.smtpPort,
            user: emailConfig.smtpUser,
            pass: emailConfig.smtpPass,
            secure: emailConfig.smtpSecure,
            from: emailConfig.smtpFrom,
          },
        });

        lastSentMonthTag = monthTag;
        logger.info({ monthTag }, 'Scheduled monthly report dispatched successfully');
      }
    } catch (err: any) {
      logger.error(
        { err: err.message || String(err) },
        'Scheduled monthly report dispatch failed',
      );
    }
  };

  // Check every 30 minutes
  const interval = setInterval(checkAndSend, 30 * 60 * 1000);
  // Also run an initial check after 10 seconds to catch up
  const initialTimeout = setTimeout(checkAndSend, 10 * 1000);

  return () => {
    clearInterval(interval);
    clearTimeout(initialTimeout);
  };
}
