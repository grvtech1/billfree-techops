interface Props {
  current:  number;
  total:    number;
  pageSize: number;
  onChange: (page: number) => void;
}

export default function Pagination({ current, total, pageSize, onChange }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  // Show up to 5 page buttons around current
  const range: number[] = [];
  const delta = 2;
  for (
    let i = Math.max(1, current - delta);
    i <= Math.min(totalPages, current + delta);
    i++
  ) {
    range.push(i);
  }

  return (
    <nav className="pagination" aria-label="Pagination" role="navigation">
      <button
        className="btn btn-ghost pagination-btn"
        onClick={() => onChange(current - 1)}
        disabled={current <= 1}
        aria-label="Previous page"
      >
        ‹
      </button>

      {range[0] > 1 && (
        <>
          <button className="btn btn-ghost pagination-btn" onClick={() => onChange(1)}>1</button>
          {range[0] > 2 && <span className="pagination-ellipsis">…</span>}
        </>
      )}

      {range.map(p => (
        <button
          key={p}
          className={`btn pagination-btn ${p === current ? 'pagination-btn-active' : 'btn-ghost'}`}
          onClick={() => onChange(p)}
          aria-current={p === current ? 'page' : undefined}
        >
          {p}
        </button>
      ))}

      {range[range.length - 1] < totalPages && (
        <>
          {range[range.length - 1] < totalPages - 1 && (
            <span className="pagination-ellipsis">…</span>
          )}
          <button
            className="btn btn-ghost pagination-btn"
            onClick={() => onChange(totalPages)}
          >
            {totalPages}
          </button>
        </>
      )}

      <button
        className="btn btn-ghost pagination-btn"
        onClick={() => onChange(current + 1)}
        disabled={current >= totalPages}
        aria-label="Next page"
      >
        ›
      </button>

      <span className="pagination-info">
        {((current - 1) * pageSize) + 1}–{Math.min(current * pageSize, total)} of {total}
      </span>
    </nav>
  );
}
