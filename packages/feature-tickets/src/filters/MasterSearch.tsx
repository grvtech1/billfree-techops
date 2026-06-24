import { useRef } from 'react';
import { STATUS_LABELS, SUPPORT_TYPES } from '@billfree/web-core';
import { useAuthStore } from '@billfree/app-state';
import { useTicketStore } from '../ticketStore';

export default function MasterSearch() {
  const { masterFilter, setMasterFilter } = useTicketStore();
  const { agents }  = useAuthStore();
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  const handleSearch = (q: string) => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setMasterFilter({ query: q });
    }, 250);
  };

  return (
    <div className="master-search" role="search" aria-label="Filter tickets">
      {/* Free-text search */}
      <input
        id="master-search-input"
        type="search"
        className="form-input search-input"
        defaultValue={masterFilter.query}
        onChange={e => handleSearch(e.target.value)}
        placeholder="Search ID, business, MID, concern…"
        aria-label="Search tickets"
      />

      {/* Agent filter */}
      <select
        id="master-agent-filter"
        className="form-input filter-select"
        value={masterFilter.agent}
        onChange={e => setMasterFilter({ agent: e.target.value })}
        aria-label="Filter by agent"
      >
        <option value="all">All Agents</option>
        {agents.map(a => (
          <option key={a.email} value={a.email}>{a.name}</option>
        ))}
      </select>

      {/* Status filter */}
      <select
        id="master-status-filter"
        className="form-input filter-select"
        value={masterFilter.status}
        onChange={e => setMasterFilter({ status: e.target.value })}
        aria-label="Filter by status"
      >
        <option value="all">All Statuses</option>
        {STATUS_LABELS.map(s => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>

      {/* Support type filter */}
      <select
        id="master-type-filter"
        className="form-input filter-select"
        value={masterFilter.supportType}
        onChange={e => setMasterFilter({ supportType: e.target.value })}
        aria-label="Filter by support type"
      >
        <option value="all">All Types</option>
        {SUPPORT_TYPES.map(t => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>

      {/* Clear all */}
      {(masterFilter.query || masterFilter.agent !== 'all' ||
        masterFilter.status !== 'all' || masterFilter.supportType !== 'all') && (
        <button
          id="master-clear-filters-btn"
          className="btn btn-ghost"
          onClick={() => setMasterFilter({ query: '', agent: 'all', status: 'all', supportType: 'all' })}
          aria-label="Clear all filters"
        >
          Clear ×
        </button>
      )}
    </div>
  );
}
