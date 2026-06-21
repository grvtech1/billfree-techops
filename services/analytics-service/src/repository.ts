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

/** Read-only analytics over the shared tickets table. */
export interface AnalyticsRepository {
  statusBreakdown(): Promise<StatusCount[]>;
  topPos(limit: number): Promise<PosCount[]>;
  agentLeaderboard(): Promise<AgentStat[]>;
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
}
