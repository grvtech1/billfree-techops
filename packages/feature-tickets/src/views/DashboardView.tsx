import { useState, useMemo, useCallback } from 'react';
import { Ticket as TicketIcon, CheckCircle2, Clock, Archive, XCircle } from 'lucide-react';
import type { Ticket } from '@billfree/web-core';
import { KpiCard, AgentCard } from '@billfree/ui';
import { useTicketStore, selectKpi, selectAgentStats } from '../ticketStore';
import DatePills from '../filters/DatePills';
import TicketTable from '../components/TicketTable';

/* ── Legacy filter logic (matches filterTable + filterByAgent exactly) ─────── */
type FilterState = {
  type: 'all' | 'status' | 'agent';
  status: string;
  agent: string | null;
  title: string;
};

const STATUS_TITLE_MAP: Record<string, string> = {
  Total:            '📊 Total Tickets',
  Completed:        '✅ Completed',
  'Not Completed':  '⏳ Not Completed',
  Closed:           '🔒 Closed',
  "Can't Do":       "❌ Can't Do",
  'Invalid Closed': '⚠️ Invalid Closed',
  'Old Pending':    '🕐 Old Pending (>7 days)',
};

function filterTickets(tickets: Ticket[], status: string): Ticket[] {
  if (status === 'Total') return tickets;
  if (status === 'Completed') return tickets.filter(t => t.status.toLowerCase() === 'completed');
  if (status === 'Not Completed') return tickets.filter(t => {
    const s = t.status.toLowerCase();
    return s === 'not completed' || s === 'pending' || s === 'in progress';
  });
  if (status === 'Closed') return tickets.filter(t => t.status.toLowerCase() === 'closed');
  if (status === "Can't Do") return tickets.filter(t => {
    const s = t.status.toLowerCase();
    return s.includes("can't") || s.includes('cant') || s.includes("can't");
  });
  if (status === 'Invalid Closed') return tickets.filter(t => t.invalidClosed);
  if (status === 'Old Pending') return tickets.filter(t => {
    const s = t.status.toLowerCase();
    return t.ageDays >= 7 && s !== 'completed' && s !== 'closed';
  });
  return tickets;
}

export default function DashboardView() {
  const kpi        = useTicketStore(selectKpi);
  const agentStats = useTicketStore(selectAgentStats);
  const dateData   = useTicketStore(s => s.dateData);

  const [filter, setFilter] = useState<FilterState>({
    type: 'all', status: 'Total', agent: null, title: '📊 Total Tickets',
  });

  // ── KPI card click → filter table in-place (matches legacy filterTable) ──
  const handleKpiClick = useCallback((status: string) => {
    setFilter({
      type: 'status',
      status,
      agent: null,
      title: STATUS_TITLE_MAP[status] || status,
    });
  }, []);

  // ── Agent stat button click → filter by agent + status ──
  const handleAgentFilter = useCallback((agent: string, status: string) => {
    setFilter({
      type: 'agent',
      status,
      agent,
      title: `${agent} • ${status}`,
    });
  }, []);

  // ── Compute displayed tickets (matches legacy filterTable + filterByAgent) ──
  const displayedTickets = useMemo(() => {
    let base = dateData;
    if (filter.type === 'agent' && filter.agent) {
      base = dateData.filter(t => t.agent === filter.agent);
    }
    return filterTickets(base, filter.status)
      .sort((a, b) => b.sortDate - a.sortDate);
  }, [dateData, filter]);



  // Match legacy 5 KPI cards exactly (icons now from Lucide for crisp rendering)
  const kpiCards = [
    { label: 'Total Tickets', count: kpi.total,       icon: <TicketIcon size={18} />,  variant: 'total',  status: 'Total' },
    { label: 'Completed',     count: kpi.completed,    icon: <CheckCircle2 size={18} />, variant: 'comp',   status: 'Completed' },
    { label: 'Pending',       count: kpi.pending + kpi.notCompleted + kpi.inProgress, icon: <Clock size={18} />, variant: 'pend', status: 'Not Completed' },
    { label: 'Closed',        count: kpi.closed,       icon: <Archive size={18} />,      variant: 'closed', status: 'Closed' },
    { label: "Can't Do",      count: kpi.cantDo,       icon: <XCircle size={18} />,      variant: 'cant',   status: "Can't Do" },
  ];

  // Compute team average for peer comparison bars
  const teamAvg = agentStats.length
    ? agentStats.reduce((sum, a) => sum + a.rate, 0) / agentStats.length
    : 0;

  return (
    <div className="view-container dashboard-view">
      {/* Date filter pills */}
      <div className="filter-bar">
        <DatePills />
      </div>

      {/* KPI Cards — 5 cards matching legacy layout */}
      <div className="kpi-grid" role="region" aria-label="Key performance indicators">
        {kpiCards.map((card) => (
          <KpiCard
            key={card.variant}
            label={card.label}
            count={card.count}
            icon={card.icon}
            variant={card.variant}
            isActive={filter.status === card.status}
            onClick={() => handleKpiClick(card.status)}
          />
        ))}
      </div>

      {/* Team Overview Section */}
      {agentStats.length > 0 && (
        <>
          <div className="section-title">
            <span style={{ color: 'var(--warning)' }}>🏆</span> Team Overview
          </div>

          <div className="scoring-system">
            <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem', fontWeight: 700 }}>📊 Scoring System</h3>
            <div className="scoring-grid">
              <div className="scoring-item">
                <strong>+10</strong> Completed
              </div>
              <div className="scoring-item">
                <strong>+0</strong> Valid Closed
              </div>
              <div className="scoring-item">
                <strong>-5</strong> Can&apos;t Do
              </div>
              <div className="scoring-item">
                <strong>-10</strong> Invalid
              </div>
              <div className="scoring-item">
                <strong>-3</strong> Old Pending
              </div>
            </div>
          </div>

          {/* Agent Cards Grid */}
          <div className="agent-grid">
            {agentStats.map(stat => (
              <AgentCard
                key={stat.email}
                stat={stat}
                teamAvg={teamAvg}
                onFilterAgent={handleAgentFilter}
              />
            ))}
          </div>
        </>
      )}

      {/* Ticket List — filtered in-place by KPI / agent stat buttons */}
      <div className="view-section" id="table-scroll-target">
        <TicketTable
          tickets={displayedTickets}
          title={filter.title}
          onResetFilters={() => setFilter({
            type: 'all',
            status: 'Total',
            agent: null,
            title: '📊 Total Tickets',
          })}
        />
      </div>
    </div>
  );
}
