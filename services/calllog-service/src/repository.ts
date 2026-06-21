import type { Pool } from '@billfree/service-common';
import type { CallEvent, CreateCallEventInput, ListCallQuery } from './domain.js';

export interface ListResult {
  rows: CallEvent[];
  total: number;
}

/** Optional caller scoping — non-managers only see their own call events. */
export interface ListScope {
  ownerEmail?: string;
}

/**
 * Repository abstraction — route handlers depend on this interface, not on
 * Postgres directly, so they're unit-testable with an in-memory fake and the
 * storage engine can be swapped without touching business logic.
 */
export interface CallEventRepository {
  list(q: ListCallQuery, scope?: ListScope): Promise<ListResult>;
  create(e: CallEvent): Promise<CallEvent>;
}

const COLUMNS = `
  event_id AS "eventId", created_at AS "createdAt", ticket_id AS "ticketId", mid,
  business, customer_phone AS "customerPhone", agent_email AS "agentEmail",
  agent_name AS "agentName", role, event_type AS "eventType", outcome,
  duration_sec AS "durationSec", channel, provider,
  provider_call_id AS "providerCallId", source, notes, verified`;

/** Postgres-backed implementation. */
export class PgCallEventRepository implements CallEventRepository {
  constructor(private readonly pool: Pool) {}

  async list(q: ListCallQuery, scope?: ListScope): Promise<ListResult> {
    const where: string[] = [];
    const params: unknown[] = [];
    const eq = (col: string, val: unknown): void => {
      params.push(val);
      where.push(`${col} = $${params.length}`);
    };
    const like = (col: string, val: string): void => {
      params.push(`%${val}%`);
      where.push(`${col} ILIKE $${params.length}`);
    };

    // Authorization filter first — a non-manager is pinned to their own email.
    if (scope?.ownerEmail) eq('agent_email', scope.ownerEmail);
    else if (q.agentEmail) like('agent_email', q.agentEmail);

    if (q.ticketId) like('ticket_id', q.ticketId);
    if (q.mid) like('mid', q.mid);
    if (q.eventType) eq('event_type', q.eventType);
    if (q.outcome) eq('outcome', q.outcome);

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const offset = (q.page - 1) * q.pageSize;

    const countRes = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM call_events ${whereSql}`,
      params,
    );
    const rowsRes = await this.pool.query<CallEvent>(
      `SELECT ${COLUMNS} FROM call_events ${whereSql}
       ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, q.pageSize, offset],
    );
    return { rows: rowsRes.rows, total: Number(countRes.rows[0]?.count ?? 0) };
  }

  async create(e: CallEvent): Promise<CallEvent> {
    const res = await this.pool.query<CallEvent>(
      `INSERT INTO call_events
        (event_id, created_at, ticket_id, mid, business, customer_phone, agent_email,
         agent_name, role, event_type, outcome, duration_sec, channel, provider,
         provider_call_id, source, notes, verified)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING ${COLUMNS}`,
      [
        e.eventId, e.createdAt, e.ticketId, e.mid, e.business, e.customerPhone, e.agentEmail,
        e.agentName, e.role, e.eventType, e.outcome, e.durationSec, e.channel, e.provider,
        e.providerCallId, e.source, e.notes, e.verified,
      ],
    );
    return res.rows[0] ?? e;
  }
}

/** Build a domain CallEvent from validated create-input + resolved identity. */
export function newCallEvent(
  eventId: string,
  createdAt: string,
  input: CreateCallEventInput,
  identity: { agentName: string | null; role: string | null },
): CallEvent {
  return {
    eventId,
    createdAt,
    ticketId: input.ticketId ?? null,
    mid: input.mid ?? null,
    business: input.business ?? null,
    customerPhone: input.customerPhone ?? null,
    agentEmail: input.agentEmail,
    agentName: input.agentName ?? identity.agentName,
    role: identity.role,
    eventType: input.eventType,
    outcome: input.outcome,
    durationSec: input.durationSec,
    channel: input.channel ?? null,
    provider: input.provider ?? null,
    providerCallId: input.providerCallId ?? null,
    source: input.source ?? 'dashboard',
    notes: input.notes ?? null,
    verified: false,
  };
}
