import { useTicketStore } from '../store/ticketStore';
import DatePills from '../components/filters/DatePills';
import TicketTable from '../components/tickets/TicketTable';
import { useState, useMemo } from 'react';

/* ── Badge logic (matching legacy renderLeaderboard) ─────────── */
interface Badge { icon: string; name: string; color: string }

function computeBadges(a: {
  rate: number; avgDays: number; invalidClosed: number;
  cantDo: number; total: number; completed: number;
}, period: string): Badge[] {
  const badges: Badge[] = [];
  if (a.rate >= 90)                                  badges.push({ icon: '🎯', name: 'Sharpshooter', color: '#10B981' });
  if (a.avgDays <= 2 && a.completed > 0)             badges.push({ icon: '⚡', name: 'Speed Demon',  color: '#F59E0B' });
  if (a.total >= 50 && period === 'week')             badges.push({ icon: '💪', name: 'Workhorse',    color: '#8B5CF6' });
  if (a.invalidClosed === 0 && a.total >= 10)         badges.push({ icon: '✨', name: 'Quality Pro',   color: '#3B82F6' });
  if (a.cantDo === 0 && a.total >= 20)                badges.push({ icon: '🔧', name: 'Problem Solver', color: '#EF4444' });
  return badges;
}

/* ── Bar chart row ───────────────────────────────────────────── */
function BarRow({ name, count, max, color }: { name: string; count: number; max: number; color: string }) {
  const pct = max ? Math.round((count / max) * 100) : 0;
  return (
    <div className="bar-row">
      <span className="bar-name">{name}</span>
      <div className="bar-visual"><div className="bar-in" style={{ width: `${pct}%`, background: color }} /></div>
      <span className="bar-count">{count}</span>
    </div>
  );
}

export default function TeamReportView() {
  const rawData     = useTicketStore(s => s.rawData);
  const dateData    = useTicketStore(s => s.dateData);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<'leaderboard' | 'detailed'>('leaderboard');
  const [period, setPeriod] = useState<'all' | 'week' | 'month'>('all');

  const selectedAgentTickets = selected
    ? dateData.filter(t => t.email === selected || t.agent === selected)
    : [];

  /* ── Period label ──────────────────────────────────────────── */
  const periodLabel = period === 'week' ? 'This Week' : period === 'month' ? 'This Month' : 'All Time';

  /* ── Enriched agent data — computed from RAW_DATA with period filter
       (matches legacy renderLeaderboard which filters RAW_DATA) ──── */
  const enrichedAgents = useMemo(() => {
    const now = Date.now();
    let startDate = 0;
    if (period === 'week')  startDate = now - 7 * 864e5;
    if (period === 'month') startDate = now - 30 * 864e5;

    const filteredTickets = rawData.filter(t => t.sortDate >= startDate);
    const totalAll = filteredTickets.length;

    // Build agent stats from filtered period data
    const agentMap: Record<string, {
      name: string; email: string;
      total: number; completed: number; closed: number; validClosed: number;
      invalidClosed: number; cantDo: number; pendingOld: number;
      completedDays: number;
    }> = {};

    filteredTickets.forEach(t => {
      const key = t.email || t.agent || 'Unknown';
      if (!agentMap[key]) {
        agentMap[key] = {
          name: t.agent, email: t.email,
          total: 0, completed: 0, closed: 0, validClosed: 0,
          invalidClosed: 0, cantDo: 0, pendingOld: 0, completedDays: 0,
        };
      }
      const a = agentMap[key];
      a.total++;
      const sl = t.status.toLowerCase();
      if (sl === 'completed') { a.completed++; a.completedDays += t.ageDays; }
      else if (sl === 'closed') {
        a.closed++;
        if (t.invalidClosed) a.invalidClosed++; else a.validClosed++;
      }
      else if (sl.includes("can't") || sl.includes('cant')) a.cantDo++;
      if (t.ageDays > 7 && sl !== 'completed' && sl !== 'closed') a.pendingOld++;
    });

    return Object.values(agentMap).map(a => {
      // ── UNIFIED SCORING (matches legacy renderLeaderboard exactly) ──
      let points = (a.completed * 10) + (a.validClosed * 0) - (a.cantDo * 5) - (a.invalidClosed * 10) - (a.pendingOld * 3);
      const rate = a.total > 0 ? Math.round((a.completed / a.total) * 100) : 0;
      const avgDays = a.completed > 0 ? Math.round(a.completedDays / a.completed) : 0;

      // Bonus for 95%+ rate (matches legacy)
      if (rate >= 95) points += 20;

      const badges = computeBadges({ ...a, rate, avgDays }, period);

      // Top concerns from filtered tickets
      const agentTickets = filteredTickets.filter(t => t.email === a.email || t.agent === a.name);
      const concernCounts: Record<string, number> = {};
      agentTickets.forEach(t => { concernCounts[t.concern] = (concernCounts[t.concern] || 0) + 1; });
      const topConcerns = Object.entries(concernCounts).sort((x, y) => y[1] - x[1]).slice(0, 5);

      // Support type mix
      const typeCounts: Record<string, number> = {};
      agentTickets.forEach(t => { typeCounts[t.supportType] = (typeCounts[t.supportType] || 0) + 1; });
      const topTypes = Object.entries(typeCounts).sort((x, y) => y[1] - x[1]);

      return {
        ...a, points, rate, avgDays, badges, topConcerns, topTypes,
        workloadPct: totalAll ? Math.round((a.total / totalAll) * 100) : 0,
        notCompleted: agentTickets.filter(t => !['completed', 'closed'].includes(t.status.toLowerCase()) && !t.status.toLowerCase().includes("can't")).length,
        pending: agentTickets.filter(t => t.status === 'Pending').length,
      };
    }).sort((a, b) => b.points - a.points);
  }, [rawData, period]);

  /* ── Podium (top 3 rearranged: 2nd, 1st, 3rd) ──────────── */
  const podium = useMemo(() => {
    const top3 = enrichedAgents.slice(0, 3);
    if (top3.length < 2) return top3;
    return [top3[1], top3[0], top3[2]].filter(Boolean);
  }, [enrichedAgents]);

  return (
    <div className="view-container">
      <div className="view-section"><DatePills /></div>

      {/* ══════ LEADERBOARD SECTION ══════ */}
      <div className="leaderboard-banner">
        <div className="lb-header">
          <div>
            <h2 className="lb-title">🏆 Team Leaderboard</h2>
            <p className="lb-sub">{periodLabel} • Updated just now</p>
          </div>
          <div className="lb-pills">
            {/* Period Filter Pills (matches legacy All/Week/Month) */}
            <button className={`lb-pill ${period === 'all' ? 'active' : ''}`} onClick={() => setPeriod('all')}>All Time</button>
            <button className={`lb-pill ${period === 'week' ? 'active' : ''}`} onClick={() => setPeriod('week')}>This Week</button>
            <button className={`lb-pill ${period === 'month' ? 'active' : ''}`} onClick={() => setPeriod('month')}>This Month</button>
            <span className="lb-pill-divider">|</span>
            <button className={`lb-pill ${tab === 'leaderboard' ? 'active' : ''}`} onClick={() => setTab('leaderboard')}>Leaderboard</button>
            <button className={`lb-pill ${tab === 'detailed' ? 'active' : ''}`} onClick={() => setTab('detailed')}>Detailed</button>
          </div>
        </div>

        {tab === 'leaderboard' && (
          <>
            {/* Podium */}
            <div className="podium-grid">
              {podium.map((agent, idx) => {
                const position = idx === 1 ? 1 : idx === 0 ? 2 : 3;
                const medal = position === 1 ? '🥇' : position === 2 ? '🥈' : '🥉';
                const borderColor = position === 1 ? '#F59E0B' : position === 2 ? '#94A3B8' : '#D97706';
                return (
                  <div key={agent.email} className={`podium-card podium-${position}`} style={{ border: `2px solid ${borderColor}`, order: idx === 1 ? 1 : idx === 0 ? 2 : 3 }}>
                    <div className="podium-medal">{medal}</div>
                    <div className="podium-name">{agent.name}</div>
                    <div className="podium-points">{agent.points}</div>
                    <div className="podium-label">POINTS</div>
                    <div className="podium-stats">
                      <div><span style={{ color: '#059669', fontWeight: 800 }}>{agent.completed}</span><br /><small>Done</small></div>
                      <div><span style={{ color: '#667eea', fontWeight: 800 }}>{agent.rate}%</span><br /><small>Rate</small></div>
                      <div><span style={{ color: '#F59E0B', fontWeight: 800 }}>{agent.avgDays}d</span><br /><small>Avg</small></div>
                    </div>
                    <div className="podium-badges">
                      {agent.badges.map(b => <span key={b.name} title={b.name} className="badge-icon">{b.icon}</span>)}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Full Rankings Table */}
            <div className="view-section">
              <div className="section-header">
                <h3 className="section-title">📋 Full Rankings</h3>
              </div>
              <div className="ticket-table-scroll">
                <table className="ticket-table lb-table">
                  <thead>
                    <tr>
                      <th style={{ width: 60 }}>RANK</th>
                      <th>AGENT</th>
                      <th>POINTS</th>
                      <th>TICKETS</th>
                      <th>COMPLETED</th>
                      <th>RATE %</th>
                      <th>AVG TIME</th>
                      <th>BADGES</th>
                    </tr>
                  </thead>
                  <tbody>
                    {enrichedAgents.map((a, i) => (
                      <tr
                        key={a.email}
                        style={i < 3 ? { background: 'linear-gradient(to right, #F8FAFC, white)' } : undefined}
                        className="clickable-row"
                        onClick={() => setSelected(a.email)}
                      >
                        <td style={{ textAlign: 'center' }}>
                          {i < 3 ? <span style={{ fontSize: '1.5rem' }}>{i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}</span> : <strong>#{i + 1}</strong>}
                        </td>
                        <td><strong>{a.name}</strong></td>
                        <td><strong style={{ color: '#667eea', fontSize: '1.1rem' }}>{a.points}</strong></td>
                        <td>{a.total}</td>
                        <td><span style={{ color: '#059669', fontWeight: 700 }}>{a.completed}</span></td>
                        <td><strong>{a.rate}%</strong></td>
                        <td>{a.avgDays}d</td>
                        <td>
                          {a.badges.length > 0
                            ? a.badges.map(b => <span key={b.name} title={b.name} style={{ fontSize: '1.2rem', margin: '0 2px' }}>{b.icon}</span>)
                            : <span style={{ color: '#94A3B8' }}>-</span>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {tab === 'detailed' && (
          <>
            {/* ══════ DETAILED PERFORMANCE REPORTS ══════ */}
            <div className="section-title" style={{ marginTop: 24 }}>📊 Detailed Performance Reports</div>
            <div className="report-grid">
              {enrichedAgents.map((a, i) => {
                const scoreClass = a.points > 0 ? 'score-positive' : a.points < 0 ? 'score-negative' : 'score-neutral';
                const maxConcern = a.topConcerns.length > 0 ? a.topConcerns[0][1] : 1;
                const maxType = a.topTypes.length > 0 ? a.topTypes[0][1] : 1;
                return (
                  <div key={a.email} className={`report-card ${i < 3 ? `rank-${i + 1}` : ''}`}>
                    {/* Header */}
                    <div className="rep-header">
                      <div className="rep-info">
                        <h3>{a.name}</h3>
                        <p>Rank #{i + 1} • {a.rate}% Completion Rate</p>
                      </div>
                      <div className="rep-score-box">
                        <span className={`rep-score-val ${scoreClass}`}>{a.points > 0 ? '+' : ''}{a.points}</span>
                        <span className="rep-score-lbl">Performance Score</span>
                      </div>
                    </div>
                    {/* Stat Boxes */}
                    <div className="rep-body">
                      <div className="rep-stats-row">
                        <div className="s-box sb-total"><span className="sb-val">{a.total}</span><span className="sb-lbl">Total</span></div>
                        <div className="s-box sb-done"><span className="sb-val">{a.completed}</span><span className="sb-lbl">Completed</span></div>
                        <div className="s-box sb-pend"><span className="sb-val">{a.notCompleted}</span><span className="sb-lbl">Pending</span></div>
                        <div className="s-box sb-closed"><span className="sb-val">{a.validClosed}</span><span className="sb-lbl">Closed</span></div>
                        <div className="s-box sb-cant"><span className="sb-val">{a.cantDo}</span><span className="sb-lbl">Can&apos;t Do</span></div>
                        <div className="s-box sb-invalid"><span className="sb-val">{a.invalidClosed}</span><span className="sb-lbl">Invalid</span></div>
                      </div>
                      {/* Workload bar */}
                      <div className="load-bar-wrap">
                        <div className="load-meta">
                          <span>Workload Share</span>
                          <span>{a.total} tickets ({a.workloadPct}%)</span>
                        </div>
                        <div className="load-bg"><div className="load-fill" style={{ width: `${a.workloadPct}%` }} /></div>
                      </div>
                      {/* Top Issues + Support Type */}
                      <div className="lists-grid">
                        <div>
                          <span className="lg-title">Top Issues Handled</span>
                          {a.topConcerns.map(([name, count]) => (
                            <BarRow key={name} name={name} count={count as number} max={maxConcern as number} color="#4F46E5" />
                          ))}
                        </div>
                        <div>
                          <span className="lg-title">Support Type Mix</span>
                          {a.topTypes.map(([name, count]) => (
                            <BarRow key={name} name={name} count={count as number} max={maxType as number} color="#059669" />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Drill-down table */}
      {selected && selectedAgentTickets.length > 0 && (
        <div className="view-section">
          <div className="section-header">
            <h2 className="section-title">
              {enrichedAgents.find(a => a.email === selected)?.name ?? selected}&apos;s Tickets
            </h2>
            <button className="btn btn-ghost btn-sm" onClick={() => setSelected(null)}>✕ Close</button>
          </div>
          <TicketTable tickets={selectedAgentTickets} />
        </div>
      )}
    </div>
  );
}
