import { useTicketStore } from '../../store/ticketStore';
import { localDayStart } from '../../lib/utils';
import type { DateRangeType } from '../../types';

const PILLS: Array<{ type: DateRangeType; label: string }> = [
  { type: 'all',       label: 'All Time' },
  { type: 'today',     label: 'Today'    },
  { type: 'yesterday', label: 'Yesterday'},
  { type: '7days',     label: '7 Days'   },
  { type: '30days',    label: '30 Days'  },
  { type: 'custom',    label: 'Custom'   },
];

export default function DatePills() {
  const dateRange    = useTicketStore(s => s.dateRange);
  const setDateRange = useTicketStore(s => s.setDateRange);

  const handlePill = (type: DateRangeType) => {
    if (type === 'custom') return; // handled below
    setDateRange({ type });
  };

  const handleCustom = (key: 'start' | 'end', ymd: string) => {
    const ms = ymd ? localDayStart(ymd) : undefined;
    setDateRange({
      type:  'custom',
      start: key === 'start' ? ms : dateRange.start,
      end:   key === 'end'   ? (ms ? ms + 864e5 - 1 : undefined) : dateRange.end,
    });
  };

  const toYmd = (ms?: number): string => {
    if (!ms) return '';
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };

  return (
    <div className="date-pills" role="group" aria-label="Date filter">
      {PILLS.map(pill => (
        <button
          key={pill.type}
          className={`pill ${dateRange.type === pill.type ? 'active' : ''}`}
          onClick={() => handlePill(pill.type)}
          aria-pressed={dateRange.type === pill.type}
        >
          {pill.label}
        </button>
      ))}

      {dateRange.type === 'custom' && (
        <div className="date-custom-range" role="group" aria-label="Custom date range">
          <label htmlFor="date-from" className="sr-only">From date</label>
          <input
            id="date-from"
            type="date"
            className="date-input"
            value={toYmd(dateRange.start)}
            onChange={e => handleCustom('start', e.target.value)}
            aria-label="From date"
          />
          <span className="date-sep" aria-hidden="true">→</span>
          <label htmlFor="date-to" className="sr-only">To date</label>
          <input
            id="date-to"
            type="date"
            className="date-input"
            value={toYmd(dateRange.end)}
            onChange={e => handleCustom('end', e.target.value)}
            aria-label="To date"
          />
        </div>
      )}
    </div>
  );
}
