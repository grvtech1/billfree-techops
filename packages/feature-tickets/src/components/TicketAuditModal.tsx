import { useEffect, useState } from 'react';
import type { AuditLogEntry, AuditLogResponse } from '@billfree/web-core';
import { api } from '@billfree/api';
import { useAuthStore, useUiStore } from '@billfree/app-state';
import { Modal, Pagination } from '@billfree/ui';

interface Props {
  isOpen:   boolean;
  ticketId: string | null;
  onClose:  () => void;
}

const PAGE_SIZE = 20;

const SEVERITY_COLOR: Record<string, string> = {
  INFO:     '#3B82F6',
  WARN:     '#F59E0B',
  ERROR:    '#EF4444',
  CRITICAL: '#DC2626',
};

const DURATION_COLOR: Record<string, { bg: string; fg: string }> = {
  fast:     { bg: '#ECFDF5', fg: '#065F46' },
  normal:   { bg: '#EFF6FF', fg: '#1E3A8A' },
  slow:     { bg: '#FFFBEB', fg: '#92400E' },
  critical: { bg: '#FEF2F2', fg: '#991B1B' },
};

/**
 * Drill-down audit modal.
 * Calls the real backend `getUpdateHistory` endpoint with `filters.ticketId`.
 * Returns the raw audit log rows the legacy HistoryView never showed —
 * timestamps, who-changed-what, real status transitions, durations.
 */
export default function TicketAuditModal({ isOpen, ticketId, onClose }: Props) {
  const { user }  = useAuthStore();
  const showToast = useUiStore(s => s.showToast);

  const [page,    setPage]    = useState(1);
  const [data,    setData]    = useState<AuditLogResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !ticketId || !user) return;
    let cancelled = false;
    setLoading(true);
    setData(null);
    api.updateHistory({ ticketId, page, pageSize: PAGE_SIZE, token: user.token })
      .then(res => { if (!cancelled) setData(res); })
      .catch(e => {
        if (!cancelled) {
          showToast(e instanceof Error ? e.message : 'Failed to load audit log', 'error');
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, ticketId, page, user]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset page when ticket changes
  useEffect(() => { setPage(1); }, [ticketId]);

  if (!isOpen || !ticketId) return null;

  const entries = data?.data ?? [];
  const total   = data?.pagination?.totalRows ?? 0;
  const stats   = data?.durationStats;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`📜 Audit Trail — ${ticketId}`}
      maxWidth="900px"
      id="ticket-audit-modal"
    >
      {/* ── Duration stats banner ─────────────────────────── */}
      {stats && stats.totalWithDuration > 0 && (
        <div
          className="audit-stats-row"
          style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}
        >
          <StatChip label="Avg Resolution" value={`${stats.avgHours}h`} color="#1E3A8A" bg="#EFF6FF" />
          <StatChip label="Fast"     value={String(stats.fastCount)}     color={DURATION_COLOR.fast.fg}     bg={DURATION_COLOR.fast.bg} />
          <StatChip label="Normal"   value={String(stats.normalCount)}   color={DURATION_COLOR.normal.fg}   bg={DURATION_COLOR.normal.bg} />
          <StatChip label="Slow"     value={String(stats.slowCount)}     color={DURATION_COLOR.slow.fg}     bg={DURATION_COLOR.slow.bg} />
          <StatChip label="Critical" value={String(stats.criticalCount)} color={DURATION_COLOR.critical.fg} bg={DURATION_COLOR.critical.bg} />
        </div>
      )}

      {/* ── Body ──────────────────────────────────────────── */}
      {loading && (
        <div className="view-skeleton" aria-busy="true" style={{ padding: 16 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton skeleton-card" style={{ height: 40 }} />
          ))}
        </div>
      )}

      {!loading && entries.length === 0 && (
        <div className="empty-state" style={{ padding: 32, textAlign: 'center' }}>
          <div className="empty-state-icon" aria-hidden="true">📭</div>
          <h3>No audit entries</h3>
          <p>{data?.message || 'This ticket has no recorded status changes yet.'}</p>
        </div>
      )}

      {!loading && entries.length > 0 && (
        <>
          <div className="ticket-table-scroll" role="region" aria-label="Audit entries">
            <table className="ticket-table" style={{ fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Duration</th>
                  <th>Reason</th>
                  <th>Severity</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(e => (
                  <AuditRow key={`${e.rowNum}-${e.timestampMs}`} entry={e} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <Pagination
            current={page}
            total={total}
            pageSize={PAGE_SIZE}
            onChange={setPage}
          />
        </>
      )}
    </Modal>
  );
}

/* ── Sub-components ────────────────────────────────────────── */
function StatChip({
  label, value, color, bg,
}: { label: string; value: string; color: string; bg: string }) {
  return (
    <div
      className="stat-chip"
      style={{
        background: bg, color, padding: '6px 12px',
        borderRadius: 8, fontSize: '0.78rem', fontWeight: 600,
        display: 'flex', alignItems: 'center', gap: 6,
      }}
    >
      <span style={{ opacity: 0.85 }}>{label}:</span>
      <strong>{value}</strong>
    </div>
  );
}

function AuditRow({ entry }: { entry: AuditLogEntry }) {
  const sev = SEVERITY_COLOR[entry.severity] || '#64748B';
  const dur = entry.durationCategory ? DURATION_COLOR[entry.durationCategory] : null;

  // Friendly action labels
  const actionLabel = entry.action === 'TICKET_UPDATED'
    ? '✏️ Updated'
    : entry.action === 'CLOSE_ATTEMPT_DENIED'
      ? '🚫 Close Denied'
      : entry.action;

  return (
    <tr>
      <td className="text-muted" style={{ whiteSpace: 'nowrap', fontSize: '0.78rem' }}>
        {entry.timestamp}
      </td>
      <td>{entry.user}</td>
      <td>{actionLabel}</td>
      <td><span className="status-badge status-badge-sm">{entry.previousStatus || '—'}</span></td>
      <td><span className="status-badge status-badge-sm">{entry.newStatus || '—'}</span></td>
      <td>
        {entry.duration && dur ? (
          <span
            style={{
              background: dur.bg, color: dur.fg,
              padding: '2px 8px', borderRadius: 6,
              fontWeight: 600, fontSize: '0.75rem',
            }}
          >
            {entry.duration}
          </span>
        ) : <span className="text-muted">—</span>}
      </td>
      <td>{entry.reasonAdded === 'Yes' ? '📝' : '—'}</td>
      <td>
        <span style={{ color: sev, fontWeight: 600 }}>{entry.severity}</span>
      </td>
    </tr>
  );
}
