import { z } from 'zod';

/**
 * Call-event entity (Postgres-backed). Mirrors the legacy GAS Call-Log sheet
 * columns (CallLog.gs: CALL_LOG_HEADERS) so the dashboard's CallLogView renders
 * unchanged once the gateway adapts the shape.
 */
export interface CallEvent {
  eventId: string;
  createdAt: string; // ISO
  ticketId: string | null;
  mid: string | null;
  business: string | null;
  customerPhone: string | null;
  agentEmail: string;
  agentName: string | null;
  role: string | null;
  eventType: string;
  outcome: string;
  durationSec: number;
  channel: string | null;
  provider: string | null;
  providerCallId: string | null;
  source: string | null;
  notes: string | null;
  verified: boolean;
}

// Canonical vocabularies — kept in lock-step with the dashboard's log form
// (apps/web CallLogView). PROVIDER_CDR is reserved for the webhook ingest path.
export const EVENT_TYPES = [
  'CALL_INITIATED',
  'CALL_COMPLETED',
  'CALL_NO_ANSWER',
  'CALL_FAILED',
  'CALL_DISPOSITION',
  'PROVIDER_CDR',
] as const;

export const OUTCOMES = [
  'CONNECTED',
  'NO_ANSWER',
  'BUSY',
  'SWITCHED_OFF',
  'CALLBACK_REQUESTED',
  'FAILED',
  'OTHER',
] as const;

export const EventTypeSchema = z.enum(EVENT_TYPES);
export const OutcomeSchema = z.enum(OUTCOMES);

export const CreateCallEventSchema = z.object({
  agentEmail: z.string().email(),
  agentName: z.string().max(200).nullish(),
  eventType: EventTypeSchema,
  outcome: OutcomeSchema,
  durationSec: z.coerce.number().int().min(0).max(86_400).default(0),
  ticketId: z.string().max(50).nullish(),
  mid: z.string().max(50).nullish(),
  business: z.string().max(200).nullish(),
  customerPhone: z.string().max(20).nullish(),
  channel: z.string().max(50).nullish(),
  provider: z.string().max(50).nullish(),
  providerCallId: z.string().max(120).nullish(),
  source: z.string().max(50).nullish(),
  notes: z.string().max(2000).nullish(),
});
export type CreateCallEventInput = z.infer<typeof CreateCallEventSchema>;

export const ListCallQuerySchema = z.object({
  ticketId: z.string().max(50).optional(),
  mid: z.string().max(50).optional(),
  agentEmail: z.string().max(200).optional(),
  eventType: EventTypeSchema.optional(),
  outcome: OutcomeSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListCallQuery = z.infer<typeof ListCallQuerySchema>;

/** Readable event id, e.g. CE-202606-9F3A7B2C. */
export function generateCallEventId(now: Date, rand: () => string): string {
  const ym = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return `CE-${ym}-${rand().toUpperCase().slice(0, 8)}`;
}
