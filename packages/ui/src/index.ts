// @billfree/ui — design system: generic, presentational React components.
// Depends only on react (peer) + @billfree/web-core (types/constants). No app
// state, no data-access — "dumb" components driven entirely by props.
//
//   import { KpiCard, StatusBadge, Modal, Skeleton } from '@billfree/ui';

export { default as AgeBadge } from './AgeBadge';
export { default as AgentCard } from './AgentCard';
export { default as ChannelBadge } from './ChannelBadge';
export { default as EmptyState } from './EmptyState';
export { default as KpiCard } from './KpiCard';
export type { KpiTrend } from './KpiCard';
export {
  CHART_PALETTE, GRADIENT_DEFS, CHART_GRID, AXIS,
  PremiumTooltip, ActiveDot,
} from './ChartConfig';
export { default as Modal } from './Modal';
export { default as Pagination } from './Pagination';
export { default as StatusBadge } from './StatusBadge';
export { default as SupportTypeChip } from './SupportTypeChip';
export { default as Skeleton, SkeletonKpiGrid, SkeletonTable } from './Skeleton';
