import { useState, useMemo } from 'react';
import { useTicketStore } from '../store/ticketStore';
import { useTickets } from '../hooks/useTickets';
import { useUiStore } from '../store/uiStore';
import { downloadCSV } from '../lib/utils';
import DatePills from '../components/filters/DatePills';
import Pagination from '../components/common/Pagination';

/** Reconstruct audit entries from ticket reason field timestamps */
interface AuditEntry {
  timestamp: string;
  agent: string;
  action: string;
  ticketId: string;
  fromStatus: string;
  toStatus: string;
  resolutionMs: number;
  level: 'info' | 'warning' | 'critical';
  note: string;
}

const SPEED_THRESHOLDS = [
  { label: 'FAST (<4H)',     max: 4 * 3600_000,  color: '#10B981', bg: '#ECFDF5' },
  { label: 'NORMAL (>24H)',  max: 24 * 3600_000,  color: '#3B82F6', bg: '#EFF6FF' },
  { label: 'SLOW (>2d)',     max: 48 * 3600_000,  color: '#F59E0B', bg: '#FFFBEB' },
  { label: 'CRITICAL (>3d)', max: Infinity,        color: '#EF4444', bg: '#FEF2F2' },
];

const PAGE_SIZE = 50;

export default function HistoryView() {
  const dateData    = useTicketStore(s => s.dateData);
  const isLoading   = useTicketStore(s => s.isLoading);
  const { fetchData } = useTickets();
  const showToast   = useUiStore(s => s.showToast);
  const openModal   = useUiStore(s => s.openModal);
  const [filters, setFilters] = useState({
    ticketId: '', agent: '', actionType: 'all', severity: 'all',
  });
  const [page, setPage] = useState(1);

  /* ── Build audit entries from ticket data ────────────────── */
  const allEntries = useMemo(() => {
    const entries: AuditEntry[] = [];
    dateData.forEach(t => {
      const status = t.status;
      const isUpdate = status === 'Completed' || status === 'Closed';
      entries.push({
        timestamp: t.date,
        agent: t.agent,
        action: isUpdate ? 'Updated' : 'Created',
        ticketId: t.id,
        fromStatus: 'Not Completed',
        toStatus: status,
        resolutionMs: t.ageDays * 86_400_000,
        level: t.ageDays > 3 ? 'critical' : t.ageDays > 1 ? 'warning' : 'info',
        note: t.reason ? t.reason.slice(0, 50) : '—',
      });
    });
    return entries.sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1));
  }, [dateData]);

  /* ── Filter ──────────────────────────────────────────────── */
  const filtered = useMemo(() => {
    return allEntries.filter(e => {
      if (filters.ticketId && !e.ticketId.toLowerCase().includes(filters.ticketId.toLowerCase())) return false;
      if (filters.agent && !e.agent.toLowerCase().includes(filters.agent.toLowerCase())) return false;
      if (filters.actionType !== 'all' && e.action.toLowerCase() !== filters.actionType.toLowerCase()) return false;
      if (filters.severity !== 'all' && e.level !== filters.severity) return false;
      return true;
    });
  }, [allEntries, filters]);

  /* ── Speed distribution ──────────────────────────────────── */
  const speedCounts = useMemo(() => {
    const counts = [0, 0, 0, 0];
    filtered.forEach(e => {
      if (e.resolutionMs < SPEED_THRESHOLDS[0].max)      counts[0]++;
      else if (e.resolutionMs < SPEED_THRESHOLDS[1].max) counts[1]++;
      else if (e.resolutionMs < SPEED_THRESHOLDS[2].max) counts[2]++;
      else                                                counts[3]++;
    });
    return counts;
  }, [filtered]);

  /* ── Avg resolution ──────────────────────────────────────── */
  const avgResolution = useMemo(() => {
    if (filtered.length === 0) return '0h';
    const totalMs = filtered.reduce((s, e) => s + e.resolutionMs, 0);
    const avgH = Math.round(totalMs / filtered.length / 3_600_000);
    return avgH >= 24 ? `${Math.round(avgH / 24)}d` : `${avgH}h`;
  }, [filtered]);

  const pageEntries = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  // [BUG FIX] Refresh button now actually re-fetches from the backend.
  const handleRefresh = async () => {
    await fetchData();
    setPage(1);
  };

  // [BUG FIX] Export CSV button — was a no-op (missing onClick).
  // Exports the *currently filtered* audit view as CSV, client-side.
  const handleExport = () => {
    if (filtered.length === 0) {
      showToast('Nothing to export — adjust filters first', 'info');
      return;
    }
    const headers = ['Timestamp', 'Agent', 'Action', 'Ticket ID', 'From Status', 'To Status', 'Resolution (ms)', 'Level', 'Note'];
    const rows = filtered.map(e => [
      e.timestamp, e.agent, e.action, e.ticketId,
      e.fromStatus, e.toStatus, String(e.resolutionMs),
      e.level, e.note,
    ]);
    const filename = `update_history_${new Date().toISOString().slice(0, 10)}.csv`;
    downloadCSV([headers, ...rows], filename);
    showToast(`Exported ${filtered.length} entries`, 'success');
  };

  return (
    <div className="view-container">
      <div className="view-section"><DatePills /></div>

      {/* Banner */}
      <div className="history-banner">
        <div className="history-banner-inner">
          <h2>🕐 Update History</h2>
          {/* [HONESTY FIX] Was claiming "Full audit trail of every ticket status
              change & action" — but entries are reconstructed from current ticket
              state (one entry per ticket), not a real audit log. Backend has
              getUpdateHistory(ticketId, page) that returns the real audit; wire
              that for the per-ticket drill-down later. */}
          <p>Reconstructed view of latest ticket state — one row per ticket in the selected date range</p>
        </div>
        <div className="history-banner-actions">
          <button
            className="btn btn-primary"
            onClick={handleRefresh}
            disabled={isLoading}
          >
            <span className={isLoading ? 'spinning' : ''} aria-hidden="true">🔄</span>
            {' '}Refresh
          </button>
          <button
            className="btn btn-create"
            onClick={handleExport}
            disabled={filtered.length === 0}
          >
            📤 Export CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="history-filters">
        <div className="hf-group">
          <label className="hf-label">🔖 TICKET ID</label>
          <input
            className="form-input"
            placeholder="BF-TKT-2026-..."
            value={filters.ticketId}
            onChange={e => { setFilters(f => ({ ...f, ticketId: e.target.value })); setPage(1); }}
          />
        </div>
        <div className="hf-group">
          <label className="hf-label">👤 AGENT / USER</label>
          <input
            className="form-input"
            placeholder="Name or email..."
            value={filters.agent}
            onChange={e => { setFilters(f => ({ ...f, agent: e.target.value })); setPage(1); }}
          />
        </div>
        <div className="hf-group">
          <label className="hf-label">ACTION TYPE</label>
          <select className="form-input" value={filters.actionType} onChange={e => { setFilters(f => ({ ...f, actionType: e.target.value })); setPage(1); }}>
            <option value="all">All Actions</option>
            <option value="created">Created</option>
            <option value="updated">Updated</option>
          </select>
        </div>
        <div className="hf-group">
          <label className="hf-label">SEVERITY</label>
          <select className="form-input" value={filters.severity} onChange={e => { setFilters(f => ({ ...f, severity: e.target.value })); setPage(1); }}>
            <option value="all">All Levels</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>
        </div>
        <button className="btn btn-ghost" onClick={() => { setFilters({ ticketId: '', agent: '', actionType: 'all', severity: 'all' }); setPage(1); }}>✕ Clear</button>
      </div>

      {/* Stats bar */}
      <div className="history-stats-bar">
        <div className="hs-box"><span className="hs-label">Total Records</span><span className="hs-val">{filtered.length}</span></div>
        <div className="hs-box"><span className="hs-label">Page</span><span className="hs-val">{page} / {totalPages || 1}</span></div>
      </div>

      {/* Avg resolution + speed badges */}
      <div className="history-speed-row">
        <div className="speed-avg">
          <span className="speed-avg-icon">⚡</span>
          <div><span className="speed-avg-label">AVG RESOLUTION TIME</span><span className="speed-avg-val">{avgResolution}</span></div>
        </div>
        {SPEED_THRESHOLDS.map((t, i) => (
          <div key={t.label} className="speed-badge" style={{ background: t.bg, borderColor: t.color }}>
            <span style={{ color: t.color, fontWeight: 800, fontSize: '1.3rem' }}>{speedCounts[i]}</span>
            <span style={{ fontSize: '0.65rem', color: t.color, fontWeight: 600 }}>{t.label}</span>
          </div>
        ))}
      </div>

      {/* Audit table */}
      <div className="view-section">
        <div className="ticket-table-scroll">
          <table className="ticket-table history-table">
            <thead>
              <tr>
                <th>⏰ TIMESTAMP</th>
                <th>👤 AGENT</th>
                <th>⚡ ACTION</th>
                <th>🔖 TICKET ID ↕</th>
                <th>FROM STATUS</th>
                <th>TO STATUS</th>
                <th>RESOLUTION</th>
                <th>⚡ LEVEL</th>
                <th>NOTE</th>
              </tr>
            </thead>
            <tbody>
              {pageEntries.length === 0 ? (
                <tr><td colSpan={9} className="text-center text-muted">No records found</td></tr>
              ) : pageEntries.map((e, i) => (
                <tr
                  key={`${e.ticketId}-${i}`}
                  onClick={() => openModal('ticketAudit', e.ticketId)}
                  style={{ cursor: 'pointer' }}
                  title="Click to view full audit trail for this ticket"
                >
                  <td className="text-muted" style={{ fontSize: '0.8rem' }}>{e.timestamp}</td>
                  <td>{e.agent}</td>
                  <td><span className={`action-chip action-${e.action.toLowerCase()}`}>📝 {e.action}</span></td>
                  <td className="td-id">{e.ticketId}</td>
                  <td><span className="status-badge status-not-completed">🔴 {e.fromStatus}</span></td>
                  <td><span className={`status-badge status-${e.toStatus.toLowerCase().replace(/[' ]/g, '-')}`}>
                    {e.toStatus === 'Completed' ? '✅' : e.toStatus === 'Closed' ? '📦' : '🔴'} {e.toStatus}
                  </span></td>
                  <td>{e.resolutionMs > 0 ? (e.resolutionMs >= 86_400_000 ? `${Math.round(e.resolutionMs / 86_400_000)}d` : `${Math.round(e.resolutionMs / 3_600_000)}h`) : '—'}</td>
                  <td><span className={`level-badge level-${e.level}`}>■</span></td>
                  <td style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination current={page} total={filtered.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </div>
    </div>
  );
}
