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
          style={style}
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
export function SkeletonKpiGrid() {
  return (
    <div className="kpi-grid" aria-busy="true" aria-label="Loading KPIs">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="skeleton skeleton-card" style={{ height: '110px' }} />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="ticket-table-wrapper" aria-busy="true" aria-label="Loading tickets">
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="skeleton"
            style={{ height: '36px', borderRadius: '6px' }}
          />
        ))}
      </div>
    </div>
  );
}
