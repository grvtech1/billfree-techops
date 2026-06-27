interface Props {
  width?: string;
  height?: string;
  variant?: 'text' | 'card' | 'circle' | 'row';
  count?: number;
  className?: string;
}

/**
 * Skeleton loader — uses CSS shimmer animation.
 * Variants:
 *   text   — single line, 100% width
 *   card   — 120px tall card block
 *   circle — 40×40 circle (avatar placeholder)
 *   row    — table row placeholder
 */
export default function Skeleton({
  width,
  height,
  variant = 'text',
  count = 1,
  className = '',
}: Props) {
  const items = Array.from({ length: count });

  const baseClass = `skeleton skeleton-${variant} ${className}`;
  const style: React.CSSProperties = {};
  if (width)  style.width  = width;
  if (height) style.height = height;

  return (
    <>
      {items.map((_, i) => (
        <div
          key={i}
          className={baseClass}
          style={{ ...style, animationDelay: `${i * 0.06}s` }}
          aria-hidden="true"
          role="presentation"
        />
      ))}
    </>
  );
}

/**
 * Pre-composed skeleton patterns for common views.
 */
export function SkeletonKpiGrid({ count = 5 }: { count?: number }) {
  return (
    <div className="kpi-grid" aria-busy="true" aria-label="Loading KPIs" role="status">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="skeleton skeleton-card"
          style={{ height: '118px', animationDelay: `${i * 0.07}s` }}
        />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  // Varying widths read as real text columns rather than uniform bars.
  const colWidths = ['45%', '90%', '70%', '80%', '60%'];
  return (
    <div className="ticket-table-wrapper" aria-busy="true" aria-label="Loading tickets" role="status">
      {/* Faux header */}
      <div style={{ display: 'flex', gap: 10, padding: '12px 16px', borderBottom: '2px solid var(--border)' }}>
        {[60, 92, 120, 80, 100, 70].map((w, i) => (
          <div key={i} className="skeleton" style={{ width: w, height: 10, borderRadius: 4, flexShrink: 0 }} />
        ))}
      </div>
      {/* Faux rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div className="skeleton" style={{ width: 64, height: 22, borderRadius: 4, flexShrink: 0, animationDelay: `${i * 0.05}s` }} />
          {colWidths.map((w, j) => (
            <div
              key={j}
              className="skeleton skeleton-text"
              style={{ width: w, marginBottom: 0, animationDelay: `${(i + j) * 0.04}s` }}
            />
          ))}
          <div className="skeleton" style={{ width: 80, height: 22, borderRadius: 999, marginLeft: 'auto', flexShrink: 0, animationDelay: `${i * 0.05}s` }} />
        </div>
      ))}
    </div>
  );
}
