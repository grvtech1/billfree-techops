// @billfree/feature-tickets — the ticket domain module.
//
// Owns the central ticket store (the app's primary dataset + derived KPIs /
// agent stats), the ticket data hooks, the ticket table + inline-edit cells,
// the ticket modals, and the shared ticket filters. Other views (dashboard,
// analytics, reports) compose these building blocks.
//
//   import { useTicketStore, TicketTable, DatePills } from '@billfree/feature-tickets';

export * from './ticketStore';          // useTicketStore, selectKpi, selectAgentStats
export * from './hooks/useTickets';     // useTickets

export { default as TicketTable }       from './components/TicketTable';
export { default as TicketRow }         from './components/TicketRow';
export { default as StatusDropdown }    from './components/StatusDropdown';
export { default as PosCell }           from './components/PosCell';
export { default as CreateTicketModal } from './components/CreateTicketModal';
export { default as UpdateTicketModal } from './components/UpdateTicketModal';
export { default as TicketAuditModal }  from './components/TicketAuditModal';

export { default as DatePills }    from './filters/DatePills';
export { default as MasterSearch } from './filters/MasterSearch';

// Ticket-domain screens (composed by the shell).
export { default as DashboardView }  from './views/DashboardView';
export { default as HistoryView }    from './views/HistoryView';
export { default as MasterDbView }   from './views/MasterDbView';
export { default as AnalyticsView }  from './views/AnalyticsView';
export { default as TeamReportView } from './views/TeamReportView';
export { default as SettingsView }   from './views/SettingsView';
