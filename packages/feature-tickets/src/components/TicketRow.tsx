import { useState } from 'react';
import type { Ticket } from '@billfree/web-core';
import { StatusBadge, AgeBadge, ChannelBadge } from '@billfree/ui';
import { useUiStore } from '@billfree/app-state';
import StatusDropdown from './StatusDropdown';
import PosCell from './PosCell';

interface Props {
  ticket: Ticket;
}

export default function TicketRow({ ticket }: Props) {
  const [showStatusDd, setShowStatusDd] = useState(false);
  const openModal = useUiStore(s => s.openModal);

  // Shorten reason for the "Follow-up" column
  const followUp = ticket.reason
    ? ticket.reason.length > 40 ? ticket.reason.slice(0, 40) + '…' : ticket.reason
    : '—';

  return (
    <tr
      className={`ticket-row ticket-row-${ticket.ageCategory}`}
      data-ticket-id={ticket.id}
    >
      {/* Ticket ID + origin channel */}
      <td className="td-id">
        <button
          className="ticket-id-link"
          onClick={() => openModal('updateTicket', ticket)}
          title="Open ticket details"
        >
          {ticket.id}
        </button>
        <ChannelBadge source={ticket.source} />
      </td>

      {/* Date */}
      <td className="td-date">{ticket.date}</td>

      {/* Age */}
      <td className="td-age">
        <AgeBadge ageDays={ticket.ageDays} ageCategory={ticket.ageCategory} />
      </td>

      {/* Agent */}
      <td className="td-agent">{ticket.agent}</td>

      {/* Business */}
      <td className="td-business">{ticket.business}</td>

      {/* MID */}
      <td className="td-mid">{ticket.mid || '—'}</td>

      {/* POS (inline edit) */}
      <td className="td-pos">
        <PosCell ticket={ticket} />
      </td>

      {/* Phone */}
      <td className="td-phone">{ticket.phone || '—'}</td>

      {/* Concern */}
      <td className="td-concern">
        <span className="concern-text" title={ticket.concern}>
          {ticket.concern.length > 30
            ? ticket.concern.slice(0, 30) + '…'
            : ticket.concern}
        </span>
      </td>

      {/* Status (click to open dropdown) */}
      <td className="td-status">
        <div className="status-cell">
          <button
            className="status-cell-btn"
            onClick={() => setShowStatusDd(v => !v)}
            aria-haspopup="listbox"
            aria-expanded={showStatusDd}
          >
            <StatusBadge status={ticket.status} size="sm" />
          </button>
          {showStatusDd && (
            <>
              <div
                className="status-dd-backdrop"
                onClick={() => setShowStatusDd(false)}
                aria-hidden="true"
              />
              <StatusDropdown
                ticket={ticket}
                onClose={() => setShowStatusDd(false)}
              />
            </>
          )}
        </div>
      </td>

      {/* Follow-up */}
      <td className="td-followup" title={ticket.reason || ''}>
        <span className="text-muted" style={{ fontSize: '0.75rem' }}>{followUp}</span>
      </td>

      {/* Actions — styled "Update" button matching legacy */}
      <td className="td-actions">
        <button
          className="btn btn-update"
          onClick={() => openModal('updateTicket', ticket)}
          aria-label={`Update ticket ${ticket.id}`}
        >
          📝Update
        </button>
      </td>
    </tr>
  );
}
