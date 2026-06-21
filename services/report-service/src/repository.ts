import type { Pool } from '@billfree/service-common';
import type { ReportTicket } from './domain.js';

/** Read-only access to the tickets a monthly report is computed from. */
export interface ReportRepository {
  ticketsForMonth(year: number, month: number): Promise<ReportTicket[]>;
}

const COLUMNS = `
  id, created_at AS "createdAt", agent_email AS "agentEmail", business, mid,
  concern, support_type AS "supportType", status, reason`;

export class PgReportRepository implements ReportRepository {
  constructor(private readonly pool: Pool) {}

  async ticketsForMonth(year: number, month: number): Promise<ReportTicket[]> {
    // Half-open interval [first-of-month, first-of-next-month) — index-friendly
    // and correct across month/year boundaries (December → next January).
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const end = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
    const res = await this.pool.query<ReportTicket>(
      `SELECT ${COLUMNS} FROM tickets
       WHERE created_at >= $1 AND created_at < $2
       ORDER BY created_at ASC`,
      [start, end],
    );
    return res.rows.map((r) => ({ ...r, reason: r.reason ?? '' }));
  }
}
