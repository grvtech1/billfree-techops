import { useEffect, useMemo, useState } from 'react';
import type { MonthlyReport } from '@billfree/web-core';
import { downloadCSV } from '@billfree/web-core';
import { api } from '@billfree/api';
import { useAuthStore, useUiStore } from '@billfree/app-state';
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer,
} from 'recharts';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/* Years available in picker — last 5 incl. current. */
function recentYears(): number[] {
  const cur = new Date().getFullYear();
  return [cur, cur - 1, cur - 2, cur - 3, cur - 4];
}

/* Performance grade → colour token. */
const GRADE_COLOR: Record<string, string> = {
  'A+': '#10B981',
  'A':  '#22C55E',
  'B':  '#3B82F6',
  'C':  '#F59E0B',
  'D':  '#EF4444',
};

export default function MonthlyReportView() {
  const { user }   = useAuthStore();
  const showToast  = useUiStore(s => s.showToast);

  const today = new Date();
  const [month, setMonth] = useState<number>(today.getMonth() + 1);
  const [year,  setYear]  = useState<number>(today.getFullYear());
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const loadReport = async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const res = await api.monthlyReport({ month, year, token: user.token });
      if (res.report) {
        setReport(res.report);
      } else {
        setError(res.error || 'No report data returned.');
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load report');
    } finally {
      setLoading(false);
    }
  };

  // Auto-load once user is available, default month/year. After that the user
  // explicitly clicks Generate to refresh.
  useEffect(() => {
    if (user) loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  /* CSV export of the monthly tickets table. */
  const handleExportCsv = () => {
    if (!report || report.tickets.length === 0) {
      showToast('No tickets to export', 'info');
      return;
    }
    const headers = ['Ticket ID', 'Date', 'Agent', 'Business', 'MID', 'Concern', 'Support Type', 'Status', 'Reason'];
    const rows = report.tickets.map(t => [
      t.id, t.date, t.agent, t.business, t.mid,
      t.concern, t.supportType, t.status, t.reason,
    ]);
    downloadCSV(
      [headers, ...rows],
      `monthly_report_${report.period.year}_${String(report.period.month).padStart(2, '0')}.csv`
    );
    showToast(`Exported ${report.tickets.length} tickets`, 'success');
  };

  /* Memoised chart-friendly slices. */
  const dailyTrend = useMemo(
    () => report?.dailyTrend ?? [],
    [report]
  );
  const hourlyDistribution = useMemo(
    () => report?.hourlyDistribution ?? [],
    [report]
  );

  return (
    <div className="view-container monthly-report-view">
      {/* ── Picker row ────────────────────────────────────────────── */}
      <div className="view-section">
        <div className="filters-row" style={{ alignItems: 'flex-end', gap: 12 }}>
          <div className="form-group" style={{ minWidth: 160 }}>
            <label className="form-label" htmlFor="mr-month">📅 Month</label>
            <select
              id="mr-month"
              className="form-input"
              value={month}
              onChange={e => setMonth(parseInt(e.target.value, 10))}
            >
              {MONTH_NAMES.map((name, i) => (
                <option key={i} value={i + 1}>{name}</option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ minWidth: 120 }}>
            <label className="form-label" htmlFor="mr-year">Year</label>
            <select
              id="mr-year"
              className="form-input"
              value={year}
              onChange={e => setYear(parseInt(e.target.value, 10))}
            >
              {recentYears().map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <button
            className="btn btn-primary"
            onClick={loadReport}
            disabled={loading}
            title="Generate monthly report"
          >
            {loading ? '⏳ Generating…' : '📊 Generate'}
          </button>
          <button
            className="btn btn-ghost ml-auto"
            onClick={handleExportCsv}
            disabled={!report || report.tickets.length === 0}
            title="Export tickets list as CSV"
          >
            ⬇ Export CSV
          </button>
        </div>
      </div>

      {/* ── Error ─────────────────────────────────────────────────── */}
      {error && (
        <div className="view-section">
          <div className="empty-state">
            <div className="empty-state-icon" aria-hidden="true">⚠️</div>
            <h3>Couldn’t load report</h3>
            <p>{error}</p>
          </div>
        </div>
      )}

      {/* ── Loading skeleton ──────────────────────────────────────── */}
      {loading && !report && (
        <div className="view-section">
          <div className="view-skeleton" aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton skeleton-card" />
            ))}
          </div>
        </div>
      )}

      {/* ── Report body ───────────────────────────────────────────── */}
      {report && (
        <>
          {/* Title banner */}
          <div className="view-section">
            <div className="section-header" style={{ alignItems: 'center' }}>
              <div>
                <h2 className="section-title" style={{ marginBottom: 4 }}>{report.title}</h2>
                <span className="text-muted" style={{ fontSize: '0.85rem' }}>
                  {report.period.startDate} → {report.period.endDate} • {report.period.daysInMonth} days
                  {' • Generated '}{new Date(report.generatedAt).toLocaleString()}
                </span>
              </div>
              <div
                className="grade-badge"
                style={{
                  background: GRADE_COLOR[report.summary.performanceGrade] || 'var(--gray)',
                  color: '#fff', padding: '8px 16px', borderRadius: 12,
                  fontWeight: 800, fontSize: '1.4rem',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}
                title={`Performance score: ${report.summary.performanceScore}/100`}
              >
                {report.summary.performanceGrade}
                <span style={{ fontSize: '0.75rem', fontWeight: 500, opacity: 0.85 }}>
                  ({report.summary.performanceScore})
                </span>
              </div>
            </div>
          </div>

          {/* Summary KPI grid */}
          <div className="kpi-grid" role="region" aria-label="Monthly KPIs">
            <SummaryCard label="Total Tickets" value={report.summary.totalTickets} icon="🎫" color="var(--primary)" />
            <SummaryCard label="Completed"    value={report.summary.completed}    icon="✅" color="var(--success)" sub={`${report.summary.completionRate}% rate`} />
            <SummaryCard label="Pending"      value={report.summary.pending}      icon="⏳" color="var(--warning)" />
            <SummaryCard label="Closed"       value={report.summary.closed}       icon="📦" color="var(--gray)" sub={report.summary.invalidClosed > 0 ? `${report.summary.invalidClosed} invalid` : undefined} />
            <SummaryCard label="Can't Do"     value={report.summary.cantDo}       icon="🚫" color="var(--danger)" sub={`${report.summary.cantDoRate}%`} />
            <SummaryCard label="Avg Age"      value={`${report.summary.avgAgeDays}d`} icon="📆" color="var(--info, #3B82F6)" />
          </div>

          {/* Charts row */}
          <div className="charts-grid">
            <div className="chart-card">
              <h3 className="chart-title">📈 Daily Trend — Created vs Completed</h3>
              {dailyTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={dailyTrend} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="created"   name="Created"   stroke="#667eea" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="completed" name="Completed" stroke="#10B981" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <div className="chart-empty">No daily data</div>}
            </div>

            <div className="chart-card">
              <h3 className="chart-title">⏰ Hourly Distribution (peak: {report.peakHour})</h3>
              {hourlyDistribution.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={hourlyDistribution} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={2} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <div className="chart-empty">No hourly data</div>}
            </div>
          </div>

          {/* Insights row */}
          <div className="view-section">
            <h3 className="section-title">💡 Insights</h3>
            <div className="kpi-grid" role="list" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              <InsightItem icon="🚀" title="Top Performer"  primary={report.insights.topPerformer.name}  secondary={`${report.insights.topPerformer.completed} done · ${report.insights.topPerformer.rate}%`} />
              <InsightItem icon="🎯" title="Best Rate"       primary={report.insights.highestRateAgent.name} secondary={`${report.insights.highestRateAgent.rate}% (${report.insights.highestRateAgent.total} tickets)`} />
              <InsightItem icon="📅" title="Busiest Day"     primary={report.insights.busiestDay.day}     secondary={`${report.insights.busiestDay.count} tickets`} />
              <InsightItem icon="🐢" title="Slowest Day"     primary={report.insights.slowestDay.day}     secondary={`${report.insights.slowestDay.count} tickets`} />
              <InsightItem icon="🔥" title="Top Concern"     primary={report.insights.topConcern.name}    secondary={`${report.insights.topConcern.count} (${report.insights.topConcern.percentage}%)`} />
            </div>
          </div>

          {/* Recommendations / Achievements */}
          {(report.recommendations.length > 0 || report.achievements.length > 0) && (
            <div className="view-section" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
              {report.recommendations.length > 0 && (
                <div className="chart-card">
                  <h3 className="chart-title">🛠️ Recommendations</h3>
                  <ul className="recommendation-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {report.recommendations.map((r, i) => (
                      <li key={i} style={{ padding: '8px 0', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                        <span style={{ marginRight: 6 }}>{r.icon}</span>
                        <strong style={{ marginRight: 6 }}>[{r.priority}] {r.category}:</strong>
                        {r.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {report.achievements.length > 0 && (
                <div className="chart-card">
                  <h3 className="chart-title">🏅 Achievements</h3>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {report.achievements.map((a, i) => (
                      <li key={i} style={{ padding: '6px 0' }}>
                        <span style={{ marginRight: 6 }}>{a.icon}</span>{a.text}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Agent rankings */}
          <div className="view-section">
            <h3 className="section-title">🏆 Agent Rankings</h3>
            <div className="ticket-table-scroll">
              <table className="ticket-table">
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>RANK</th>
                    <th>AGENT</th>
                    <th>SCORE</th>
                    <th>TOTAL</th>
                    <th>COMPLETED</th>
                    <th>RATE</th>
                    <th>CLOSED</th>
                    <th>INVALID</th>
                    <th>CAN'T DO</th>
                    <th>PENDING</th>
                    <th>WITH REASON</th>
                  </tr>
                </thead>
                <tbody>
                  {report.agentRankings.map((a, i) => (
                    <tr key={a.name}>
                      <td>
                        {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : <strong>#{i + 1}</strong>}
                      </td>
                      <td><strong>{a.name}</strong></td>
                      <td><strong style={{ color: a.score >= 0 ? '#10B981' : '#EF4444' }}>{a.score}</strong></td>
                      <td>{a.total}</td>
                      <td style={{ color: '#10B981', fontWeight: 600 }}>{a.completed}</td>
                      <td>{a.completionRate}%</td>
                      <td>{a.closed}</td>
                      <td>{a.invalidClosed > 0 ? <span style={{ color: '#EF4444' }}>{a.invalidClosed}</span> : 0}</td>
                      <td>{a.cantDo}</td>
                      <td>{a.pending}</td>
                      <td>{a.reasonRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Top concerns + Support type breakdown */}
          <div className="view-section" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
            <div className="chart-card">
              <h3 className="chart-title">🔥 Top Concerns</h3>
              {report.topConcerns.map(c => (
                <BreakdownRow
                  key={c.concern}
                  label={c.concern}
                  count={c.count}
                  pct={c.percentage}
                  color="#4F46E5"
                />
              ))}
            </div>
            <div className="chart-card">
              <h3 className="chart-title">🏢 Support Type Mix</h3>
              {report.supportTypeBreakdown.map(s => (
                <BreakdownRow
                  key={s.type}
                  label={s.type}
                  count={s.count}
                  pct={s.percentage}
                  color="#059669"
                />
              ))}
            </div>
          </div>

          {/* Tickets list (top 50) */}
          <div className="view-section">
            <div className="section-header">
              <h3 className="section-title">🎫 Tickets in {report.period.monthName}</h3>
              <span className="section-count">
                Showing {Math.min(50, report.tickets.length)} of {report.tickets.length}
              </span>
            </div>
            <div className="ticket-table-scroll">
              <table className="ticket-table">
                <thead>
                  <tr>
                    <th>ID</th><th>Date</th><th>Agent</th><th>Business</th>
                    <th>MID</th><th>Concern</th><th>Type</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {report.tickets.slice(0, 50).map(t => (
                    <tr key={t.id}>
                      <td className="td-id">{t.id}</td>
                      <td>{t.date}</td>
                      <td>{t.agent}</td>
                      <td>{t.business}</td>
                      <td>{t.mid}</td>
                      <td>{t.concern}</td>
                      <td>{t.supportType}</td>
                      <td>{t.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Helpers ───────────────────────────────────────────────────── */
function SummaryCard({
  label, value, icon, color, sub,
}: { label: string; value: number | string; icon: string; color: string; sub?: string }) {
  return (
    <div className="kpi-card" style={{ borderTop: `3px solid ${color}` }}>
      <div className="kpi-head">
        <span className="kpi-label" style={{ color }}>{label}</span>
        <span className="kpi-icon" aria-hidden="true">{icon}</span>
      </div>
      <div className="kpi-val">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      {sub && <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function InsightItem({
  icon, title, primary, secondary,
}: { icon: string; title: string; primary: string; secondary: string }) {
  return (
    <div className="kpi-card" role="listitem">
      <div className="kpi-head">
        <span className="kpi-label">{title}</span>
        <span className="kpi-icon" aria-hidden="true">{icon}</span>
      </div>
      <div style={{ fontWeight: 700, fontSize: '1.05rem', marginTop: 4 }}>{primary}</div>
      <div className="text-muted" style={{ fontSize: '0.75rem' }}>{secondary}</div>
    </div>
  );
}

function BreakdownRow({
  label, count, pct, color,
}: { label: string; count: number; pct: number; color: string }) {
  return (
    <div className="bar-row" style={{ marginBottom: 6 }}>
      <span className="bar-name" title={label} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <div className="bar-visual">
        <div className="bar-in" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
      </div>
      <span className="bar-count">{count} ({pct}%)</span>
    </div>
  );
}
