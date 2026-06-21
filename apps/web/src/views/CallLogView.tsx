import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useAuthStore } from '../lib/auth';
import { useUiStore } from '../store/uiStore';
import { useCSRF } from '../hooks/useCSRF';
import type { CallEvent } from '../types';
import Pagination from '../components/common/Pagination';

const PAGE_SIZE = 25;

export default function CallLogView() {
  const { user }     = useAuthStore();
  const showToast    = useUiStore(s => s.showToast);
  const { withCSRF } = useCSRF();

  const [events,     setEvents]     = useState<CallEvent[]>([]);
  const [totalRows,  setTotalRows]  = useState(0);
  const [page,       setPage]       = useState(1);
  const [loading,    setLoading]    = useState(false);
  const [showLog,    setShowLog]    = useState(false);

  // Log call form state
  const [logForm, setLogForm] = useState({
    ticketId:    '',
    eventType:   'CALL_COMPLETED',
    outcome:     'CONNECTED',
    durationSec: '',
    notes:       '',
  });
  const [logBusy, setLogBusy] = useState(false);

  const loadPage = async (p: number) => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await api.callHistory({ page: p, pageSize: PAGE_SIZE }, user.token);
      setEvents((res.data ?? []) as CallEvent[]);
      setTotalRows(
        (res.pagination as { totalRows?: number } | undefined)?.totalRows ??
          (res.data ?? []).length,
      );
      setPage(p);
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to load call log', 'error');
    } finally {
      setLoading(false);
    }
  };

  // [BUG FIX] Was `useEffect(()=>loadPage(1), [])` — fired once at mount and
  // returned early when `user` was still null, then never retried. Re-fire as
  // soon as the user becomes authenticated so the table populates.
  useEffect(() => {
    if (user) loadPage(1);
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLogBusy(true);
    try {
      await withCSRF(csrf =>
        api.logCallEvent(
          { ...logForm, agentEmail: user.email, agentName: user.name },
          csrf, user.token
        )
      );
      showToast('Call event logged', 'success');
      setShowLog(false);
      loadPage(1);
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Log failed', 'error');
    } finally {
      setLogBusy(false);
    }
  };

  return (
    <div className="view-container">
      <div className="section-header">
        <h2 className="section-title">Call Log</h2>
        <button
          id="call-log-btn"
          className="btn btn-primary"
          onClick={() => setShowLog(v => !v)}
        >
          {showLog ? '✕ Cancel' : '+ Log Call'}
        </button>
      </div>

      {/* Quick log form */}
      {showLog && (
        <div className="view-section call-log-form-wrapper">
          <form onSubmit={handleLogSubmit} className="ticket-form">
            <div className="form-row form-row-3">
              <div className="form-group">
                <label className="form-label" htmlFor="cl-ticket-id">Ticket ID</label>
                <input
                  id="cl-ticket-id"
                  className="form-input"
                  value={logForm.ticketId}
                  onChange={e => setLogForm(f => ({ ...f, ticketId: e.target.value }))}
                  placeholder="BF-TKT-… (optional)"
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="cl-event-type">Event Type</label>
                <select
                  id="cl-event-type"
                  className="form-input"
                  value={logForm.eventType}
                  onChange={e => setLogForm(f => ({ ...f, eventType: e.target.value }))}
                >
                  {['CALL_INITIATED','CALL_COMPLETED','CALL_NO_ANSWER','CALL_FAILED','CALL_DISPOSITION'].map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="cl-outcome">Outcome</label>
                <select
                  id="cl-outcome"
                  className="form-input"
                  value={logForm.outcome}
                  onChange={e => setLogForm(f => ({ ...f, outcome: e.target.value }))}
                >
                  {['CONNECTED','NO_ANSWER','BUSY','SWITCHED_OFF','CALLBACK_REQUESTED','FAILED','OTHER'].map(o => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-row form-row-2">
              <div className="form-group">
                <label className="form-label" htmlFor="cl-duration">Duration (sec)</label>
                <input
                  id="cl-duration"
                  type="number"
                  className="form-input"
                  value={logForm.durationSec}
                  onChange={e => setLogForm(f => ({ ...f, durationSec: e.target.value }))}
                  min="0"
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="cl-notes">Notes</label>
                <input
                  id="cl-notes"
                  className="form-input"
                  value={logForm.notes}
                  onChange={e => setLogForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional notes"
                />
              </div>
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowLog(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={logBusy}>
                {logBusy ? 'Logging…' : 'Log Call'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Events table */}
      <div className="view-section">
        <div className="ticket-table-scroll">
          <table className="ticket-table" aria-label="Call log events">
            <thead>
              <tr>
                <th>Time</th>
                <th>Event ID</th>
                <th>Ticket ID</th>
                <th>Agent</th>
                <th>Event Type</th>
                <th>Outcome</th>
                <th>Duration</th>
                <th>Provider</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center text-muted">Loading…</td></tr>
              ) : events.length === 0 ? (
                <tr><td colSpan={8} className="text-center text-muted">No call events found</td></tr>
              ) : events.map((ev, i) => (
                <tr key={ev.eventId || i}>
                  <td className="text-muted">{ev.timestamp}</td>
                  <td className="td-id">{ev.eventId}</td>
                  <td>{ev.ticketId || '—'}</td>
                  <td>{ev.agentName || ev.agentEmail}</td>
                  <td><span className="support-type-chip">{ev.eventType}</span></td>
                  <td>{ev.outcome}</td>
                  <td>{ev.durationSec > 0 ? `${ev.durationSec}s` : '—'}</td>
                  <td>{ev.provider || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          current={page}
          total={totalRows}
          pageSize={PAGE_SIZE}
          onChange={loadPage}
        />
      </div>
    </div>
  );
}
