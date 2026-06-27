import type { ReactNode } from 'react';

export interface KpiTrend {
  direction: 'up' | 'down' | 'flat';
  percent:   number;       // e.g. 12.4
  label?:    string;       // e.g. "vs last 30d"
}

interface Props {
  label:     string;
  count:     number;
  icon:      ReactNode;    // Accepts an emoji string or JSX (e.g. a Lucide icon)
  variant:   string;       // total | comp | pend | closed | cant
  isActive?: boolean;
  trend?:    KpiTrend;
  /** @deprecated colour now derives from `variant` via CSS tokens. */
  color?:    string;
  onClick?:  () => void;
}

const TREND_CONFIG: Record<KpiTrend['direction'], { symbol: string; color: string }> = {
  up:   { symbol: '↑', color: 'var(--success)' },
  down: { symbol: '↓', color: 'var(--danger)'  },
  flat: { symbol: '→', color: 'var(--text-muted)' },
};

export default function KpiCard({ label, count, icon, variant, isActive, trend, onClick }: Props) {
  const tc = trend ? TREND_CONFIG[trend.direction] : null;

  return (
    <button
      className={`kpi-card card-${variant} ${isActive ? 'active' : ''}`}
      onClick={onClick}
      type="button"
      aria-pressed={isActive}
      aria-label={
        `${label}: ${count.toLocaleString()}` +
        (trend ? `, trend ${trend.direction} ${trend.percent}%` : '')
      }
    >
      <div className="kpi-header">
        <span className="kpi-label">{label}</span>
        <span className="kpi-icon-wrap" aria-hidden="true">{icon}</span>
      </div>

      <div className="kpi-body">
        <span className="kpi-val">{count.toLocaleString()}</span>
        {tc && trend && (
          <span className="kpi-trend" style={{ color: tc.color }}>
            <span className="kpi-trend-arrow" aria-hidden="true">{tc.symbol}</span>
            {trend.percent.toFixed(1)}%
          </span>
        )}
      </div>

      {trend?.label && <div className="kpi-footer">{trend.label}</div>}
    </button>
  );
}
