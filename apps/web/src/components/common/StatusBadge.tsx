import type { Status } from '../../types';
import { STATUS_COLORS } from '../../lib/constants';

interface Props {
  status: Status;
  size?: 'sm' | 'md';
}

export default function StatusBadge({ status, size = 'md' }: Props) {
  const colors = STATUS_COLORS[status] ?? STATUS_COLORS['Not Completed'];
  return (
    <span
      className={`status-badge status-badge-${size}`}
      style={{
        background:  colors.bg,
        color:       colors.text,
        border:      `1px solid ${colors.border}`,
      }}
      title={status}
    >
      {status}
    </span>
  );
}
