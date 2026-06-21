import type { Ticket } from '../../types';
import TicketRow from './TicketRow';
import Pagination from '../common/Pagination';
import EmptyState from '../common/EmptyState';
import { useTicketStore } from '../../store/ticketStore';
import { useState } from 'react';

interface Props {
  tickets:    Ticket[];
  showFilter?: boolean;
  title?:     string;
  onResetFilters?: () => void;
}

const COLUMNS = [
  { key: 'id',          label: 'ID',              width: '155px' },
  { key: 'date',        label: 'Date',            width: '80px'  },
  { key: 'ageDays',     label: 'Age',             width: '45px'  },
  { key: 'agent',       label: 'Agent',           width: '110px' },
  { key: 'business',    label: 'Business',        width: '170px' },
  { key: 'mid',         label: 'MID',             width: '70px'  },
  { key: 'pos',         label: 'POS',             width: '100px' },
  { key: 'phone',       label: '📞 Phone',       width: '100px' },
  { key: 'concern',     label: 'Concern',         width: '160px' },
  { key: 'status',      label: 'Status',          width: '130px' },
  { key: 'reason',      label: 'Follow-up',       width: '130px' },
  { key: 'actions',     label: 'Actions',         width: '90px'  },
];

export default function TicketTable({ tickets, title, onResetFilters }: Props) {
  const masterFilter    = useTicketStore(s => s.masterFilter);
  const setMasterFilter = useTicketStore(s => s.setMasterFilter);
  const [search, setSearch] = useState('');

  // Pagination applied client-side within this view
  const { page, pageSize } = masterFilter;

  // Local search filter (for the search box in the header)
  const filtered = search
    ? tickets.filter(t =>
        [t.id, t.business, t.mid, t.concern, t.agent, t.phone]
          .join(' ').toLowerCase().includes(search.toLowerCase())
      )
    : tickets;

  const start = (page - 1) * pageSize;
  const pageTickets = filtered.slice(start, start + pageSize);

  if (tickets.length === 0) {
    return (
      <EmptyState
        icon="🎫"
        title="No tickets found"
        description="Try adjusting your filters or date range."
        action={
          onResetFilters && (
            <button
              className="btn btn-primary btn-sm"
              onClick={onResetFilters}
              type="button"
            >
              Reset Filters
            </button>
          )
        }
      />
    );
  }

  return (
    <div className="ticket-table-wrapper">
      {/* Header bar matching legacy */}
      {title && (
        <div className="table-header-bar">
          <h3 className="table-main-title">📋 {title} ({filtered.length})</h3>
          <div className="table-search">
            <input
              className="form-input form-input-sm"
              placeholder="🔍 Search tickets..."
              value={search}
              onChange={e => { setSearch(e.target.value); setMasterFilter({ page: 1 }); }}
            />
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon="🔍"
          title="No matching tickets"
          description={`We couldn't find any tickets matching "${search}".`}
          action={
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                setSearch('');
                setMasterFilter({ page: 1 });
              }}
              type="button"
            >
              Clear Search
            </button>
          }
        />
      ) : (
        <>
          <div className="ticket-table-scroll" role="region" aria-label="Ticket list" tabIndex={0}>
            <table className="ticket-table" aria-rowcount={filtered.length}>
              <thead>
                <tr>
                  {COLUMNS.map(col => (
                    <th
                      key={col.key}
                      style={{ width: col.width, minWidth: col.width }}
                      scope="col"
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageTickets.map(ticket => (
                  <TicketRow key={ticket.id} ticket={ticket} />
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            current={page}
            total={filtered.length}
            pageSize={pageSize}
            onChange={p => setMasterFilter({ page: p })}
          />
        </>
      )}
    </div>
  );
}
