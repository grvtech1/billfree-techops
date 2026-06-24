import type { AgeCategory } from '@billfree/web-core';
import { AGE_COLORS } from '@billfree/web-core';

interface Props {
  ageDays:     number;
  ageCategory: AgeCategory;
}

export default function AgeBadge({ ageDays, ageCategory }: Props) {
  const colors = AGE_COLORS[ageCategory];
  return (
    <span
      className="age-badge"
      style={{ background: colors.bg, color: colors.text }}
      title={`${ageDays} days old`}
    >
      {ageDays}d
    </span>
  );
}
