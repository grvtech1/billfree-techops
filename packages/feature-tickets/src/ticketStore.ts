import { create } from 'zustand';
import type { Ticket, DateRange, MasterFilter, KpiData, RawTicket } from '@billfree/web-core';
import { eff, computeKPIs, computeAgentStats, normaliseTicket, canonicalAgentKey, DEFAULT_PAGE_SIZE } from '@billfree/web-core';

interface TicketState {
  rawData:      Ticket[];
  dateData:     Ticket[];
  displayData:  Ticket[];
  version:      number;
  dateRange:    DateRange;
  masterFilter: MasterFilter;
  isLoading:    boolean;
  kpi:          KpiData;

  setRawData:      (tickets: RawTicket[], version: number) => void;
  setDateRange:    (r: DateRange) => void;
  setMasterFilter: (f: Partial<MasterFilter>) => void;
  applyFilters:    () => void;
  optimisticUpdate:(id: string, patch: Partial<Ticket>) => Ticket[];  // returns snapshot
  rollback:        (snapshot: Ticket[]) => void;
}

const EMPTY_KPI: KpiData = {
  total: 0, notCompleted: 0, inProgress: 0, pending: 0,
  completed: 0, closed: 0, cantDo: 0, agingCount: 0,
};

export const useTicketStore = create<TicketState>((set, get) => ({
  rawData:     [],
  dateData:    [],
  displayData: [],
  version:     0,
  dateRange:   { type: 'all' },
  masterFilter: {
    query: '', agent: 'all', status: 'all',
    supportType: 'all', page: 1, pageSize: DEFAULT_PAGE_SIZE,
  },
  isLoading:   false,
  kpi:         EMPTY_KPI,

  setRawData: (rawTickets, version) => {
    const tickets = rawTickets.map(normaliseTicket);
    set({ rawData: tickets, version });
    get().applyFilters();
  },

  setDateRange: (r) => {
    set({ dateRange: r });
    get().applyFilters();
  },

  setMasterFilter: (f) => {
    set(s => ({
      masterFilter: { ...s.masterFilter, ...f, page: 1 },
    }));
    get().applyFilters();
  },

  applyFilters: () => {
    const { rawData, dateRange, masterFilter } = get();
    const now        = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    // ── Date filter ──────────────────────────────────────────
    let dateData: Ticket[];
    switch (dateRange.type) {
      case 'today':
        dateData = rawData.filter(t => eff(t) >= todayStart);
        break;
      case 'yesterday':
        dateData = rawData.filter(t => eff(t) >= todayStart - 864e5 && eff(t) < todayStart);
        break;
      case '7days':
        dateData = rawData.filter(t => eff(t) >= todayStart - 7 * 864e5);
        break;
      case '30days':
        dateData = rawData.filter(t => eff(t) >= todayStart - 30 * 864e5);
        break;
      case 'custom':
        dateData = rawData.filter(t =>
          (!dateRange.start || eff(t) >= dateRange.start) &&
          (!dateRange.end   || eff(t) <= dateRange.end)
        );
        break;
      default:
        dateData = rawData.slice(); // shallow copy to prevent shared reference
    }

    // ── Master search / agent / status / supportType filter ──
    const { query, agent, status, supportType } = masterFilter;
    const q = query.toLowerCase().trim();

    const targetAgentKey = agent === 'all' ? '' : canonicalAgentKey(agent);

    const displayData = dateData.filter(t =>
      (!q ||
        [t.id, t.business, t.mid, t.concern, t.requestedBy, t.agent]
          .join(' ')
          .toLowerCase()
          .includes(q)
      ) &&
      (agent === 'all' ||
        canonicalAgentKey(t.email) === targetAgentKey ||
        canonicalAgentKey(t.agent) === targetAgentKey) &&
      (status === 'all' || t.status === status) &&
      (supportType === 'all' || t.supportType === supportType)
    );

    set({ dateData, displayData, kpi: computeKPIs(dateData) });
  },

  optimisticUpdate: (id, patch) => {
    const snapshot = get().rawData;
    set(s => ({
      rawData: s.rawData.map(t => t.id === id ? { ...t, ...patch } : t),
    }));
    get().applyFilters();
    return snapshot;
  },

  rollback: (snapshot) => {
    set({ rawData: snapshot });
    get().applyFilters();
  },
}));

// Selector helpers (avoid re-render on unrelated store changes)
export const selectAgentStats = (s: TicketState) => computeAgentStats(s.dateData);
export const selectKpi        = (s: TicketState) => s.kpi;
