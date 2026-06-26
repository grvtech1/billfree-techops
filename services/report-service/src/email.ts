import nodemailer from 'nodemailer';
import type { MonthlyReport } from './domain.js';

/**
 * Escapes values for CSV output following RFC 4180.
 */
function csvEscape(val: unknown): string {
  const str = String(val ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Builds a CSV row from cells.
 */
function csvRow(cells: unknown[]): string {
  return cells.map(csvEscape).join(',');
}

/**
 * Port of buildAgentCSV_ from legacy GAS.
 */
export function buildAgentCSV(report: MonthlyReport): string {
  const headers = [
    'Agent',
    'Total Tickets',
    'Completed',
    'Pending',
    'Closed',
    "Can't Do",
    'Invalid Closed',
    'Completion Rate (%)',
    'Reason Rate (%)',
    'Score',
  ];
  const rows = [csvRow(headers)];

  for (const a of report.agentRankings || []) {
    rows.push(
      csvRow([
        a.name,
        a.total,
        a.completed,
        a.pending,
        a.closed,
        a.cantDo,
        a.invalidClosed ?? 0,
        a.completionRate,
        a.reasonRate ?? 0,
        a.score,
      ]),
    );
  }

  return rows.join('\n');
}

/**
 * Port of buildTicketCSV_ from legacy GAS.
 */
export function buildTicketCSV(report: MonthlyReport): string {
  const headers = [
    'Ticket ID',
    'Date',
    'Agent',
    'Business',
    'MID',
    'Concern',
    'Support Type',
    'Status',
    'Reason',
  ];
  const rows = [csvRow(headers)];

  for (const t of report.tickets || []) {
    rows.push(
      csvRow([
        t.id,
        t.date,
        t.agent,
        t.business,
        t.mid,
        t.concern,
        t.supportType,
        t.status,
        t.reason ?? '',
      ]),
    );
  }

  return rows.join('\n');
}

/**
 * Port of generateAINarrative_ from legacy GAS.
 * Uses native fetch to call Gemini 2.5 Flash API.
 */
export async function generateAINarrative(
  report: MonthlyReport,
  apiKey?: string,
): Promise<{ html: string; error: string | null }> {
  if (!apiKey) {
    return { html: '', error: 'NO_KEY' };
  }

  try {
    const s = report.summary || {};
    const p = report.period || {};
    const agents = (report.agentRankings || []).slice(0, 5);
    const concerns = (report.topConcerns || []).slice(0, 5);
    const trends = (report.concernTrends || [])
      .filter((t) => t.trend !== 'stable')
      .slice(0, 6);

    // Build a tight JSON payload to keep cost near-zero
    const payload = {
      month: p.monthName,
      year: p.year,
      total: s.totalTickets,
      completed: s.completed,
      pending: s.pending,
      closed: s.closed,
      cantDo: s.cantDo,
      completionRate: s.completionRate,
      resolutionRate: s.resolutionRate,
      grade: s.performanceGrade,
      score: s.performanceScore,
      avgAgeDays: s.avgAgeDays,
      topAgents: agents.map((a) => ({
        name: a.name,
        total: a.total,
        completed: a.completed,
        rate: a.completionRate,
      })),
      topConcerns: concerns.map((c) => ({ concern: c.concern, count: c.count, pct: c.percentage })),
      trends: trends.map((t) => ({ concern: t.concern, dir: t.trend })),
      recommendations: (report.recommendations || []).map((r) => r.message).slice(0, 3),
    };

    const prompt = `You are an operations analytics expert writing for a tech support team manager.
Given this monthly performance JSON, write EXACTLY 3 paragraphs in professional, concise English:
1. Executive overview: volume, completion rate, grade, and how the month compares to expectations.
2. Noteworthy trends: which concerns are rising/falling, what that implies, and one actionable callout.
3. Team & staffing: top performer recognition, workload balance observation, and one forward-looking recommendation.

Rules:
- No bullet points, no headings, no markdown.
- Keep total length under 200 words.
- Reference specific numbers from the data (e.g., "902 tickets", "99.2% completion").
- Tone: confident, data-driven, suitable for an executive email.

DATA:
${JSON.stringify(payload)}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 2048,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { html: '', error: `API_ERROR_${response.status}_${errorText.substring(0, 100)}` };
    }

    const json = (await response.json()) as any;
    const cand = json.candidates?.[0] || {};
    const text = cand.content?.parts?.[0]?.text || '';
    const finishReason = cand.finishReason || '';

    if (!text.trim()) {
      return { html: '', error: `EMPTY_RESPONSE${finishReason ? `_${finishReason}` : ''}` };
    }

    if (finishReason === 'MAX_TOKENS' && text.length < 200) {
      return { html: '', error: 'TRUNCATED_MAX_TOKENS' };
    }

    // Convert plain-text paragraphs to styled HTML
    const paragraphs = text.trim().split(/\n\n+/).filter(Boolean);
    const html = paragraphs
      .map(
        (p: string) =>
          `<p style="margin:0 0 12px; font-size:14px; line-height:1.7; color:#334155;">${p.trim()}</p>`,
      )
      .join('');

    return { html, error: null };
  } catch (e: any) {
    return { html: '', error: e.message || String(e) };
  }
}

/**
 * Port of buildMonthlyReportEmailHtml_ from legacy GAS.
 */
export function buildMonthlyReportEmailHtml(
  report: MonthlyReport,
  prevReport: MonthlyReport | null,
  aiNarrativeHtml: string,
): string {
  const s = report.summary || {};
  const p = report.period || {};
  const monthName = p.monthName || '';
  const fmtN = (n: number) => Number(n || 0).toLocaleString('en-IN');

  const pendingTxt = s.pending
    ? `${s.pending} ticket${s.pending > 1 ? 's remain' : ' remains'} pending`
    : 'no tickets remain pending';
  const cantDoTxt =
    !s.cantDo && !s.invalidClosed
      ? 'and there are no tickets in the "Can\'t Do" or invalid category, reflecting strong resolution efficiency'
      : `with ${s.cantDo || 0} marked "Can't Do" and ${s.invalidClosed || 0} invalid closures`;

  // Month-over-month delta
  const mom = (curr: number, prevVal: number | undefined) => {
    if (!prevVal || prevVal === 0) return '';
    const diff = curr - prevVal;
    const pctVal = Math.round((diff / prevVal) * 100);
    const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '—';
    const color = diff > 0 ? '#10B981' : diff < 0 ? '#EF4444' : '#64748B';
    return `<span style="color:${color}; font-weight:600; font-size:12px; margin-left:6px;">${arrow} ${Math.abs(pctVal)}%</span>`;
  };
  const ps = prevReport?.summary || null;

  // Agent rows
  const totalT = Math.max(s.totalTickets || 0, 1);
  const agentRows = (report.agentRankings || [])
    .slice(0, 10)
    .map((a, i) => {
      const share = (((a.total || 0) / totalT) * 100).toFixed(1);
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1;
      return `
      <tr>
        <td style="padding:10px 12px;">${medal}</td>
        <td style="padding:10px 12px;"><strong>${a.name}</strong></td>
        <td style="padding:10px 12px; text-align:right;">${fmtN(a.total)}</td>
        <td style="padding:10px 12px; text-align:right; color:#10B981;">${fmtN(a.completed)}</td>
        <td style="padding:10px 12px; text-align:right;">${a.completionRate}%</td>
        <td style="padding:10px 12px; text-align:right; color:#4F46E5; font-weight:600;">${share}%</td>
      </tr>`;
    })
    .join('');

  // Support type breakdown
  const stb = report.supportTypeBreakdown || [];
  const stRows = stb
    .map(
      (st) => `
      <tr>
        <td style="padding:8px 12px;">${st.type}</td>
        <td style="padding:8px 12px; text-align:right;">${fmtN(st.count)}</td>
        <td style="padding:8px 12px; text-align:right; color:#64748B;">${st.percentage}%</td>
      </tr>`,
    )
    .join('');

  // Top concerns with trends
  const tc = (report.topConcerns || []).slice(0, 5);
  const trendMap = new Map<string, typeof report.concernTrends[0]>();
  for (const t of report.concernTrends || []) {
    trendMap.set(t.concern, t);
  }
  const tcRows = tc
    .map((c, i) => {
      const trend = trendMap.get(c.concern);
      let trendBadge = '<span style="color:#94A3B8; font-size:12px;">— stable</span>';
      if (trend) {
        if (trend.trend === 'rising') {
          trendBadge = `<span style="color:#DC2626; font-weight:600; font-size:12px;">🔥 rising ▲</span>`;
        } else if (trend.trend === 'falling') {
          trendBadge = `<span style="color:#059669; font-weight:600; font-size:12px;">✅ falling ▼</span>`;
        }
      }
      return `
      <tr>
        <td style="padding:8px 12px;">#${i + 1}</td>
        <td style="padding:8px 12px;">${c.concern}</td>
        <td style="padding:8px 12px; text-align:right;">${fmtN(c.count)}</td>
        <td style="padding:8px 12px; text-align:right; color:#64748B;">${c.percentage}%</td>
        <td style="padding:8px 12px; text-align:right;">${trendBadge}</td>
      </tr>`;
    })
    .join('');

  // Achievements
  const achievementsHtml = (report.achievements || [])
    .map((a) => `<li style="margin:6px 0;">${a.icon} ${a.text}</li>`)
    .join('');

  // Recommendations
  const recHtml = (report.recommendations || [])
    .map((r) => {
      const bg = r.priority === 'HIGH' ? '#FEE2E2' : r.priority === 'MEDIUM' ? '#FEF3C7' : '#D1FAE5';
      const bd = r.priority === 'HIGH' ? '#DC2626' : r.priority === 'MEDIUM' ? '#F59E0B' : '#10B981';
      return `
      <div style="background:${bg}; border-left:4px solid ${bd}; padding:12px 16px; margin:8px 0; border-radius:6px;">
        <strong>${r.icon} ${r.category} (${r.priority})</strong><br>
        <span style="color:#334155;">${r.message}</span>
      </div>`;
    })
    .join('');

  const formattedDate = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date());

  const aiSection = aiNarrativeHtml
    ? `
    <h2>5. AI-Powered Executive Narrative</h2>
    <div style="background: linear-gradient(135deg, #F0F9FF 0%, #EFF6FF 100%); border-radius:10px; padding:20px 24px; border:1px solid #BAE6FD; border-left:4px solid #3B82F6;">
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px; font-size:12px; font-weight:700; color:#1D4ED8; text-transform:uppercase; letter-spacing:0.5px;">
        <span style="font-size:18px;">🤖</span> Generated by Gemini AI
      </div>
      ${aiNarrativeHtml}
    </div>
    `
    : '';

  return `
  <!DOCTYPE html>
  <html><head><meta charset="utf-8"><style>
    body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #1E293B; max-width: 760px; margin: 0 auto; padding: 20px 10px; }
    h1, h2, h3 { color: #0F172A; }
    h2 { border-bottom: 2px solid #E2E8F0; padding-bottom: 6px; margin-top: 28px; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; background: #fff; border: 1px solid #E2E8F0; border-radius: 8px; overflow: hidden; }
    th { background: #F1F5F9; padding: 10px 12px; text-align: left; font-weight: 600; font-size: 13px; color: #475569; }
    tr { border-bottom: 1px solid #F1F5F9; }
    .kpi-grid { display: flex; gap: 12px; margin: 16px 0; justify-content: space-between; }
    .kpi { background: #F8FAFC; border: 1px solid #E2E8F0; padding: 14px; border-radius: 10px; text-align: center; flex: 1; }
    .kpi-v { font-size: 24px; font-weight: 700; color: #4F46E5; }
    .kpi-l { font-size: 10px; color: #64748B; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; }
  </style></head><body>

    <div style="background: linear-gradient(135deg, #4F46E5, #7C3AED); color: #fff; padding: 24px; border-radius: 12px;">
      <h1 style="color:#fff; margin:0;">📊 ${report.title}</h1>
      <p style="margin:8px 0 0; opacity:0.9;">${p.startDate} → ${p.endDate} &nbsp;•&nbsp; Performance Grade: <strong>${s.performanceGrade || '—'}</strong></p>
    </div>

    <p>Dear Sir,</p>
    <p>Please find below the consolidated performance summary for <strong>${monthName} ${p.year}</strong>.</p>
    <p>The team handled a total of <strong>${fmtN(s.totalTickets)}</strong> support tickets during the month, achieving a <strong>${s.completionRate}%</strong> completion rate. ${pendingTxt[0].toUpperCase() + pendingTxt.slice(1)}, ${cantDoTxt} and control over backlog.</p>

    <h2>1. Executive Summary</h2>
    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-v">${fmtN(s.totalTickets)}${mom(s.totalTickets, ps?.totalTickets)}</div><div class="kpi-l">Total Tickets</div></div>
      <div class="kpi"><div class="kpi-v" style="color:#10B981;">${fmtN(s.completed)}${mom(s.completed, ps?.completed)}</div><div class="kpi-l">Completed (${s.completionRate}%)</div></div>
      <div class="kpi"><div class="kpi-v" style="color:#F59E0B;">${fmtN(s.pending)}</div><div class="kpi-l">Pending</div></div>
      <div class="kpi"><div class="kpi-v" style="color:#EF4444;">${fmtN((s.cantDo || 0) + (s.invalidClosed || 0))}</div><div class="kpi-l">Can't Do / Invalid</div></div>
    </div>

    <h2>2. Agent Performance Overview</h2>
    <p style="color:#475569;">Individual contributions based on workload and completion rate:</p>
    <table>
      <thead><tr><th>Rank</th><th>Agent</th><th style="text-align:right;">Total</th><th style="text-align:right;">Completed</th><th style="text-align:right;">Rate</th><th style="text-align:right;">Workload Share</th></tr></thead>
      <tbody>${agentRows || '<tr><td colspan="6" style="padding:16px; text-align:center; color:#94A3B8;">No agent activity in this period.</td></tr>'}</tbody>
    </table>

    <h2>3. Workload Distribution</h2>
    <p style="color:#475569;">Breakdown of tickets handled across different support categories:</p>
    <table>
      <thead><tr><th>Category</th><th style="text-align:right;">Tickets</th><th style="text-align:right;">Share</th></tr></thead>
      <tbody>${stRows || '<tr><td colspan="3" style="padding:16px; text-align:center; color:#94A3B8;">—</td></tr>'}</tbody>
    </table>

    <h2>4. Top Concerns Handled</h2>
    <table>
      <thead><tr><th>#</th><th>Concern</th><th style="text-align:right;">Count</th><th style="text-align:right;">Share</th><th style="text-align:right;">MoM Trend</th></tr></thead>
      <tbody>${tcRows || '<tr><td colspan="5" style="padding:16px; text-align:center; color:#94A3B8;">—</td></tr>'}</tbody>
    </table>

    ${aiSection}

    <h2>${aiSection ? '6' : '5'}. Operational Highlights</h2>
    <ul style="line-height:1.8;">
      <li><strong>Peak Hour:</strong> ${report.peakHour || '—'}</li>
      <li><strong>Top Performer:</strong> ${report.insights?.topPerformer?.name || '—'}</li>
      <li><strong>Highest Completion Rate:</strong> ${report.insights?.highestRateAgent?.name || '—'} (${report.insights?.highestRateAgent?.rate || 0}%)</li>
      <li><strong>Top Concern:</strong> ${report.insights?.topConcern?.name || '—'} — ${report.insights?.topConcern?.count || 0} tickets</li>
      ${ps ? `<li><strong>Vs. Previous Month:</strong> ${s.totalTickets >= ps.totalTickets ? 'Volume up' : 'Volume down'} by ${Math.abs(s.totalTickets - ps.totalTickets)} tickets; completion rate ${s.completionRate >= ps.completionRate ? 'improved' : 'declined'} by ${Math.abs((s.completionRate || 0) - (ps.completionRate || 0))} pp.</li>` : ''}
    </ul>

    ${achievementsHtml ? `<h2>🏆 Achievements</h2><ul style="line-height:1.8;">${achievementsHtml}</ul>` : ''}

    ${recHtml ? `<h2>💡 Recommendations</h2>${recHtml}` : ''}

    <hr style="border:none; border-top:1px solid #E2E8F0; margin:32px 0 12px;">
    <p style="color:#94A3B8; font-size:12px;">
      Generated automatically on ${formattedDate} IST by BillFree TechSupport Ops report-service.<br>
      You are receiving this because you are listed in admin recipients. To unsubscribe, contact the system administrator.
    </p>
  </body></html>`;
}

/**
 * Dispatch monthly report email using Nodemailer.
 * Falls back to logging the email if SMTP configuration is not available.
 */
export async function sendMonthlyReportEmail(opts: {
  report: MonthlyReport;
  prevReport: MonthlyReport | null;
  aiNarrativeHtml: string;
  recipients: string;
  logger: { info: (obj: any, msg: string) => void; warn: (obj: any, msg: string) => void };
  smtpConfig?: {
    host?: string;
    port?: number;
    user?: string;
    pass?: string;
    secure?: boolean;
    from?: string;
  };
}): Promise<{ success: boolean; message: string; mode: 'smtp' | 'fallback'; html?: string }> {
  const { report, prevReport, aiNarrativeHtml, recipients, logger, smtpConfig } = opts;
  const s = report.summary || {};

  const subject = `📊 ${report.period.monthName} ${report.period.year} — ${s.totalTickets} tickets, ${s.completionRate}% complete, Grade ${s.performanceGrade}`;
  const htmlBody = buildMonthlyReportEmailHtml(report, prevReport, aiNarrativeHtml);

  // Build attachments
  const monthTag = `${report.period.monthName}_${report.period.year}`;
  const agentCsv = buildAgentCSV(report);
  const ticketCsv = buildTicketCSV(report);

  const attachments = [
    {
      filename: `Agent_Performance_${monthTag}.csv`,
      content: agentCsv,
      contentType: 'text/csv',
    },
    {
      filename: `Ticket_Details_${monthTag}.csv`,
      content: ticketCsv,
      contentType: 'text/csv',
    },
  ];

  const fromAddress = smtpConfig?.from || 'reports@billfree.in';

  // Check if SMTP is configured
  const hasSmtp = Boolean(smtpConfig?.host && smtpConfig?.user && smtpConfig?.pass);

  if (!hasSmtp) {
    logger.warn(
      { recipients, subject, hasAINarrative: !!aiNarrativeHtml },
      'SMTP credentials not fully configured. Falling back to console logging + returning email payload.',
    );
    return {
      success: true,
      mode: 'fallback',
      message: `[Fallback Mode] Report generated. Recipients: ${recipients}. Attachments: 2 CSVs. AI narrative: ${aiNarrativeHtml ? 'Yes' : 'No'}.`,
      html: htmlBody,
    };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: smtpConfig!.host,
      port: smtpConfig!.port || 587,
      secure: smtpConfig!.secure ?? false,
      auth: {
        user: smtpConfig!.user,
        pass: smtpConfig!.pass,
      },
    });

    await transporter.sendMail({
      from: fromAddress,
      to: recipients,
      subject,
      html: htmlBody,
      attachments,
    });

    logger.info(
      { recipients, subject, attachmentCount: attachments.length },
      'Monthly report email dispatched successfully via SMTP',
    );

    return {
      success: true,
      mode: 'smtp',
      message: `Report sent to ${recipients} with ${attachments.length} CSV attachments${aiNarrativeHtml ? ' + AI narrative' : ''} via SMTP.`,
    };
  } catch (err: any) {
    logger.warn(
      { err: err.message || String(err), recipients },
      'Failed to send email via SMTP. Falling back to local payload output.',
    );
    return {
      success: true,
      mode: 'fallback',
      message: `[SMTP Error Fallback] ${err.message || String(err)}. Recipients: ${recipients}.`,
      html: htmlBody,
    };
  }
}
