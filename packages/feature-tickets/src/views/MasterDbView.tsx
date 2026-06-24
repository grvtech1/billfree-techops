import type { Ticket } from '@billfree/web-core';
import { downloadCSV } from '@billfree/web-core';
import { api } from '@billfree/api';
import { useAuthStore, useUiStore, useCSRF } from '@billfree/app-state';
import { useTicketStore } from '../ticketStore';
import DatePills from '../filters/DatePills';
import MasterSearch from '../filters/MasterSearch';
import TicketTable from '../components/TicketTable';

export default function MasterDbView() {
  const displayData  = useTicketStore(s => s.displayData);
  const masterFilter = useTicketStore(s => s.masterFilter);
  const isLoading    = useTicketStore(s => s.isLoading);
  const { user }     = useAuthStore();
  const showToast    = useUiStore(s => s.showToast);
  const { withCSRF } = useCSRF();

  const handleExport = async () => {
    if (!user) return;
    try {
      const result = await withCSRF(csrf =>
        api.exportTickets(masterFilter, csrf, user.token)
      );
      if (result.csv) {
        const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8;' });
        const url  = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'tickets_export.csv'; a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      // Fallback: client-side CSV from displayData
      const headers = ['Ticket ID','Date','Agent','MID','Business','POS','Type','Concern','Status','Age (days)'];
      const rows    = displayData.map((t: Ticket) => [
        t.id, t.date, t.agent, t.mid, t.business, t.pos,
        t.supportType, t.concern, t.status, String(t.ageDays),
      ]);
      downloadCSV([headers, ...rows], `tickets_${new Date().toISOString().slice(0,10)}.csv`);
      showToast('Exported from local data', 'info');
    }
  };

  return (
    <div className="view-container">
      {/* Filters row */}
      <div className="view-section">
        <div className="filters-row">
          <DatePills />
        </div>
        <div className="filters-row mt-2">
          <MasterSearch />
          <button
            id="master-db-export-btn"
            className="btn btn-ghost ml-auto"
            onClick={handleExport}
            disabled={displayData.length === 0}
            title="Export visible tickets as CSV"
          >
            ⬇ Export CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="view-section">
        <div className="section-header">
          <h2 className="section-title">
            All Tickets
            {isLoading && <span className="loading-dot" aria-hidden="true" />}
          </h2>
          <span className="section-count">{displayData.length} results</span>
        </div>
        <TicketTable tickets={displayData} showFilter />
      </div>
    </div>
  );
}
