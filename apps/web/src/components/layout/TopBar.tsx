import { Plus, RefreshCw, LogOut } from 'lucide-react';
import { useUiStore, useAuthStore } from '@billfree/app-state';
import { useTicketStore, useTickets } from '@billfree/feature-tickets';
import { BACKEND } from '@billfree/api';

export default function TopBar() {
  const openModal     = useUiStore(s => s.openModal);
  const isLoading     = useTicketStore(s => s.isLoading);
  const version       = useTicketStore(s => s.version);
  const totalTickets  = useTicketStore(s => s.rawData.length);
  const { fetchData } = useTickets();
  const user          = useAuthStore(s => s.user);
  const logout        = useAuthStore(s => s.logout);

  return (
    <header className="header" role="banner">
      <div className="page-title">
        <h1>IT Command Center</h1>
        <p className="header-subtitle">
          {/* [UX] Replaces marketing copy with live data signal — version
              monotonically bumps on every backend write so users see the
              dashboard is fresh. */}
          <span className="live-dot" aria-hidden="true">●</span>
          {' '}Live · {totalTickets.toLocaleString()} tickets · v{version}
        </p>
      </div>
      <div className="header-actions">
        {/* [REMOVED] dead Notifications + Keyboard-Shortcuts buttons (no onClick).
            Re-introduce with real handlers when the features land. */}
        <button
          id="header-create-ticket-btn"
          className="btn btn-create"
          onClick={() => openModal('createTicket')}
        >
          <Plus size={16} strokeWidth={2.5} aria-hidden="true" />
          Create Ticket
        </button>
        <button
          id="header-refresh-btn"
          className="btn btn-primary"
          onClick={() => fetchData()}
          disabled={isLoading}
          title="Refresh ticket data"
        >
          <span className={isLoading ? 'spinning' : ''} aria-hidden="true">
            <RefreshCw size={15} strokeWidth={2.4} />
          </span>
          Refresh
        </button>
        {/* Gateway (JWT) mode shows the signed-in identity + a sign-out control. */}
        {BACKEND === 'gateway' && user && (
          <button
            className="btn btn-ghost"
            onClick={() => logout()}
            title={`Signed in as ${user.email} (${user.role})`}
          >
            <LogOut size={15} strokeWidth={2.2} aria-hidden="true" />
            Sign out · {user.name}
          </button>
        )}
      </div>
    </header>
  );
}
