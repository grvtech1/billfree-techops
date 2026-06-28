import { lazy, Suspense, type ComponentType } from 'react';
import type { Ticket } from '@billfree/web-core';
import { useUiStore } from '@billfree/app-state';
import { CreateTicketModal, UpdateTicketModal, TicketAuditModal } from '@billfree/feature-tickets';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import ToastContainer from '../common/Toast';
import ErrorBoundary from '../common/ErrorBoundary';

// Lazy-load heavy views from their feature packages (named exports → { default }).
const DashboardView = lazy(() =>
  import('@billfree/feature-tickets').then((m) => ({ default: m.DashboardView })),
);
const MasterDbView = lazy(() =>
  import('@billfree/feature-tickets').then((m) => ({ default: m.MasterDbView })),
);
const TeamReportView = lazy(() =>
  import('@billfree/feature-tickets').then((m) => ({ default: m.TeamReportView })),
);
const AnalyticsView = lazy(() =>
  import('@billfree/feature-tickets').then((m) => ({ default: m.AnalyticsView })),
);
const HistoryView = lazy(() =>
  import('@billfree/feature-tickets').then((m) => ({ default: m.HistoryView })),
);
const CallLogView = lazy(() =>
  import('@billfree/feature-calllog').then((m) => ({ default: m.CallLogView })),
);
const MonthlyReportView = lazy(() =>
  import('@billfree/feature-reports').then((m) => ({ default: m.MonthlyReportView })),
);
const SettingsView = lazy(() =>
  import('@billfree/feature-tickets').then((m) => ({ default: m.SettingsView })),
);

// View registry — only the active view is mounted (see below), so its hooks and
// useMemo chains run only when visible. Cross-view state that must survive
// navigation (filters, pagination) lives in the Zustand stores, not component
// state, so conditional mounting does not lose it.
const VIEWS: Record<string, ComponentType> = {
  dashboard: DashboardView,
  master: MasterDbView,
  team: TeamReportView,
  analytics: AnalyticsView,
  history: HistoryView,
  calllog: CallLogView,
  monthlyreport: MonthlyReportView,
  settings: SettingsView,
};

function ViewSkeleton() {
  return (
    <div className="view-skeleton" aria-busy="true" aria-label="Loading view">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="skeleton skeleton-card" />
      ))}
    </div>
  );
}

export default function AppShell() {
  const activeView = useUiStore((s) => s.activeView);
  const modal = useUiStore((s) => s.modal);
  const closeModal = useUiStore((s) => s.closeModal);

  const ActiveView = VIEWS[activeView] ?? DashboardView;

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main-wrapper">
        <TopBar />
        <main className="main-content" id="main-content">
          {/* Only the active view is mounted — lazy chunks load on demand and a
              crash in one view is isolated (and recovers when you navigate away,
              via the resetKey). */}
          <ErrorBoundary resetKey={activeView}>
            <Suspense fallback={<ViewSkeleton />}>
              <ActiveView key={activeView} />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>

      {/* Global Modals */}
      <CreateTicketModal isOpen={modal.type === 'createTicket'} onClose={closeModal} />
      <UpdateTicketModal
        isOpen={modal.type === 'updateTicket'}
        ticket={(modal.data ?? null) as Ticket | null}
        onClose={closeModal}
      />
      <TicketAuditModal
        isOpen={modal.type === 'ticketAudit'}
        ticketId={typeof modal.data === 'string' ? modal.data : null}
        onClose={closeModal}
      />

      {/* Toast stack */}
      <ToastContainer />
    </div>
  );
}
