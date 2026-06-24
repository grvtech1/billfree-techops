import { useState, useEffect } from 'react';
import type { Ticket, Status } from '@billfree/web-core';
import { STATUS_ENUM, appendToReason, parseReasonTimestamps } from '@billfree/web-core';
import { api } from '@billfree/api';
import { useAuthStore, useUiStore, useCSRF } from '@billfree/app-state';
import { Modal, StatusBadge, ChannelBadge } from '@billfree/ui';
import { useTicketStore } from '../ticketStore';
import { useTickets } from '../hooks/useTickets';

interface Props {
  isOpen:  boolean;
  onClose: () => void;
  ticket:  Ticket | null;
}

const STATUS_ICONS: Record<string, string> = {
  'Not Completed': '🔴',
  'Pending': '🟡',
  'In Progress': '🔵',
  'Completed': '✅',
  'Closed': '📦',
  "Can't Do": '🚫',
};

export default function UpdateTicketModal({ isOpen, onClose, ticket }: Props) {
  const { user }     = useAuthStore();
  const showToast    = useUiStore(s => s.showToast);
  const { withCSRF } = useCSRF();
  const { fetchData } = useTickets();
  const { optimisticUpdate, rollback } = useTicketStore();

  const [status,    setStatus]    = useState<Status>('Not Completed');
  const [reason,    setReason]    = useState('');
  const [busy,      setBusy]      = useState(false);
  const [warning,   setWarning]   = useState('');

  // [BUG FIX] Reset form when ticket changes — was useMemo (a side-effect inside
  // a memo runs during render, causing setState-during-render warnings + extra
  // renders). Side-effects belong in useEffect.
  useEffect(() => {
    if (ticket) {
      setStatus(ticket.status);
      setReason('');
      setWarning('');
    }
    // Intentionally key on ticket IDENTITY only: re-running on every `ticket`
    // object reference would reset the form mid-edit on optimistic updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket?.id]);

  if (!ticket || !isOpen) return null;

  const isAdmin  = user?.isAdmin ?? false;
  const allStatus = Object.values(STATUS_ENUM) as Status[];

  // Client-side closure pre-check (server validates authoritatively)
  const checkClosurePreConditions = (): string => {
    if (status !== 'Closed') return '';
    const existing = parseReasonTimestamps(ticket.reason);
    const newTs    = parseReasonTimestamps(appendToReason(ticket.reason, reason));
    if (ticket.ageDays < 7) return '⚠️ Ticket age < 7 days — Closed may be rejected by server.';
    if (existing.length > 0 && newTs.length > 0) {
      const spanDays = (Math.max(...newTs) - Math.min(...existing)) / 864e5;
      if (spanDays < 7) return '⚠️ Update history spans < 7 days — Closed may be rejected.';
    }
    return '';
  };

  const handleStatusChange = (s: Status) => {
    setStatus(s);
    setWarning(s === 'Closed' ? checkClosurePreConditions() : '');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !ticket) return;

    const warn = checkClosurePreConditions();
    setWarning(warn);

    setBusy(true);
    const newReason = reason.trim()
      ? appendToReason(ticket.reason, reason)
      : ticket.reason;

    const snapshot = optimisticUpdate(ticket.id, {
      status,
      reason: newReason,
    });

    try {
      await withCSRF(csrf =>
        api.updateFull({
          ticketId:  ticket.id,
          newStatus: status,
          newReason: reason,   // GAS appends its own timestamp
          csrfToken: csrf,
          token:     user.token,
        })
      );
      showToast('Ticket updated successfully', 'success');
      await fetchData();
      onClose();
    } catch (err: unknown) {
      rollback(snapshot);
      showToast(err instanceof Error ? err.message : 'Update failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="🔄 Update Ticket Status & Reason"
      maxWidth="620px"
      id="update-ticket-modal"
    >
      <form onSubmit={handleSubmit} className="ticket-form" noValidate>
        {/* ── Ticket info header (matching legacy) ──────────── */}
        <div className="update-modal-info">
          <div className="umi-row"><span className="umi-label">Ticket ID:</span> <strong>{ticket.id}</strong></div>
          <div className="umi-row"><span className="umi-label">Business:</span> {ticket.business || '—'}</div>
          <div className="umi-row"><span className="umi-label">Agent:</span> {ticket.agent}</div>
          <div className="umi-row">
            <span className="umi-label">Created via:</span>
            <ChannelBadge source={ticket.source} showDefault />
            {ticket.requestedBy ? <span className="text-muted">· by {ticket.requestedBy}</span> : null}
          </div>
          <div className="umi-row">
            <span className="umi-label">Current Status:</span>
            <StatusBadge status={ticket.status} size="sm" />
          </div>
        </div>

        {/* ── Status dropdown (matching legacy) ────────────── */}
        <div className="form-group">
          <label className="form-label">📋 UPDATE STATUS</label>
          <select
            className="form-input update-status-select"
            value={status}
            onChange={e => handleStatusChange(e.target.value as Status)}
          >
            {allStatus.map(s => {
              const disabled = s === 'Closed' && !isAdmin;
              return (
                <option key={s} value={s} disabled={disabled}>
                  {STATUS_ICONS[s] || ''} {s}{disabled ? ' 🔒' : ''}
                </option>
              );
            })}
          </select>
        </div>

        {/* Warning (client pre-check, not hard block) */}
        {warning && (
          <div className="form-warning" role="alert">{warning}</div>
        )}

        {/* ── Reason / follow-up notes ─────────────────────── */}
        <div className="form-group">
          <label className="form-label" htmlFor="update-reason">
            📝 ADD REASON / FOLLOW-UP NOTES <span className="text-muted" style={{ fontWeight: 400, textTransform: 'none' }}>(OPTIONAL)</span>
          </label>
          <textarea
            id="update-reason"
            className="form-input form-textarea"
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={3}
            placeholder="Optional: Add completion notes or next steps..."
          />
          {ticket.reason && (
            <details className="reason-history">
              <summary className="reason-history-toggle">View previous notes</summary>
              <pre className="reason-history-text">{ticket.reason}</pre>
            </details>
          )}
        </div>

        {/* ── Note banner ──────────────────────────────────── */}
        <div className="update-note-banner">
          <strong>ℹ️ Note:</strong> Both status and reason will be updated together. New reason will be appended with timestamp — previous reasons won&apos;t be deleted.
        </div>

        {/* ── Footer buttons ───────────────────────────────── */}
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            ✕ Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary btn-update-submit"
            id="update-ticket-submit-btn"
            disabled={busy}
          >
            {busy ? '⏳ Saving…' : '📥 Update Status & Save Reason'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
