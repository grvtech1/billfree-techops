import { useMemo, useState, useCallback } from 'react';
import { useTicketStore } from '../store/ticketStore';
import DatePills from '../components/filters/DatePills';
import type { Ticket } from '../types';
import {
  BarChart, Bar,
  PieChart, Pie, Cell, Sector,
  XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { CHART_COLORS } from '../lib/constants';

/* ── EXCLUDE lists matching legacy exactly ──────────────────────────── */
const EXCLUDE_MIDS = new Set(['301', '201', '202', '302']);
const EXCLUDE_POS  = new Set(['bf', 'Bf', 'BF', 'Billfree', 'billfree', 'BillFree', '-', '']);
const POS_COLORS   = ['#667eea', '#764ba2', '#f093fb', '#4facfe', '#43e97b',
                      '#fa709a', '#fee140', '#30cfd0', '#a8edea', '#fed6e3'];

/* ── Top MIDs — Same Recurring Issue (matches renderMIDSameConcern) ─── */
function computeMIDsSameConcern(tickets: Ticket[]) {
  const map: Record<string, { mid: string; concern: string; business: string; count: number }> = {};
  tickets.forEach(t => {
    if (!t.mid || t.mid === '-' || EXCLUDE_MIDS.has(t.mid)) return;
    const key = `${t.mid}|||${t.concern}`;
    if (!map[key]) map[key] = { mid: t.mid, concern: t.concern, business: t.business, count: 0 };
    map[key].count++;
  });
  return Object.values(map).sort((a, b) => b.count - a.count).slice(0, 10);
}

/* ── Top MIDs — Different Concerns (matches renderMIDDiffConcern) ───── */
function computeMIDsDiffConcern(tickets: Ticket[]) {
  const map: Record<string, { mid: string; business: string; concerns: Set<string>; total: number }> = {};
  tickets.forEach(t => {
    if (!t.mid || t.mid === '-' || EXCLUDE_MIDS.has(t.mid)) return;
    if (!map[t.mid]) map[t.mid] = { mid: t.mid, business: t.business, concerns: new Set(), total: 0 };
    map[t.mid].concerns.add(t.concern);
    map[t.mid].total++;
  });
  return Object.values(map)
    .map(m => ({ mid: m.mid, business: m.business, concernCount: m.concerns.size, totalTickets: m.total, concerns: Array.from(m.concerns) }))
    .filter(m => m.concernCount > 1)
    .sort((a, b) => b.concernCount - a.concernCount)
    .slice(0, 10);
}

/* ── Top POS Systems (matches renderTopPOS — doughnut) ────────────── */
function computeTopPOS(tickets: Ticket[]) {
  const map: Record<string, { pos: string; count: number; businesses: Set<string> }> = {};
  tickets.forEach(t => {
    const pos = (t.pos || '').trim();
    if (!pos || EXCLUDE_POS.has(pos)) return;
    if (!map[pos]) map[pos] = { pos, count: 0, businesses: new Set() };
    map[pos].count++;
    map[pos].businesses.add(t.business);
  });
  return Object.values(map)
    .map(p => ({ pos: p.pos, count: p.count, businessCount: p.businesses.size }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

/* ── Repeat Customers (matches renderRepeatCustomers — dual-axis bar) ─ */
function computeRepeatCustomers(tickets: Ticket[]) {
  const map: Record<string, { business: string; mid: string; count: number; completed: number; concerns: Set<string> }> = {};
  tickets.forEach(t => {
    if (!t.business || t.business === '-') return;
    if (!map[t.business]) map[t.business] = { business: t.business, mid: t.mid, count: 0, completed: 0, concerns: new Set() };
    map[t.business].count++;
    map[t.business].concerns.add(t.concern);
    if (t.status.toLowerCase() === 'completed') map[t.business].completed++;
  });
  return Object.values(map)
    .filter(b => b.count >= 3)
    .map(b => ({ business: b.business.substring(0, 25), ticketCount: b.count, completionRate: Math.round((b.completed / b.count) * 100) }))
    .sort((a, b) => b.ticketCount - a.ticketCount)
    .slice(0, 10);
}

/* ── Concern Trends (matches renderConcernTrends — current vs prior 30d) */
function computeConcernTrends(tickets: Ticket[]) {
  const now = Date.now();
  const last30  = now - 30 * 864e5;
  const last60  = now - 60 * 864e5;
  const current: Record<string, number> = {};
  const previous: Record<string, number> = {};
  tickets.forEach(t => {
    if (t.sortDate >= last30) current[t.concern] = (current[t.concern] || 0) + 1;
    else if (t.sortDate >= last60) previous[t.concern] = (previous[t.concern] || 0) + 1;
  });
  const all = new Set([...Object.keys(current), ...Object.keys(previous)]);
  return Array.from(all)
    .map(c => ({ concern: c, current: current[c] || 0, previous: previous[c] || 0 }))
    .sort((a, b) => (b.current + b.previous) - (a.current + a.previous))
    .slice(0, 8);
}

/* ── Agent Specialization Matrix (matches renderAgentSpecialization) ─── */
function computeAgentMatrix(tickets: Ticket[]) {
  const matrix: Record<string, Record<string, number>> = {};
  tickets.forEach(t => {
    if (!matrix[t.agent]) matrix[t.agent] = {};
    matrix[t.agent][t.supportType] = (matrix[t.agent][t.supportType] || 0) + 1;
  });
  return matrix;
}

/* ── Floor Support Table (matches renderFloorSupport) ─────────────── */
function computeFloorSupport(tickets: Ticket[]) {
  return tickets
    .filter(t => t.supportType === 'IT Floor' || t.supportType.toLowerCase().includes('it floor'))
    .sort((a, b) => b.sortDate - a.sortDate)
    .slice(0, 5);
}

/* ── Agent Matrix Table ───────────────────────────────────────────── */
function AgentMatrixTable({ matrix }: { matrix: Record<string, Record<string, number>> }) {
  const agents = Object.keys(matrix);
  const types  = Array.from(new Set(agents.flatMap(a => Object.keys(matrix[a] ?? {}))));
  if (!agents.length) return <p className="text-muted">No data yet.</p>;
  return (
    <div className="agent-matrix-table-wrapper">
      <table className="agent-matrix-table">
        <thead>
          <tr>
            <th>Agent</th>
            {types.map(t => <th key={t}>{t}</th>)}
          </tr>
        </thead>
        <tbody>
          {agents.map(agent => (
            <tr key={agent}>
              <td className="agent-matrix-name">{agent}</td>
              {types.map(t => {
                const v   = matrix[agent]?.[t] ?? 0;
                const max = Math.max(...agents.map(a => matrix[a]?.[t] ?? 0));
                const pct = max ? (v / max) * 100 : 0;
                return (
                  <td key={t} className="agent-matrix-cell">
                    <div className="agent-matrix-bar-track">
                      <div className="agent-matrix-bar-fill" style={{ width: `${pct}%`, background: CHART_COLORS[types.indexOf(t) % CHART_COLORS.length] }} />
                    </div>
                    <span className="agent-matrix-val">{v}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Status badge for Floor Support table ──────────────────────────── */
function FloorStatusBadge({ status }: { status: string }) {
  const sl = status.toLowerCase();
  const cls = sl === 'completed' ? 's-done' : sl === 'closed' ? 's-closed' : 's-pend';
  return <span className={`badge ${cls}`}>{status}</span>;
}

/* ══════════════════════════════════════════════════════════════════════
   ANALYTICS VIEW — All charts computed from live dateData 
   (matches legacy renderAdvancedAnalytics + renderAnalytics)
   ══════════════════════════════════════════════════════════════════════ */
export default function AnalyticsView() {
  const dateData = useTicketStore(s => s.dateData);

  const midsSame        = useMemo(() => computeMIDsSameConcern(dateData),  [dateData]);
  const midsDiff        = useMemo(() => computeMIDsDiffConcern(dateData),  [dateData]);
  const topPOS          = useMemo(() => computeTopPOS(dateData),           [dateData]);
  const repeatCustomers = useMemo(() => computeRepeatCustomers(dateData),  [dateData]);
  const concernTrends   = useMemo(() => computeConcernTrends(dateData),    [dateData]);
  const agentMatrix     = useMemo(() => computeAgentMatrix(dateData),      [dateData]);
  const floorSupport    = useMemo(() => computeFloorSupport(dateData),     [dateData]);

  // Pie chart active slice index state
  const [activePieIndex, setActivePieIndex] = useState<number | null>(null);

  const onPieEnter = useCallback((_: unknown, index: number) => {
    setActivePieIndex(index);
  }, []);

  const onPieLeave = useCallback(() => {
    setActivePieIndex(null);
  }, []);

  // Premium Custom Tooltip Component.
  // recharts passes a loosely-typed Tooltip `content` props object; typing it
  // strictly fights recharts' own ContentType signature, so we scope the any here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CustomChartTooltip = useCallback(({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;
    return (
      <div className="custom-chart-tooltip">
        <div className="tooltip-title">{label || 'Details'}</div>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {payload.map((p: any, i: number) => (
          <div key={i} className="tooltip-row" style={{ color: p.color || p.fill }}>
            <span>{p.name}:</span>
            <strong>{p.value}</strong>
          </div>
        ))}
      </div>
    );
  }, []);

  // Custom active shape for the POS Distribution doughnut chart.
  // recharts' activeShape callback receives a wide, loosely-typed sector props
  // object (PieSectorDataItem); scope the any rather than mis-type the signature.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderActiveShape = useCallback((props: any) => {
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, payload, percent, value } = props;
    return (
      <g>
        <text x={cx} y={cy} dy={-6} textAnchor="middle" fill="var(--text-main)" fontSize={13} fontWeight="bold">
          {payload.pos}
        </text>
        <text x={cx} y={cy} dy={14} textAnchor="middle" fill="var(--text-sec)" fontSize={11}>
          {`${value} tkts (${Math.round((percent ?? 0) * 100)}%)`}
        </text>
        <Sector
          cx={cx}
          cy={cy}
          innerRadius={innerRadius}
          outerRadius={outerRadius + 6}
          startAngle={startAngle}
          endAngle={endAngle}
          fill={fill}
        />
        <Sector
          cx={cx}
          cy={cy}
          innerRadius={innerRadius - 4}
          outerRadius={innerRadius}
          startAngle={startAngle}
          endAngle={endAngle}
          fill={fill}
        />
      </g>
    );
  }, []);

  return (
    <div className="view-container analytics-view">
      <div className="filter-bar"><DatePills /></div>

      <div className="section-header">
        <h2 className="section-title">📊 Manager Analytics</h2>
        <span className="analytics-badge-live">{dateData.length} tickets</span>
      </div>

      <div className="charts-grid">
        {/* 1. Concern Trend — grouped bar chart (current vs prior 30d) */}
        <div className="chart-card">
          <h3 className="chart-title">📈 Concern Trend (Current vs Prior 30d)</h3>
          {concernTrends.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={concernTrends} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <defs>
                  <linearGradient id="currentTrendGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#818CF8" stopOpacity={1}/>
                    <stop offset="100%" stopColor="#4F46E5" stopOpacity={0.8}/>
                  </linearGradient>
                  <linearGradient id="previousTrendGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#C084FC" stopOpacity={1}/>
                    <stop offset="100%" stopColor="#7C3AED" stopOpacity={0.8}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="concern" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip content={<CustomChartTooltip />} />
                <Legend />
                <Bar dataKey="current"  name="Current 30d"  fill="url(#currentTrendGrad)" radius={[4,4,0,0]} />
                <Bar dataKey="previous" name="Prior 30d"    fill="url(#previousTrendGrad)" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="chart-empty">No trend data available</div>}
        </div>

        {/* 2. Agent Specialization Matrix */}
        <div className="chart-card">
          <h3 className="chart-title">🎯 Agent Specialization Matrix</h3>
          <AgentMatrixTable matrix={agentMatrix} />
        </div>

        {/* 3. Top MIDs — Same Recurring Issue */}
        <div className="chart-card">
          <h3 className="chart-title">🔄 Repeat MIDs — Same Concern</h3>
          {midsSame.length > 0 ? (
            <ResponsiveContainer width="100%" height={Math.max(220, midsSame.length * 30)}>
              <BarChart data={midsSame} layout="vertical" margin={{ top: 5, right: 30, bottom: 5, left: 60 }}>
                <defs>
                  <linearGradient id="midsSameGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#F87171" stopOpacity={0.7}/>
                    <stop offset="100%" stopColor="#EF4444" stopOpacity={1}/>
                  </linearGradient>
                </defs>
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="mid" width={70} tick={{ fontSize: 11 }} />
                <Tooltip content={({ active, payload }) => {
                  const d = payload?.[0]?.payload;
                  if (!active || !d) return null;
                  return (
                    <div className="custom-chart-tooltip">
                      <div className="tooltip-title">{d.mid}</div>
                      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-sec)', marginBottom: 4 }}>{d.concern}</div>
                      <div className="tooltip-row" style={{ color: '#EF4444' }}>
                        <span>Business: <strong>{d.business}</strong></span>
                      </div>
                      <div className="tooltip-row" style={{ color: '#EF4444' }}>
                        <span>Tickets: <strong>{d.count}</strong></span>
                      </div>
                    </div>
                  );
                }} />
                <Bar dataKey="count" name="Tickets" fill="url(#midsSameGrad)" radius={[0,4,4,0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="chart-empty">No recurring issues found</div>}
        </div>

        {/* 4. Top MIDs — Multiple Concerns */}
        <div className="chart-card">
          <h3 className="chart-title">🔀 Repeat MIDs — Multiple Concerns</h3>
          {midsDiff.length > 0 ? (
            <ResponsiveContainer width="100%" height={Math.max(220, midsDiff.length * 30)}>
              <BarChart data={midsDiff} layout="vertical" margin={{ top: 5, right: 30, bottom: 5, left: 60 }}>
                <defs>
                  <linearGradient id="midsDiffGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#FBBF24" stopOpacity={0.7}/>
                    <stop offset="100%" stopColor="#D97706" stopOpacity={1}/>
                  </linearGradient>
                </defs>
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="mid" width={70} tick={{ fontSize: 11 }} />
                <Tooltip content={({ active, payload }) => {
                  const d = payload?.[0]?.payload;
                  if (!active || !d) return null;
                  return (
                    <div className="custom-chart-tooltip">
                      <div className="tooltip-title">{d.mid}</div>
                      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-sec)', marginBottom: 4 }}>{d.business}</div>
                      <div className="tooltip-row" style={{ color: '#D97706' }}>
                        <span>Issues: <strong>{d.concernCount}</strong></span>
                      </div>
                      <div className="tooltip-row" style={{ color: '#D97706' }}>
                        <span>Total Tickets: <strong>{d.totalTickets}</strong></span>
                      </div>
                      <div style={{ fontSize: '10px', marginTop: 4, opacity: 0.8, color: 'var(--text-sec)' }}>
                        {d.concerns?.join(', ')}
                      </div>
                    </div>
                  );
                }} />
                <Bar dataKey="concernCount" name="Different Issues" fill="url(#midsDiffGrad)" radius={[0,4,4,0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="chart-empty">No MIDs with multiple issues</div>}
        </div>

        {/* 5. POS Distribution — Doughnut (matches legacy doughnut) */}
        <div className="chart-card">
          <h3 className="chart-title">🖥️ POS System Distribution</h3>
          {topPOS.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  activeIndex={activePieIndex !== null ? activePieIndex : undefined}
                  activeShape={renderActiveShape}
                  data={topPOS}
                  dataKey="count"
                  nameKey="pos"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={95}
                  onMouseEnter={onPieEnter}
                  onMouseLeave={onPieLeave}
                  label={false}
                  labelLine={false}
                >
                  {topPOS.map((_, i) => (
                    <Cell key={i} fill={POS_COLORS[i % POS_COLORS.length]} style={{ outline: 'none' }} />
                  ))}
                </Pie>
                <Tooltip content={({ active, payload }) => {
                  const d = payload?.[0]?.payload;
                  if (!active || !d) return null;
                  return (
                    <div className="custom-chart-tooltip">
                      <div className="tooltip-title">{d.pos}</div>
                      <div className="tooltip-row" style={{ color: 'var(--primary)' }}>
                        <span>Tickets: <strong>{d.count}</strong></span>
                      </div>
                      <div className="tooltip-row" style={{ color: 'var(--primary)' }}>
                        <span>Businesses: <strong>{d.businessCount}</strong></span>
                      </div>
                    </div>
                  );
                }} />
              </PieChart>
            </ResponsiveContainer>
          ) : <div className="chart-empty">No POS data available</div>}
        </div>

        {/* 6. Repeat Customers — dual-axis bar (matches legacy exactly) */}
        <div className="chart-card">
          <h3 className="chart-title">🏪 Repeat Customer Businesses (3+ tickets)</h3>
          {repeatCustomers.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={repeatCustomers} margin={{ top: 5, right: 20, bottom: 30, left: 0 }}>
                <defs>
                  <linearGradient id="repCustTicketsGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#C084FC" stopOpacity={1}/>
                    <stop offset="100%" stopColor="#8B5CF6" stopOpacity={0.8}/>
                  </linearGradient>
                  <linearGradient id="repCustRateGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#34D399" stopOpacity={1}/>
                    <stop offset="100%" stopColor="#059669" stopOpacity={0.8}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="business" tick={{ fontSize: 10 }} angle={-15} textAnchor="end" />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} domain={[0, 100]} />
                <Tooltip content={<CustomChartTooltip />} />
                <Legend />
                <Bar yAxisId="left" dataKey="ticketCount" name="Total Tickets" fill="url(#repCustTicketsGrad)" radius={[4,4,0,0]} />
                <Bar yAxisId="right" dataKey="completionRate" name="Completion %" fill="url(#repCustRateGrad)" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="chart-empty">No repeat customers (need 3+ tickets)</div>}
        </div>
      </div>

      {/* 7. Floor Support Table (matches legacy renderFloorSupport) */}
      <div className="view-section">
        <h3 className="section-title">🏢 IT Floor Support — Recent Tickets</h3>
        {floorSupport.length > 0 ? (
          <div className="ticket-table-scroll">
            <table className="ticket-table">
              <thead>
                <tr>
                  <th>ID</th><th>Date</th><th>Agent</th><th>Requested By</th>
                  <th>Business</th><th>Concern</th><th>Remark</th>
                  <th>Phone</th><th>Status</th><th>Age</th>
                </tr>
              </thead>
              <tbody>
                {floorSupport.map(t => (
                  <tr key={t.id}>
                    <td><strong>{t.id}</strong></td>
                    <td>{t.date}</td>
                    <td>{t.agent}</td>
                    <td>{t.requestedBy}</td>
                    <td>{t.business}</td>
                    <td>{t.concern}</td>
                    <td style={{ maxWidth: 250, fontSize: 'var(--fs-xs, 0.75rem)' }}>{t.remark || '—'}</td>
                    <td>{t.phoneDisplay || '—'}</td>
                    <td><FloorStatusBadge status={t.status} /></td>
                    <td><strong>{t.ageDays}d</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="chart-empty" style={{ padding: 30 }}>
            No IT Floor Support tickets in selected date range
          </div>
        )}
      </div>
    </div>
  );
}
