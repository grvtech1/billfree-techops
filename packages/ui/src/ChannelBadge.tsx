import { CHANNEL_META, channelKey } from '@billfree/web-core';

interface Props {
  source?: string;
  /** Show the chip even for dashboard-origin tickets (used in detail views). */
  showDefault?: boolean;
}

/**
 * Small chip showing a ticket's origin channel (WhatsApp, Portal, API…).
 * Dashboard-created tickets are the norm, so by default they render nothing —
 * keeping the table clean and making externally-raised tickets stand out.
 */
export default function ChannelBadge({ source, showDefault = false }: Props) {
  const key = channelKey(source);
  if (key === 'dashboard' && !showDefault) return null;

  const meta = CHANNEL_META[key];
  return (
    <span
      className="channel-badge"
      style={{ background: `${meta.color}1A`, color: meta.color, borderColor: `${meta.color}55` }}
      title={`Created via ${meta.label}`}
    >
      <span aria-hidden="true">{meta.icon}</span> {meta.label}
    </span>
  );
}
