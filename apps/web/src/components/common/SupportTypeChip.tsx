import { SUPPORT_TYPE_COLORS } from '../../lib/constants';

interface Props {
  type: string;
}

/**
 * Colored chip for support type — uses SUPPORT_TYPE_COLORS for brand-consistent
 * visual differentiation of Customer Support / IT Floor / Floor / FOS.
 */
export default function SupportTypeChip({ type }: Props) {
  const color = SUPPORT_TYPE_COLORS[type] ?? '#64748B';

  return (
    <span
      className="support-type-chip"
      style={{
        background: `${color}18`,
        color,
        borderLeft: `2px solid ${color}`,
      }}
      title={type}
    >
      {type}
    </span>
  );
}
