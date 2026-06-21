import { memo } from 'react';

interface AgentStat {
  name: string;
  email: string;
  total: number;
  completed: number;
  notCompleted: number;
  inProgress: number;
  pending: number;
  closed: number;
  validClosed?: number;
  invalidClosed: number;
  cantDo: number;
  pendingOld: number;
  score: number;
  rate: number;
  rank: number;
}

interface Props {
  stat:          AgentStat;
  teamAvg:       number;
  onFilterAgent: (agent: string, status: string) => void;
}

/** Agent performance card — matches legacy renderDashboardAgents exactly */
function AgentCard({ stat: a, teamAvg, onFilterAgent }: Props) {
  const medal = a.rank === 1 ? '🥇' : a.rank === 2 ? '🥈' : a.rank === 3 ? '🥉' : '';
  const topClass = a.rank === 1 ? ' top-performer' : '';
  const rate = a.rate;
  const scoreClass = a.score > 0 ? 'score-positive' : a.score < 0 ? 'score-negative' : 'score-neutral';
  const effClass = rate >= 60 ? 'score-positive' : rate >= 30 ? 'score-neutral' : 'score-negative';
  const peerBarColor = rate >= teamAvg ? '#10B981' : rate >= teamAvg - 10 ? '#F59E0B' : '#EF4444';

  const filter = (status: string) => onFilterAgent(a.name, status);

  return (
    <div className={`agent-card${topClass}`}>
      {/* Crown badge for #1 */}
      <div className="crown-badge">👑 TOP AGENT</div>

      {/* Header */}
      <div className="ac-header">
        <div className="ac-user">
          <span className="ac-medal">{medal}</span>
          <span className="ac-name">{a.name}</span>
        </div>
        <span className="ac-rate">{rate}% Rate</span>
      </div>

      {/* Stats Row 1: Total, Done, Pend, Close, Can't */}
      <div className="ac-stats-row">
        <button className="stat-btn sb-total agent-stat-btn" onClick={() => filter('Total')}>
          <span className="sb-val">{a.total}</span><span className="sb-lbl">Total</span>
        </button>
        <button className="stat-btn sb-done agent-stat-btn" onClick={() => filter('Completed')}>
          <span className="sb-val">{a.completed}</span><span className="sb-lbl">Done</span>
        </button>
        <button className="stat-btn sb-pend agent-stat-btn" onClick={() => filter('Not Completed')}>
          <span className="sb-val">{a.notCompleted + a.pending + a.inProgress}</span><span className="sb-lbl">Pend</span>
        </button>
        <button className="stat-btn sb-closed agent-stat-btn" onClick={() => filter('Closed')}>
          <span className="sb-val">{a.closed}</span><span className="sb-lbl">Close</span>
        </button>
        <button className="stat-btn sb-cant agent-stat-btn" onClick={() => filter("Can't Do")}>
          <span className="sb-val">{a.cantDo}</span><span className="sb-lbl">Can&apos;t</span>
        </button>
      </div>

      {/* Stats Row 2: Invalid + Old Pending */}
      <div className="ac-stats-row" style={{ marginTop: 8 }}>
        <button className="stat-btn sb-invalid agent-stat-btn" style={{ gridColumn: 'span 2' }} onClick={() => filter('Invalid Closed')}>
          <span className="sb-val">{a.invalidClosed}</span>
          <span className="sb-lbl" style={{ color: '#DC2626' }}>⚠ Invalid</span>
        </button>
        <button className="stat-btn sb-pend agent-stat-btn" style={{ gridColumn: 'span 3' }} onClick={() => filter('Old Pending')}>
          <span className="sb-val">{a.pendingOld}</span>
          <span className="sb-lbl">Pending &gt;7d</span>
        </button>
      </div>

      {/* Score Row: Points, Completion Rate, Rank */}
      <div className="ac-score-row">
        <div className="score-box">
          <span className={`score-val ${scoreClass}`}>{a.score > 0 ? '+' : ''}{a.score}</span>
          <span className="score-lbl">Points</span>
        </div>
        <div className="score-box">
          <span className={`score-val ${effClass}`}>{rate}%</span>
          <span className="score-lbl">Completion Rate</span>
        </div>
        <div className="score-box">
          <span className="score-val" style={{ color: 'var(--warning)' }}>#{a.rank}</span>
          <span className="score-lbl">Rank</span>
        </div>
      </div>

      {/* Peer Performance Bar */}
      <div className="peer-compare" title={`Agent rate: ${rate}%, Team average: ${Math.round(teamAvg)}%`}>
        <div className="peer-label">Performance vs Team</div>
        <div className="peer-bar-bg">
          <div className="peer-bar-fill" style={{ width: `${rate}%`, background: peerBarColor }} />
          <div className="peer-avg-line" style={{ left: `${teamAvg}%` }} />
        </div>
      </div>
    </div>
  );
}

export default memo(AgentCard);
