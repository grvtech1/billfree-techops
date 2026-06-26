import { describe, it, expect, beforeEach } from 'vitest';
import { signAccessToken, type JwtConfig } from '@billfree/service-common';
import { buildServer } from './server.js';
import { buildMonthlyReport, type ReportTicket } from './domain.js';
import type { ReportRepository } from './repository.js';

const JWT: JwtConfig = { secret: 'test-secret-at-least-16-chars', issuer: 'billfree-techops' };

// Deterministic June-2026 fixture (timestamps are UTC; IST bucketing shifts +5:30).
const fixture: ReportTicket[] = [
  { id: 'BF-1', createdAt: '2026-06-01T04:30:00Z', agentEmail: 'agent1@billfree.in', business: 'Green Mart',     mid: '100', concern: 'POS sync',       supportType: 'Customer Support', status: 'Completed',     reason: 'fixed' },
  { id: 'BF-2', createdAt: '2026-06-01T05:00:00Z', agentEmail: 'agent1@billfree.in', business: 'Sunrise',        mid: '101', concern: 'POS sync',       supportType: 'IT Floor',         status: 'Not Completed', reason: '' },
  { id: 'BF-3', createdAt: '2026-06-02T06:00:00Z', agentEmail: 'agent2@billfree.in', business: 'City Mart',      mid: '102', concern: 'Onboarding',     supportType: 'Customer Support', status: 'Completed',     reason: 'done' },
  { id: 'BF-4', createdAt: '2026-06-03T07:00:00Z', agentEmail: 'agent2@billfree.in', business: 'Bharat Stores',  mid: '103', concern: 'Hardware',       supportType: 'Floor',            status: 'Closed',        reason: '' },
  { id: 'BF-5', createdAt: '2026-06-03T08:00:00Z', agentEmail: 'agent1@billfree.in', business: 'Metro Hub',      mid: '104', concern: "Can't help",     supportType: 'FOS',              status: "Can't Do",      reason: 'n/a' },
];

class FakeRepo implements ReportRepository {
  constructor(private rows: ReportTicket[]) {}
  async ticketsForMonth(): Promise<ReportTicket[]> {
    return this.rows;
  }
}

let app: ReturnType<typeof buildServer>;
let token: string;
beforeEach(async () => {
  app = buildServer({ repo: new FakeRepo(fixture), jwt: JWT, logger: false });
  token = await signAccessToken({ sub: 'mgr@billfree.in', name: 'Manager', role: 'manager' }, JWT);
});
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

describe('buildMonthlyReport (pure)', () => {
  const now = new Date('2026-06-10T00:00:00Z');
  const report = buildMonthlyReport(fixture, { month: 6, year: 2026, generatedBy: 'Manager', now });

  it('summarises status buckets correctly', () => {
    expect(report.summary.totalTickets).toBe(5);
    expect(report.summary.completed).toBe(2);
    expect(report.summary.closed).toBe(1);
    expect(report.summary.cantDo).toBe(1);
    expect(report.summary.pending).toBe(1); // the single 'Not Completed'
    expect(report.summary.invalidClosed).toBe(1); // BF-4 closed without a reason
  });

  it('computes rates + a grade', () => {
    expect(report.summary.completionRate).toBe(40); // 2/5
    expect(report.summary.resolutionRate).toBe(60); // (2+1)/5
    expect(['A+', 'A', 'B', 'C', 'D']).toContain(report.summary.performanceGrade);
  });

  it('ranks agents by score', () => {
    expect(report.agentRankings).toHaveLength(2);
    const a1 = report.agentRankings.find((a) => a.name === 'Agent1');
    expect(a1?.total).toBe(3);
    expect(a1?.completed).toBe(1);
  });

  it('builds period, daily trend and hourly distribution arrays', () => {
    expect(report.period.daysInMonth).toBe(30);
    expect(report.dailyTrend).toHaveLength(30);
    expect(report.hourlyDistribution).toHaveLength(24);
    expect(report.peakHour).not.toBe('—');
  });

  it('produces a top concern (POS sync appears twice)', () => {
    expect(report.topConcerns[0].concern).toBe('POS sync');
    expect(report.topConcerns[0].count).toBe(2);
  });

  it('handles an empty month without throwing', () => {
    const empty = buildMonthlyReport([], { month: 2, year: 2026, generatedBy: 'x', now });
    expect(empty.summary.totalTickets).toBe(0);
    expect(empty.summary.performanceGrade).toBe('D');
    expect(empty.peakHour).toBe('—');
    expect(empty.period.daysInMonth).toBe(28);
  });
});

describe('GET /reports/monthly', () => {
  it('rejects unauthenticated requests (401 + E002)', async () => {
    const res = await app.inject({ method: 'GET', url: '/reports/monthly?month=6&year=2026' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain('[E002]');
  });

  it('returns { success, report } for an authenticated user', async () => {
    const res = await app.inject({ method: 'GET', url: '/reports/monthly?month=6&year=2026', headers: auth(token) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.report.summary.totalTickets).toBe(5);
    expect(body.report.generatedBy).toBe('Manager');
  });

  it('rejects an out-of-range month (400 + E004)', async () => {
    const res = await app.inject({ method: 'GET', url: '/reports/monthly?month=13&year=2026', headers: auth(token) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('[E004]');
  });

  it('exposes liveness, readiness and metrics', async () => {
    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/readyz' })).statusCode).toBe(200);
    const metrics = await app.inject({ method: 'GET', url: '/metrics' });
    expect(metrics.body).toContain('http_request_duration_seconds');
  });
});

describe('POST /reports/monthly/email', () => {
  it('rejects unauthenticated requests (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/reports/monthly/email',
      payload: { month: 6, year: 2026 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects agent role (403)', async () => {
    const agentToken = await signAccessToken(
      { sub: 'agent@billfree.in', name: 'Agent', role: 'agent' },
      JWT,
    );
    const res = await app.inject({
      method: 'POST',
      url: '/reports/monthly/email',
      headers: auth(agentToken),
      payload: { month: 6, year: 2026 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows manager and falls back to mock email generation when no SMTP is configured', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/reports/monthly/email',
      headers: auth(token),
      payload: { month: 6, year: 2026 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.mode).toBe('fallback');
    expect(body.html).toContain('linear-gradient(135deg, #4F46E5, #7C3AED)');
    expect(body.html).toContain('June 2026 — Operations Report');
  });
});

