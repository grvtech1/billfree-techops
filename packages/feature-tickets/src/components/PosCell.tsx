import { useState, useRef, useEffect } from 'react';
import type { Ticket } from '@billfree/web-core';
import { api } from '@billfree/api';
import { useAuthStore, useUiStore, useCSRF } from '@billfree/app-state';
import { useTicketStore } from '../ticketStore';

interface Props {
  ticket: Ticket;
}

/**
 * PosCell — inline double-click edit.
 * - Double-click activates an <input>
 * - Enter or blur commits the change
 * - Escape cancels without saving
 * - Optimistic update with rollback on error
 */
export default function PosCell({ ticket }: Props) {
  const { user }      = useAuthStore();
  const showToast     = useUiStore(s => s.showToast);
  const { withCSRF }  = useCSRF();
  const { optimisticUpdate, rollback } = useTicketStore();

  const [editing, setEditing] = useState(false);
  const [value,   setValue]   = useState(ticket.pos);
  const inputRef              = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  // Keep value in sync if parent data refreshes
  useEffect(() => setValue(ticket.pos), [ticket.pos]);

  const commit = async () => {
    setEditing(false);
    const newPos = value.trim();
    if (!newPos || newPos === ticket.pos || !user) return;

    const snapshot = optimisticUpdate(ticket.id, { pos: newPos });

    try {
      await withCSRF(csrf =>
        api.updatePOS({
          ticketId:  ticket.id,
          pos:       newPos,
          csrfToken: csrf,
          token:     user.token,
        })
      );
    } catch (e: unknown) {
      setValue(ticket.pos);
      rollback(snapshot);
      showToast(e instanceof Error ? e.message : 'POS update failed', 'error');
    }
  };

  const cancel = () => {
    setValue(ticket.pos);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="pos-cell-input"
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') cancel();
        }}
        aria-label="Edit POS system"
        maxLength={60}
      />
    );
  }

  return (
    <span
      className="pos-cell"
      onDoubleClick={() => setEditing(true)}
      title="Double-click to edit POS"
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter') setEditing(true); }}
      aria-label={`POS: ${ticket.pos || 'None'}. Double-click to edit.`}
    >
      {ticket.pos || <em className="pos-cell-empty">—</em>}
      <span className="pos-cell-hint" aria-hidden="true">✏️</span>
    </span>
  );
}
