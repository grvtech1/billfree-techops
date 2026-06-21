import type { Status } from '../types';

export const STATUS_ENUM = {
  NOT_COMPLETED: 'Not Completed',
  PENDING:       'Pending',
  IN_PROGRESS:   'In Progress',
  COMPLETED:     'Completed',
  CLOSED:        'Closed',
  CANT_DO:       "Can't Do",
} as const satisfies Record<string, Status>;

export const STATUS_LABELS = Object.values(STATUS_ENUM);

export const SUPPORT_TYPES = ['Customer Support', 'IT Floor', 'Floor', 'FOS'] as const;

export const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  'Not Completed': { bg: '#FEE2E2', text: '#991B1B', border: '#FCA5A5' },
  'In Progress':   { bg: '#DBEAFE', text: '#1E40AF', border: '#93C5FD' },
  'Pending':       { bg: '#FEF3C7', text: '#92400E', border: '#FCD34D' },
  'Completed':     { bg: '#D1FAE5', text: '#065F46', border: '#6EE7B7' },
  'Closed':        { bg: '#E2E8F0', text: '#475569', border: '#CBD5E1' },
  "Can't Do":      { bg: '#F3E8FF', text: '#6B21A8', border: '#D8B4FE' },
};

export const SUPPORT_TYPE_COLORS: Record<string, string> = {
  'Customer Support': '#3B82F6',
  'IT Floor':         '#10B981',
  'Floor':            '#F59E0B',
  'FOS':              '#8B5CF6',
};

/**
 * Origin-channel metadata for tickets. `dashboard` is the default (an agent
 * created it in-app) and is treated as "no badge" in the table to avoid clutter;
 * external channels (WhatsApp bot, public portal, API) get a visible chip so
 * agents can tell at a glance where a ticket came from.
 */
export const CHANNEL_META: Record<string, { label: string; icon: string; color: string }> = {
  dashboard: { label: 'Dashboard', icon: '🖥️', color: '#64748B' },
  whatsapp:  { label: 'WhatsApp',  icon: '📱', color: '#25D366' },
  portal:    { label: 'Portal',    icon: '🌐', color: '#3B82F6' },
  api:       { label: 'API',       icon: '🔌', color: '#8B5CF6' },
};

/** Normalise an arbitrary source string to a known channel key (fallback: dashboard). */
export function channelKey(source: string | undefined | null): string {
  const k = (source || 'dashboard').toLowerCase().trim();
  return k in CHANNEL_META ? k : 'dashboard';
}

export const AGE_COLORS: Record<string, { bg: string; text: string }> = {
  fresh:    { bg: '#D1FAE5', text: '#065F46' },
  aging:    { bg: '#FEF3C7', text: '#92400E' },
  old:      { bg: '#FFEDD5', text: '#9A3412' },
  critical: { bg: '#FEE2E2', text: '#991B1B' },
};

export const AGE_THRESHOLDS = {
  CRITICAL: 15,
  OLD:       8,
  AGING:     4,
  WARN_DAYS: 7,
} as const;

export const CHART_COLORS = [
  '#4F46E5', '#06B6D4', '#10B981', '#F59E0B',
  '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6',
];

export const ERROR_MESSAGES: Record<string, string> = {
  E001: 'Too many requests. Please wait and try again.',
  E002: 'Please sign in to continue.',
  E003: 'Item not found.',
  E004: 'Please check your input.',
  E005: 'Unable to access database. Please refresh.',
  E006: 'System busy. Please try again.',
  E007: 'Invalid status value.',
  E008: 'You do not have permission for this action.',
  E009: 'Rate limit exceeded.',
  E999: 'Something went wrong. Please try again.',
};

export const VERSION_POLL_MIN_MS = 30_000;
export const VERSION_POLL_MAX_MS = 120_000;
export const DEFAULT_PAGE_SIZE   = 50;
