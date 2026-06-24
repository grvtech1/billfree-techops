interface Props {
  label:     string;
  count:     number;
  color:     string;
  icon:      string;
  variant:   string;
  isActive?: boolean;
  onClick?:  () => void;
}

export default function KpiCard({ label, count, color, icon, variant, isActive, onClick }: Props) {
  return (
    <button
      className={`kpi-card card-${variant} ${isActive ? 'active' : ''}`}
      onClick={onClick}
      type="button"
      aria-label={`${label}: ${count}`}
    >
      <div className="kpi-head">
        <span className="kpi-label" style={{ color }}>{label}</span>
        <span className="kpi-icon" style={{ color }} aria-hidden="true">{icon}</span>
      </div>
      <div className="kpi-val">{count.toLocaleString()}</div>
    </button>
  );
}
