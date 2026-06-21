import { z } from 'zod';
import { STATUSES } from '@billfree/shared';

/** Ticket entity (Postgres-backed; mirrors the original Sheet columns). */
export interface Ticket {
  id: string;
  createdAt: string; // ISO
  agentEmail: string;
  itEmail: string | null;
  requestedBy: string;
  mid: string;
  business: string;
  pos: string;
  supportType: string;
  concern: string;
  configNotes: string | null;
  remark: string | null;
  status: string;
  reason: string; // append-only follow-up log
  phone: string | null;
  source: string; // origin channel: 'dashboard' | 'whatsapp' | 'portal' | …
}

export const StatusSchema = z.enum(STATUSES);

export const CreateTicketSchema = z.object({
  agentEmail: z.string().email(),
  itEmail: z.string().email().nullish(),
  requestedBy: z.string().min(1).max(200),
  mid: z.string().min(1).max(50),
  business: z.string().min(1).max(200),
  pos: z.string().min(1).max(100),
  supportType: z.string().min(1).max(50),
  concern: z.string().min(1).max(2000),
  configNotes: z.string().max(2000).nullish(),
  remark: z.string().max(2000).nullish(),
  phone: z.string().max(20).nullish(),
});
export type CreateTicketInput = z.infer<typeof CreateTicketSchema>;

export const UpdateTicketSchema = z
  .object({
    status: StatusSchema.optional(),
    appendReason: z.string().min(1).max(2000).optional(),
    pos: z.string().min(1).max(100).optional(),
  })
  .refine((v) => v.status !== undefined || v.appendReason !== undefined || v.pos !== undefined, {
    message: 'Provide at least one of status, appendReason, or pos',
  });
export type UpdateTicketInput = z.infer<typeof UpdateTicketSchema>;

export const ListQuerySchema = z.object({
  status: StatusSchema.optional(),
  q: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListQuery = z.infer<typeof ListQuerySchema>;

/** Readable ticket id, e.g. BF-202606-7Q3K. */
export function generateTicketId(now: Date, rand: () => string): string {
  const ym = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return `BF-${ym}-${rand().toUpperCase().slice(0, 4)}`;
}

// ─── External channel intake (WhatsApp chatbot / portal) ──────────────────────

/**
 * Relaxed schema for tickets created by an external channel (a customer or a
 * cross-functional teammate via the WhatsApp bot). Phone + concern are required;
 * MID and Business are each optional but at least ONE must be present.
 */
export const IntakeTicketSchema = z
  .object({
    phone: z.string().trim().min(7, 'A valid phone number is required').max(20),
    concern: z.string().trim().min(1, 'Issue / concern is required').max(2000),
    mid: z.string().trim().max(50).optional(),
    business: z.string().trim().max(200).optional(),
    pos: z.string().trim().max(100).optional(),
    requestedBy: z.string().trim().max(200).optional(),
  })
  .refine((v) => Boolean(v.mid) || Boolean(v.business), {
    message: 'Provide at least one of MID or Business Name',
    path: ['mid'],
  });
export type IntakeTicketInput = z.infer<typeof IntakeTicketSchema>;

/** Minimal, privacy-safe status projection returned to the chatbot/customer. */
export interface PublicTicketStatus {
  ticketId: string;
  status: string;
  createdAt: string;
  business: string;
  mid: string;
  concern: string;
  assignedAgent: string; // display name only — never the agent's email
  source: string;
}

/** Title-cased display name from an email local-part (no PII beyond the name). */
export function agentDisplayName(email: string): string {
  const local = (email.split('@')[0] || email).replace(/[._-]+/g, ' ').trim();
  return local.replace(/\b\w/g, (c) => c.toUpperCase()) || email;
}

/** Compare phone numbers by their trailing digits (ignores +, spaces, 0/91 prefixes). */
export function phoneMatches(a: string | null, b: string): boolean {
  const digits = (s: string): string => s.replace(/\D/g, '').slice(-10);
  return Boolean(a) && digits(a as string).length === 10 && digits(a as string) === digits(b);
}

/** Build a domain Ticket from a validated intake payload + the auto-assigned agent. */
export function newIntakeTicket(
  id: string,
  createdAt: string,
  input: IntakeTicketInput,
  assignedAgent: string,
): Ticket {
  return {
    id,
    createdAt,
    agentEmail: assignedAgent,
    itEmail: null,
    requestedBy: input.requestedBy?.trim() || 'WhatsApp Customer',
    mid: input.mid ?? '',
    business: input.business ?? '',
    pos: input.pos ?? '',
    supportType: 'Customer Support',
    concern: input.concern,
    configNotes: null,
    remark: null,
    status: 'Not Completed',
    reason: '',
    phone: input.phone,
    source: 'whatsapp',
  };
}

/** Project a ticket to the public status shape (drops PII / internal fields). */
export function toPublicStatus(t: Ticket): PublicTicketStatus {
  return {
    ticketId: t.id,
    status: t.status,
    createdAt: t.createdAt,
    business: t.business,
    mid: t.mid,
    concern: t.concern,
    assignedAgent: t.agentEmail ? agentDisplayName(t.agentEmail) : 'Unassigned',
    source: t.source,
  };
}

/** Append a timestamped entry to the follow-up reason log. */
export function appendReason(existing: string, text: string, at: string): string {
  const entry = `[${at}] ${text.trim()}`;
  return existing ? `${existing}\n${entry}` : entry;
}

// ─── Audit trail ──────────────────────────────────────────────────────────────

export type DurationCategory = 'fast' | 'normal' | 'slow' | 'critical';

/** A single audit row as stored (snake-case columns mapped to camelCase). */
export interface AuditRecord {
  id: number;
  createdAt: string; // ISO
  ticketId: string;
  actor: string;
  action: string;
  previousStatus: string | null;
  newStatus: string | null;
  reasonAdded: boolean;
  durationMs: number | null;
  severity: string;
}

/** What the route hands the repository to record an event. */
export interface NewAuditEvent {
  ticketId: string;
  actor: string;
  action: 'TICKET_CREATED' | 'TICKET_UPDATED' | 'CLOSE_ATTEMPT_DENIED';
  previousStatus?: string | null;
  newStatus?: string | null;
  reasonAdded?: boolean;
  durationMs?: number | null;
  severity?: string;
}

/**
 * Bucket a resolution time into the dashboard's speed categories.
 * Thresholds match the legacy GAS implementation exactly: <4h fast, <24h normal,
 * <72h slow, else critical.
 */
export function categorizeDuration(hours: number): DurationCategory {
  if (hours < 4) return 'fast';
  if (hours < 24) return 'normal';
  if (hours < 72) return 'slow';
  return 'critical';
}

/** Render a duration in ms as a compact human label (e.g. "3h", "2d"). */
export function formatDuration(ms: number): string {
  const hours = ms / 3_600_000;
  return hours >= 24 ? `${Math.round(hours / 24)}d` : `${Math.max(1, Math.round(hours))}h`;
}

export interface AuditEntryView {
  rowNum: number;
  timestamp: string;
  timestampMs: number;
  user: string;
  action: string;
  ticketId: string;
  details: string;
  severity: string;
  sessionId: string;
  version: string;
  previousStatus: string;
  newStatus: string;
  reasonAdded: 'Yes' | 'No';
  duration: string | null;
  durationHours: number | null;
  durationCategory: DurationCategory | null;
}

export interface DurationStats {
  totalWithDuration: number;
  avgHours: number;
  fastCount: number;
  normalCount: number;
  slowCount: number;
  criticalCount: number;
}

/** Map a stored audit row into the view shape the SPA's audit modal renders. */
export function toAuditEntryView(r: AuditRecord): AuditEntryView {
  const ms = Date.parse(r.createdAt) || 0;
  const hours = r.durationMs != null ? Math.round((r.durationMs / 3_600_000) * 10) / 10 : null;
  return {
    rowNum: r.id,
    timestamp: ms ? new Date(ms).toISOString() : r.createdAt,
    timestampMs: ms,
    user: r.actor,
    action: r.action,
    ticketId: r.ticketId,
    details: '',
    severity: r.severity,
    sessionId: '',
    version: '',
    previousStatus: r.previousStatus ?? '',
    newStatus: r.newStatus ?? '',
    reasonAdded: r.reasonAdded ? 'Yes' : 'No',
    duration: r.durationMs != null ? formatDuration(r.durationMs) : null,
    durationHours: hours,
    durationCategory: hours != null ? categorizeDuration(hours) : null,
  };
}

/** Aggregate duration statistics across a page of audit entries. */
export function computeDurationStats(entries: AuditEntryView[]): DurationStats {
  const withDuration = entries.filter((e) => e.durationHours != null);
  const avg =
    withDuration.length > 0
      ? Math.round((withDuration.reduce((s, e) => s + (e.durationHours ?? 0), 0) / withDuration.length) * 10) / 10
      : 0;
  const count = (cat: DurationCategory): number =>
    withDuration.filter((e) => e.durationCategory === cat).length;
  return {
    totalWithDuration: withDuration.length,
    avgHours: avg,
    fastCount: count('fast'),
    normalCount: count('normal'),
    slowCount: count('slow'),
    criticalCount: count('critical'),
  };
}
