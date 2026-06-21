import { lazy, Suspense } from 'react';
import { useUiStore } from '../../store/uiStore';
import type { Ticket } from '../../types';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import ToastContainer from '../common/Toast';
import CreateTicketModal from '../tickets/CreateTicketModal';
import UpdateTicketModal from '../tickets/UpdateTicketModal';
import TicketAuditModal from '../tickets/TicketAuditModal';

// Lazy-load heavy views
const DashboardView      = lazy(() => import('../../views/DashboardView'));
const MasterDbView       = lazy(() => import('../../views/MasterDbView'));
const TeamReportView     = lazy(() => import('../../views/TeamReportView'));
const AnalyticsView      = lazy(() => import('../../views/AnalyticsView'));
const HistoryView        = lazy(() => import('../../views/HistoryView'));
const CallLogView        = lazy(() => import('../../views/CallLogView'));
const MonthlyReportView  = lazy(() => import('../../views/MonthlyReportView'));

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
  const activeView = useUiStore(s => s.activeView);
  const modal      = useUiStore(s => s.modal);
  const closeModal = useUiStore(s => s.closeModal);

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main-wrapper">
        <TopBar />
        <main className="main-content" id="main-content">
          <Suspense fallback={<ViewSkeleton />}>
            {/* All views rendered; visibility toggled via CSS to preserve state */}
            <div className={activeView === 'dashboard' ? 'view-active' : 'view-hidden'}>
              <DashboardView />
            </div>
            <div className={activeView === 'master' ? 'view-active' : 'view-hidden'}>
              <MasterDbView />
            </div>
            <div className={activeView === 'team' ? 'view-active' : 'view-hidden'}>
              <TeamReportView />
            </div>
            <div className={activeView === 'analytics' ? 'view-active' : 'view-hidden'}>
              <AnalyticsView />
            </div>
            <div className={activeView === 'history' ? 'view-active' : 'view-hidden'}>
              <HistoryView />
            </div>
            <div className={activeView === 'calllog' ? 'view-active' : 'view-hidden'}>
              <CallLogView />
            </div>
            <div className={activeView === 'monthlyreport' ? 'view-active' : 'view-hidden'}>
              <MonthlyReportView />
            </div>
          </Suspense>
        </main>
      </div>

      {/* Global Modals */}
      <CreateTicketModal
        isOpen={modal.type === 'createTicket'}
        onClose={closeModal}
      />
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
