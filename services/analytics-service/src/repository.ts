import type { Pool } from '@billfree/service-common';

export interface StatusCount {
  status: string;
  count: number;
}
export interface PosCount {
  pos: string;
  count: number;
}
export interface AgentStat {
  agentEmail: string;
  total: number;
  completed: number;
}
// [GAP-16] Types for the missing analytics
export interface MidCount { mid: string; business: string; count: number }
export interface RepeatCustomer { phone: string; business: string; tickets: number }
export interface ConcernTrendItem { concern: string; count: number; percentage: number }
export interface AgentMatrixRow {
  agent: string;
  total: number;
  completed: number;
  pending: number;
  cantDo: number;
  closed: number;
  completionRate: number;
}

/** Read-only analytics over the shared tickets table. */
export interface AnalyticsRepository {
  statusBreakdown(): Promise<StatusCount[]>;
  topPos(limit: number): Promise<PosCount[]>;
  agentLeaderboard(): Promise<AgentStat[]>;
  // [GAP-16] Missing analytics endpoints
  topMidsSame(limit: number): Promise<MidCount[]>;
  topMidsDiff(limit: number): Promise<MidCount[]>;
  repeatCustomers(limit: number): Promise<RepeatCustomer[]>;
  concernTrend(): Promise<ConcernTrendItem[]>;
  agentMatrix(): Promise<AgentMatrixRow[]>;
}

export class PgAnalyticsRepository implements AnalyticsRepository {
  constructor(private readonly pool: Pool) {}

  async statusBreakdown(): Promise<StatusCount[]> {
    const res = await this.pool.query<{ status: string; count: string }>(
      `SELECT status, COUNT(*)::int AS count FROM tickets GROUP BY status ORDER BY count DESC`,
    );
    return res.rows.map((r) => ({ status: r.status, count: Number(r.count) }));
  }

  async topPos(limit: number): Promise<PosCount[]> {
    const res = await this.pool.query<{ pos: string; count: string }>(
      `SELECT pos, COUNT(*)::int AS count FROM tickets
       WHERE pos IS NOT NULL AND pos <> '' GROUP BY pos ORDER BY count DESC LIMIT $1`,
      [limit],
    );
    return res.rows.map((r) => ({ pos: r.pos, count: Number(r.count) }));
  }

  async agentLeaderboard(): Promise<AgentStat[]> {
    const res = await this.pool.query<{ agent_email: string; total: string; completed: string }>(
      `SELECT agent_email,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'Completed')::int AS completed
       FROM tickets GROUP BY agent_email ORDER BY completed DESC`,
    );
    return res.rows.map((r) => ({
      agentEmail: r.agent_email,
      total: Number(r.total),
      completed: Number(r.completed),
    }));
  }

  // ── [GAP-16] Missing analytics methods ────────────────────────────────────

  /** Top MIDs with same concern (repeat issues). */
  async topMidsSame(limit: number): Promise<MidCount[]> {
    const res = await this.pool.query<{ mid: string; business: string; count: string }>(
      `SELECT mid, MAX(business) AS business, COUNT(*)::int AS count
       FROM tickets WHERE mid IS NOT NULL AND mid <> ''
       GROUP BY mid HAVING COUNT(*) > 1 ORDER BY count DESC LIMIT $1`,
      [limit],
    );
    return res.rows.map((r) => ({ mid: r.mid, business: r.business, count: Number(r.count) }));
  }

  /** Top MIDs with different concerns (diverse issues). */
  async topMidsDiff(limit: number): Promise<MidCount[]> {
    const res = await this.pool.query<{ mid: string; business: string; count: string }>(
      `SELECT mid, MAX(business) AS business, COUNT(DISTINCT concern)::int AS count
       FROM tickets WHERE mid IS NOT NULL AND mid <> ''
       GROUP BY mid HAVING COUNT(DISTINCT concern) > 1 ORDER BY count DESC LIMIT $1`,
      [limit],
    );
    return res.rows.map((r) => ({ mid: r.mid, business: r.business, count: Number(r.count) }));
  }

  /** Customers (by phone) with the most tickets. */
  async repeatCustomers(limit: number): Promise<RepeatCustomer[]> {
    const res = await this.pool.query<{ phone: string; business: string; tickets: string }>(
      `SELECT phone, MAX(business) AS business, COUNT(*)::int AS tickets
       FROM tickets WHERE phone IS NOT NULL AND phone <> ''
       GROUP BY phone HAVING COUNT(*) > 1 ORDER BY tickets DESC LIMIT $1`,
      [limit],
    );
    return res.rows.map((r) => ({ phone: r.phone, business: r.business, tickets: Number(r.tickets) }));
  }

  /** Concern breakdown with percentages. */
  async concernTrend(): Promise<ConcernTrendItem[]> {
    const res = await this.pool.query<{ concern: string; count: string }>(
      `SELECT concern, COUNT(*)::int AS count FROM tickets
       WHERE concern IS NOT NULL AND concern <> ''
       GROUP BY concern ORDER BY count DESC`,
    );
    const total = res.rows.reduce((s, r) => s + Number(r.count), 0);
    return res.rows.map((r) => ({
      concern: r.concern,
      count: Number(r.count),
      percentage: total > 0 ? Math.round((Number(r.count) / total) * 1000) / 10 : 0,
    }));
  }

  /** Per-agent status matrix. */
  async agentMatrix(): Promise<AgentMatrixRow[]> {
    const res = await this.pool.query<{
      agent_email: string; total: string; completed: string;
      pending: string; cant_do: string; closed: string;
    }>(
      `SELECT agent_email,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'Completed')::int AS completed,
              COUNT(*) FILTER (WHERE status IN ('Not Completed','Pending','In Progress'))::int AS pending,
              COUNT(*) FILTER (WHERE status = 'Can''t Do')::int AS cant_do,
              COUNT(*) FILTER (WHERE status = 'Closed')::int AS closed
       FROM tickets GROUP BY agent_email ORDER BY total DESC`,
    );
    return res.rows.map((r) => ({
      agent: r.agent_email,
      total: Number(r.total),
      completed: Number(r.completed),
      pending: Number(r.pending),
      cantDo: Number(r.cant_do),
      closed: Number(r.closed),
      completionRate: Number(r.total) > 0 ? Math.round((Number(r.completed) / Number(r.total)) * 1000) / 10 : 0,
    }));
  }
}
