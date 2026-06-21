import type { Pool } from '@billfree/service-common';
import type { AuditRecord, CreateTicketInput, ListQuery, NewAuditEvent, Ticket } from './domain.js';

/** Roster access for auto-assignment. */
export interface AgentRepository {
  /** Email of the active agent with the fewest open tickets, or null if none. */
  pickAssignee(): Promise<string | null>;
}

export interface ListResult {
  rows: Ticket[];
  total: number;
}

/**
 * Repository abstraction — the route handlers depend on this interface, not on
 * Postgres directly, so they're unit-testable with an in-memory fake and the
 * storage engine can be swapped without touching business logic.
 */
export interface TicketRepository {
  list(q: ListQuery): Promise<ListResult>;
  getById(id: string): Promise<Ticket | null>;
  create(t: Ticket): Promise<Ticket>;
  update(id: string, patch: { status?: string; reason?: string; pos?: string }): Promise<Ticket | null>;
}

const COLUMNS = `
  id, created_at AS "createdAt", agent_email AS "agentEmail", it_email AS "itEmail",
  requested_by AS "requestedBy", mid, business, pos, support_type AS "supportType",
  concern, config_notes AS "configNotes", remark, status, reason, phone, source`;

/** Postgres-backed implementation. */
export class PgTicketRepository implements TicketRepository {
  constructor(private readonly pool: Pool) {}

  async list(q: ListQuery): Promise<ListResult> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.status) {
      params.push(q.status);
      where.push(`status = $${params.length}`);
    }
    if (q.q) {
      params.push(`%${q.q}%`);
      const i = params.length;
      where.push(`(business ILIKE $${i} OR mid ILIKE $${i} OR concern ILIKE $${i} OR id ILIKE $${i})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const offset = (q.page - 1) * q.pageSize;

    const countRes = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM tickets ${whereSql}`,
      params,
    );
    const rowsRes = await this.pool.query<Ticket>(
      `SELECT ${COLUMNS} FROM tickets ${whereSql} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, q.pageSize, offset],
    );
    return { rows: rowsRes.rows, total: Number(countRes.rows[0]?.count ?? 0) };
  }

  async getById(id: string): Promise<Ticket | null> {
    const res = await this.pool.query<Ticket>(`SELECT ${COLUMNS} FROM tickets WHERE id = $1`, [id]);
    return res.rows[0] ?? null;
  }

  async create(t: Ticket): Promise<Ticket> {
    const res = await this.pool.query<Ticket>(
      `INSERT INTO tickets
        (id, created_at, agent_email, it_email, requested_by, mid, business, pos,
         support_type, concern, config_notes, remark, status, reason, phone, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING ${COLUMNS}`,
      [
        t.id, t.createdAt, t.agentEmail, t.itEmail, t.requestedBy, t.mid, t.business, t.pos,
        t.supportType, t.concern, t.configNotes, t.remark, t.status, t.reason, t.phone, t.source,
      ],
    );
    return res.rows[0];
  }

  async update(id: string, patch: { status?: string; reason?: string; pos?: string }): Promise<Ticket | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.status !== undefined) {
      params.push(patch.status);
      sets.push(`status = $${params.length}`);
    }
    if (patch.reason !== undefined) {
      params.push(patch.reason);
      sets.push(`reason = $${params.length}`);
    }
    if (patch.pos !== undefined) {
      params.push(patch.pos);
      sets.push(`pos = $${params.length}`);
    }
    if (sets.length === 0) return this.getById(id);
    params.push(id);
    const res = await this.pool.query<Ticket>(
      `UPDATE tickets SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${COLUMNS}`,
      params,
    );
    return res.rows[0] ?? null;
  }
}

export interface AuditListResult {
  rows: AuditRecord[];
  total: number;
}

/**
 * Audit trail store — append-only. Kept as a separate interface (single
 * responsibility) but co-located with tickets so a ticket write and its audit
 * record can later share a transaction if stronger atomicity is needed.
 */
export interface AuditRepository {
  record(e: NewAuditEvent): Promise<void>;
  listByTicket(ticketId: string, page: number, pageSize: number): Promise<AuditListResult>;
}

const AUDIT_COLUMNS = `
  id, created_at AS "createdAt", ticket_id AS "ticketId", actor, action,
  previous_status AS "previousStatus", new_status AS "newStatus",
  reason_added AS "reasonAdded", duration_ms AS "durationMs", severity`;

export class PgAuditRepository implements AuditRepository {
  constructor(private readonly pool: Pool) {}

  async record(e: NewAuditEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_log
        (ticket_id, actor, action, previous_status, new_status, reason_added, duration_ms, severity)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        e.ticketId, e.actor, e.action, e.previousStatus ?? null, e.newStatus ?? null,
        e.reasonAdded ?? false, e.durationMs ?? null, e.severity ?? 'INFO',
      ],
    );
  }

  async listByTicket(ticketId: string, page: number, pageSize: number): Promise<AuditListResult> {
    const offset = (page - 1) * pageSize;
    const countRes = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM audit_log WHERE ticket_id = $1`,
      [ticketId],
    );
    const rowsRes = await this.pool.query<AuditRecord>(
      `SELECT ${AUDIT_COLUMNS} FROM audit_log WHERE ticket_id = $1
       ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
      [ticketId, pageSize, offset],
    );
    return { rows: rowsRes.rows, total: Number(countRes.rows[0]?.count ?? 0) };
  }
}

/** Build a domain Ticket from validated create-input. */
export function newTicket(
  id: string,
  createdAt: string,
  input: CreateTicketInput,
): Ticket {
  return {
    id,
    createdAt,
    agentEmail: input.agentEmail,
    itEmail: input.itEmail ?? null,
    requestedBy: input.requestedBy,
    mid: input.mid,
    business: input.business,
    pos: input.pos,
    supportType: input.supportType,
    concern: input.concern,
    configNotes: input.configNotes ?? null,
    remark: input.remark ?? null,
    status: 'Not Completed',
    reason: '',
    phone: input.phone ?? null,
    source: 'dashboard',
  };
}

/** Postgres roster + least-loaded assignment over the live tickets table. */
export class PgAgentRepository implements AgentRepository {
  constructor(private readonly pool: Pool) {}

  async pickAssignee(): Promise<string | null> {
    // Active agents ranked by their count of still-open tickets (Completed /
    // Closed / Can't Do are "done"); ties broken deterministically by email.
    const res = await this.pool.query<{ email: string }>(
      `SELECT a.email
         FROM agents a
         LEFT JOIN tickets t
           ON t.agent_email = a.email
          AND t.status NOT IN ('Completed', 'Closed', 'Can''t Do')
        WHERE a.active = true
        GROUP BY a.email
        ORDER BY COUNT(t.id) ASC, a.email ASC
        LIMIT 1`,
    );
    return res.rows[0]?.email ?? null;
  }
}
