import { z } from 'zod';

/**
 * Minimal ticket projection the report needs (read from the tickets table).
 * createdAt is ISO. Everything is derivable from these columns.
 */
export interface ReportTicket {
  id: string;
  createdAt: string;
  agentEmail: string;
  business: string;
  mid: string;
  concern: string;
  supportType: string;
  status: string;
  reason: string;
}

export const ReportQuerySchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
});
export type ReportQuery = z.infer<typeof ReportQuerySchema>;

// ─── Output contract (mirrors apps/web src/types MonthlyReport) ───────────────

export type Grade = 'A+' | 'A' | 'B' | 'C' | 'D';

export interface AgentRanking {
  name: string;
  total: number;
  completed: number;
  pending: number;
  closed: number;
  cantDo: number;
  invalidClosed: number;
  withReason: number;
  completionRate: number;
  reasonRate: number;
  score: number;
}

export interface MonthlyReport {
  title: string;
  generatedAt: string;
  generatedBy: string;
  period: {
    month: number;
    year: number;
    monthName: string;
    startDate: string;
    endDate: string;
    daysInMonth: number;
  };
  summary: {
    totalTickets: number;
    completed: number;
    pending: number;
    closed: number;
    cantDo: number;
    invalidClosed: number;
    avgAgeDays: number;
    completionRate: number;
    resolutionRate: number;
    cantDoRate: number;
    performanceScore: number;
    performanceGrade: Grade;
  };
  agentRankings: AgentRanking[];
  topConcerns: Array<{ concern: string; count: number; percentage: number }>;
  supportTypeBreakdown: Array<{ type: string; count: number; percentage: number }>;
  insights: {
    busiestDay: { day: string; count: number };
    slowestDay: { day: string; count: number };
    topPerformer: { name: string; completed: number; rate: number };
    highestRateAgent: { name: string; rate: number; total: number };
    topConcern: { name: string; count: number; percentage: number };
    recommendations: Array<{ priority: string; icon: string; message: string }>;
  };
  dailyDistribution: Array<{ day: string; count: number }>;
  dailyTrend: Array<{ day: number; created: number; completed: number }>;
  hourlyDistribution: Array<{ hour: number; label: string; count: number }>;
  peakHour: string;
  recommendations: Array<{ priority: string; category: string; icon: string; message: string }>;
  achievements: Array<{ icon: string; text: string }>;
  tickets: Array<{
    id: string; date: string; agent: string; business: string;
    mid: string; concern: string; supportType: string;
    status: string; reason: string;
  }>;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// The dashboard is operated in IST; bucket day-of-week / hour in IST so "busiest
// day/hour" line up with how the team actually experiences the data.
const IST_OFFSET_MIN = 330;
const pct = (n: number, total: number): number => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);
const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Title-cased agent display name from an email local-part. */
export function agentName(email: string): string {
  const local = (email.split('@')[0] || email).replace(/[._-]+/g, ' ').trim();
  return local.replace(/\b\w/g, (c) => c.toUpperCase()) || email;
}

function gradeFor(score: number): Grade {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  return 'D';
}

/** Shift an instant into IST wall-clock and return its component parts. */
function istParts(iso: string): { dow: number; hour: number; day: number; ms: number } {
  const ms = Date.parse(iso) || 0;
  const ist = new Date(ms + IST_OFFSET_MIN * 60_000);
  return {
    dow: ist.getUTCDay(),
    hour: ist.getUTCHours(),
    day: ist.getUTCDate(),
    ms,
  };
}

/**
 * Compute the full monthly report from a month's tickets. Pure + deterministic
 * (takes `now` explicitly) so the whole thing is unit-testable without a clock.
 */
export function buildMonthlyReport(
  tickets: ReportTicket[],
  opts: { month: number; year: number; generatedBy: string; now: Date },
): MonthlyReport {
  const { month, year, generatedBy, now } = opts;
  const total = tickets.length;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthName = MONTH_NAMES[month - 1];

  const is = (t: ReportTicket, s: string): boolean => t.status === s;
  const isPending = (t: ReportTicket): boolean =>
    t.status === 'Not Completed' || t.status === 'Pending' || t.status === 'In Progress';
  const hasReason = (t: ReportTicket): boolean => Boolean(t.reason && t.reason.trim());

  const completed = tickets.filter((t) => is(t, 'Completed')).length;
  const pending = tickets.filter(isPending).length;
  const closed = tickets.filter((t) => is(t, 'Closed')).length;
  const cantDo = tickets.filter((t) => is(t, "Can't Do")).length;
  const invalidClosed = tickets.filter((t) => is(t, 'Closed') && !hasReason(t)).length;
  const withReasonTotal = tickets.filter(hasReason).length;

  const avgAgeDays =
    total > 0
      ? round1(
          tickets.reduce((s, t) => s + Math.max(0, now.getTime() - (Date.parse(t.createdAt) || now.getTime())), 0) /
            total /
            86_400_000,
        )
      : 0;

  const completionRate = pct(completed, total);
  const resolutionRate = pct(completed + closed, total);
  const cantDoRate = pct(cantDo, total);
  const reasonRate = pct(withReasonTotal, total);
  const performanceScore = Math.max(
    0,
    Math.min(100, Math.round(completionRate * 0.6 + resolutionRate * 0.2 + reasonRate * 0.2)),
  );

  // ── Per-agent rankings ──────────────────────────────────────────────────────
  const byAgent = new Map<string, ReportTicket[]>();
  for (const t of tickets) {
    const list = byAgent.get(t.agentEmail) ?? [];
    list.push(t);
    byAgent.set(t.agentEmail, list);
  }
  const agentRankings: AgentRanking[] = [...byAgent.entries()]
    .map(([email, list]) => {
      const c = list.filter((t) => is(t, 'Completed')).length;
      const cl = list.filter((t) => is(t, 'Closed')).length;
      const cd = list.filter((t) => is(t, "Can't Do")).length;
      const inv = list.filter((t) => is(t, 'Closed') && !hasReason(t)).length;
      const wr = list.filter(hasReason).length;
      const score = c * 10 + cl * 4 - cd * 5 - inv * 3;
      return {
        name: agentName(email),
        total: list.length,
        completed: c,
        pending: list.filter(isPending).length,
        closed: cl,
        cantDo: cd,
        invalidClosed: inv,
        withReason: wr,
        completionRate: pct(c, list.length),
        reasonRate: pct(wr, list.length),
        score,
      };
    })
    .sort((a, b) => b.score - a.score || b.completed - a.completed);

  // ── Concern + support-type breakdowns ───────────────────────────────────────
  const tally = (key: (t: ReportTicket) => string): Array<[string, number]> => {
    const m = new Map<string, number>();
    for (const t of tickets) {
      const k = (key(t) || '—').trim() || '—';
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const topConcerns = tally((t) => t.concern)
    .slice(0, 10)
    .map(([concern, count]) => ({ concern, count, percentage: pct(count, total) }));
  const supportTypeBreakdown = tally((t) => t.supportType).map(([type, count]) => ({
    type,
    count,
    percentage: pct(count, total),
  }));

  // ── Day-of-week + hourly + daily distributions ──────────────────────────────
  const dowCounts = new Array(7).fill(0);
  const hourCounts = new Array(24).fill(0);
  const dayCreated = new Array(daysInMonth + 1).fill(0);
  const dayCompleted = new Array(daysInMonth + 1).fill(0);
  for (const t of tickets) {
    const { dow, hour, day } = istParts(t.createdAt);
    dowCounts[dow]++;
    hourCounts[hour]++;
    if (day >= 1 && day <= daysInMonth) {
      dayCreated[day]++;
      if (is(t, 'Completed')) dayCompleted[day]++;
    }
  }
  const dailyDistribution = DAY_NAMES.map((day, i) => ({ day, count: dowCounts[i] }));
  const dailyTrend = Array.from({ length: daysInMonth }, (_, i) => ({
    day: i + 1,
    created: dayCreated[i + 1],
    completed: dayCompleted[i + 1],
  }));
  const hourLabel = (h: number): string => {
    const ampm = h < 12 ? 'AM' : 'PM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}${ampm}`;
  };
  const hourlyDistribution = hourCounts.map((count, hour) => ({ hour, label: hourLabel(hour), count }));
  const peakHourIdx = hourCounts.reduce((best, c, i) => (c > hourCounts[best] ? i : best), 0);
  const peakHour = total > 0 ? hourLabel(peakHourIdx) : '—';

  // ── Insights ────────────────────────────────────────────────────────────────
  const dowRanked = dailyDistribution.filter((d) => d.count > 0).sort((a, b) => b.count - a.count);
  const busiestDay = dowRanked[0] ?? { day: '—', count: 0 };
  const slowestDay = dowRanked[dowRanked.length - 1] ?? { day: '—', count: 0 };
  const topPerformerRow = [...agentRankings].sort((a, b) => b.completed - a.completed)[0];
  const highestRateRow = [...agentRankings]
    .filter((a) => a.total >= 3)
    .sort((a, b) => b.completionRate - a.completionRate)[0];
  const topConcern = topConcerns[0]
    ? { name: topConcerns[0].concern, count: topConcerns[0].count, percentage: topConcerns[0].percentage }
    : { name: '—', count: 0, percentage: 0 };

  const insightRecs: Array<{ priority: string; icon: string; message: string }> = [];
  if (cantDoRate > 15) insightRecs.push({ priority: 'HIGH', icon: '🚫', message: `Can't-Do rate is ${cantDoRate}% — review intake quality.` });
  if (completionRate < 60) insightRecs.push({ priority: 'HIGH', icon: '📉', message: `Completion rate ${completionRate}% is below target (60%).` });
  if (invalidClosed > 0) insightRecs.push({ priority: 'MEDIUM', icon: '⚠️', message: `${invalidClosed} ticket(s) closed without a reason.` });
  if (insightRecs.length === 0) insightRecs.push({ priority: 'LOW', icon: '✅', message: 'No critical issues detected this month.' });

  // ── Top-level recommendations + achievements ────────────────────────────────
  const recommendations = insightRecs.map((r) => ({ ...r, category: 'Operations' }));
  const achievements: Array<{ icon: string; text: string }> = [];
  if (completionRate >= 80) achievements.push({ icon: '🏆', text: `Strong completion rate: ${completionRate}%` });
  if (reasonRate >= 90) achievements.push({ icon: '📝', text: `Excellent documentation: ${reasonRate}% tickets have a reason` });
  if (topPerformerRow) achievements.push({ icon: '🚀', text: `${topPerformerRow.name} led with ${topPerformerRow.completed} completions` });

  // ── Period dates ────────────────────────────────────────────────────────────
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  return {
    title: `${monthName} ${year} — Operations Report`,
    generatedAt: now.toISOString(),
    generatedBy,
    period: { month, year, monthName, startDate, endDate, daysInMonth },
    summary: {
      totalTickets: total,
      completed,
      pending,
      closed,
      cantDo,
      invalidClosed,
      avgAgeDays,
      completionRate,
      resolutionRate,
      cantDoRate,
      performanceScore,
      performanceGrade: gradeFor(performanceScore),
    },
    agentRankings,
    topConcerns,
    supportTypeBreakdown,
    insights: {
      busiestDay,
      slowestDay,
      topPerformer: topPerformerRow
        ? { name: topPerformerRow.name, completed: topPerformerRow.completed, rate: topPerformerRow.completionRate }
        : { name: '—', completed: 0, rate: 0 },
      highestRateAgent: highestRateRow
        ? { name: highestRateRow.name, rate: highestRateRow.completionRate, total: highestRateRow.total }
        : { name: '—', rate: 0, total: 0 },
      topConcern,
      recommendations: insightRecs,
    },
    dailyDistribution,
    dailyTrend,
    hourlyDistribution,
    peakHour,
    recommendations,
    achievements,
    tickets: tickets
      .slice()
      .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))
      .map((t) => ({
        id: t.id,
        date: t.createdAt.slice(0, 10),
        agent: agentName(t.agentEmail),
        business: t.business,
        mid: t.mid,
        concern: t.concern,
        supportType: t.supportType,
        status: t.status,
        reason: t.reason,
      })),
  };
}
