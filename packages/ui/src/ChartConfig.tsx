/**
 * ChartConfig — shared Recharts styling primitives so every chart in the app
 * reads from the same palette, gradients, grid, axis and tooltip treatment.
 *
 * These are plain SVG/JSX helpers (no Recharts import) — drop them *inside* a
 * Recharts chart element:
 *
 *   <AreaChart data={data}>
 *     {GRADIENT_DEFS}
 *     <CartesianGrid {...CHART_GRID} vertical={false} />
 *     <XAxis dataKey="x" {...AXIS} />
 *     <Tooltip content={<PremiumTooltip unit=" tickets" />} />
 *     <Area dataKey="y" stroke={CHART_PALETTE.primary}
 *           fill="url(#grad-primary)" activeDot={<ActiveDot />} />
 *   </AreaChart>
 */

/* Palette aligned to the design-token hues. */
export const CHART_PALETTE = {
  primary: '#4F46E5',
  violet:  '#7C3AED',
  emerald: '#059669',
  amber:   '#D97706',
  rose:    '#E11D48',
  sky:     '#0284C7',
  slate:   '#475569',
  indigo:  '#6366F1',
  teal:    '#0D9488',
  orange:  '#EA580C',
} as const;

/* Vertical gradient fills for area/bar charts. Render once per chart. */
export const GRADIENT_DEFS = (
  <defs>
    <linearGradient id="grad-primary" x1="0" y1="0" x2="0" y2="1">
      <stop offset="5%"  stopColor="#4F46E5" stopOpacity={0.85} />
      <stop offset="95%" stopColor="#4F46E5" stopOpacity={0.04} />
    </linearGradient>
    <linearGradient id="grad-emerald" x1="0" y1="0" x2="0" y2="1">
      <stop offset="5%"  stopColor="#059669" stopOpacity={0.80} />
      <stop offset="95%" stopColor="#059669" stopOpacity={0.04} />
    </linearGradient>
    <linearGradient id="grad-amber" x1="0" y1="0" x2="0" y2="1">
      <stop offset="5%"  stopColor="#D97706" stopOpacity={0.80} />
      <stop offset="95%" stopColor="#D97706" stopOpacity={0.04} />
    </linearGradient>
    <linearGradient id="grad-violet" x1="0" y1="0" x2="0" y2="1">
      <stop offset="5%"  stopColor="#7C3AED" stopOpacity={0.85} />
      <stop offset="95%" stopColor="#7C3AED" stopOpacity={0.04} />
    </linearGradient>
    {/* soft glow for active dots */}
    <filter id="dot-glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur" />
      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  </defs>
);

/* Spread onto <CartesianGrid>. */
export const CHART_GRID = {
  strokeDasharray: '3 4',
  stroke: 'var(--border)',
  strokeOpacity: 0.6,
} as const;

/* Spread onto <XAxis> / <YAxis>. */
export const AXIS = {
  tick: { fontSize: 11, fill: 'var(--text-secondary)' },
  axisLine: false,
  tickLine: false,
} as const;

interface TooltipPayloadItem {
  name?:  string;
  value?: number | string;
  color?: string;
}
interface PremiumTooltipProps {
  active?:  boolean;
  payload?: TooltipPayloadItem[];
  label?:   string | number;
  unit?:    string;
}

/** Glassmorphic tooltip. Pass as `content={<PremiumTooltip unit=" tickets" />}`. */
export function PremiumTooltip({ active, payload, label, unit = '' }: PremiumTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="chart-tooltip">
      {label !== undefined && label !== '' && (
        <div className="chart-tooltip-label">{label}</div>
      )}
      {payload.map((entry, i) => (
        <div className="chart-tooltip-row" key={i}>
          <span className="chart-tooltip-dot" style={{ background: entry.color }} />
          <span className="chart-tooltip-name">{entry.name}</span>
          <span className="chart-tooltip-value">
            {typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value}{unit}
          </span>
        </div>
      ))}
    </div>
  );
}

interface ActiveDotProps {
  cx?: number;
  cy?: number;
  fill?: string;
  stroke?: string;
}
/** Glowing active dot — pass as `activeDot={<ActiveDot />}`. */
export function ActiveDot({ cx, cy, stroke }: ActiveDotProps) {
  if (cx === undefined || cy === undefined) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={5}
      fill={stroke ?? CHART_PALETTE.primary}
      stroke="#fff"
      strokeWidth={2.5}
      filter="url(#dot-glow)"
    />
  );
}
