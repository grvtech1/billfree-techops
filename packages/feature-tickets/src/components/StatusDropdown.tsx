import { useState } from 'react';
import type { Ticket, Status } from '@billfree/web-core';
import { STATUS_ENUM } from '@billfree/web-core';
import { api } from '@billfree/api';
import { useAuthStore, useUiStore, useCSRF } from '@billfree/app-state';
import { StatusBadge } from '@billfree/ui';
import { useTicketStore } from '../ticketStore';

interface Props {
  ticket:  Ticket;
  onClose: () => void;
}

export default function StatusDropdown({ ticket, onClose }: Props) {
  const { user }     = useAuthStore();
  const showToast    = useUiStore(s => s.showToast);
  const { withCSRF } = useCSRF();
  const { optimisticUpdate, rollback } = useTicketStore();
  const [busy, setBusy] = useState(false);

  const canClose  = user?.isAdmin ?? false;
  const allStatus = Object.values(STATUS_ENUM) as Status[];

  const handleChange = async (newStatus: Status) => {
    if (newStatus === ticket.status || !user) return;
    setBusy(true);

    const snapshot = optimisticUpdate(ticket.id, { status: newStatus });
    onClose();

    try {
      await withCSRF(csrf =>
        api.updateStatus({
          ticketId:  ticket.id,
          newStatus,
          csrfToken: csrf,
          token:     user.token,
        })
      );
      showToast(`Status updated → ${newStatus}`, 'success');
    } catch (e: unknown) {
      rollback(snapshot);
      showToast(e instanceof Error ? e.message : 'Update failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="status-dropdown-popover" role="listbox" aria-label="Select status">
      {allStatus.map(s => {
        const isDisabled = s === 'Closed' && !canClose;
        const isCurrent  = s === ticket.status;
        return (
          <button
            key={s}
            className={`status-dropdown-item ${isCurrent ? 'active' : ''} ${isDisabled ? 'disabled' : ''}`}
            onClick={() => !isDisabled && !isCurrent && !busy && handleChange(s)}
            aria-selected={isCurrent}
            aria-disabled={isDisabled}
            disabled={isDisabled || busy}
            role="option"
            title={isDisabled ? 'Admin only' : undefined}
          >
            <StatusBadge status={s} size="sm" />
            {isCurrent && <span className="status-dropdown-check" aria-hidden="true">✓</span>}
            {isDisabled && <span className="status-dropdown-lock" aria-hidden="true">🔒</span>}
          </button>
        );
      })}
    </div>
  );
}
