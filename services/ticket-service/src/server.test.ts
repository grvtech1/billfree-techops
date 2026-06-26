import { describe, it, expect, beforeEach } from 'vitest';
import { signAccessToken, type JwtConfig } from '@billfree/service-common';
import { buildServer } from './server.js';
import {
  newTicket,
  type AgentRepository,
  type AuditListResult,
  type AuditRepository,
  type ListResult,
  type TicketRepository,
} from './repository.js';
import type { AuditRecord, CreateTicketInput, ListQuery, NewAuditEvent, Ticket } from './domain.js';

const JWT: JwtConfig = { secret: 'test-secret-at-least-16-chars', issuer: 'billfree-techops' };
const INTAKE_KEY = 'whatsapp-intake-key-1234567890';

// In-memory repository so the HTTP layer is testable without Postgres.
class FakeRepo implements TicketRepository {
  store = new Map<string, Ticket>();
  async list(q: ListQuery): Promise<ListResult> {
    let rows = [...this.store.values()];
    if (q.status) rows = rows.filter((t) => t.status === q.status);
    if (q.q) rows = rows.filter((t) => t.business.includes(q.q!) || t.id.includes(q.q!));
    const total = rows.length;
    const start = (q.page - 1) * q.pageSize;
    return { rows: rows.slice(start, start + q.pageSize), total };
  }
  async getById(id: string): Promise<Ticket | null> {
    return this.store.get(id) ?? null;
  }
  async create(t: Ticket): Promise<Ticket> {
    this.store.set(t.id, t);
    return t;
  }
  async update(id: string, patch: { status?: string; reason?: string }): Promise<Ticket | null> {
    const t = this.store.get(id);
    if (!t) return null;
    const updated = { ...t, ...patch };
    this.store.set(id, updated);
    return updated;
  }
  async latestVersion(): Promise<number> {
    return Date.now();
  }
}

// In-memory audit store mirroring PgAuditRepository's contract.
class FakeAuditRepo implements AuditRepository {
  events: NewAuditEvent[] = [];
  async record(e: NewAuditEvent): Promise<void> {
    this.events.push(e);
  }
  async listByTicket(ticketId: string, page: number, pageSize: number): Promise<AuditListResult> {
    const all = this.events
      .filter((e) => e.ticketId === ticketId)
      .map((e, i): AuditRecord => ({
        id: i + 1,
        createdAt: new Date(Date.UTC(2026, 5, 1, i)).toISOString(),
        ticketId: e.ticketId,
        actor: e.actor,
        action: e.action,
        previousStatus: e.previousStatus ?? null,
        newStatus: e.newStatus ?? null,
        reasonAdded: e.reasonAdded ?? false,
        durationMs: e.durationMs ?? null,
        severity: e.severity ?? 'INFO',
      }))
      .reverse();
    const start = (page - 1) * pageSize;
    return { rows: all.slice(start, start + pageSize), total: all.length };
  }
}

class FakeAgentRepo implements AgentRepository {
  assignee: string | null = 'agent1@billfree.in';
  async pickAssignee(): Promise<string | null> {
    return this.assignee;
  }
}

const validInput: CreateTicketInput = {
  agentEmail: 'agent1@billfree.in',
  requestedBy: 'Branch A',
  mid: '100200',
  business: 'Green Mart',
  pos: 'Tally',
  supportType: 'Customer Support',
  concern: 'POS not syncing receipts',
};

let repo: FakeRepo;
let audit: FakeAuditRepo;
let agents: FakeAgentRepo;
let app: ReturnType<typeof buildServer>;
let agentToken: string;
let viewerToken: string;

beforeEach(async () => {
  repo = new FakeRepo();
  audit = new FakeAuditRepo();
  agents = new FakeAgentRepo();
  app = buildServer({ repo, audit, agents, intakeApiKey: INTAKE_KEY, jwt: JWT, logger: false });
  agentToken = await signAccessToken({ sub: 'agent1@billfree.in', name: 'Agent One', role: 'agent' }, JWT);
  viewerToken = await signAccessToken({ sub: 'v@billfree.in', name: 'Viewer', role: 'viewer' }, JWT);
});

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

describe('auth', () => {
  it('rejects unauthenticated requests with 401 + E002', async () => {
    const res = await app.inject({ method: 'GET', url: '/tickets' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain('[E002]');
  });

  it('rejects ticket creation by a viewer with 403 + E008', async () => {
    const res = await app.inject({ method: 'POST', url: '/tickets', headers: auth(viewerToken), payload: validInput });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('[E008]');
  });
});

describe('CRUD', () => {
  it('creates a ticket (201) with a generated id and default status', async () => {
    const res = await app.inject({ method: 'POST', url: '/tickets', headers: auth(agentToken), payload: validInput });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.id).toMatch(/^BF-\d{6}-[A-Z0-9]{4}$/);
    expect(body.data.status).toBe('Not Completed');
  });

  it('lists tickets with pagination meta', async () => {
    await app.inject({ method: 'POST', url: '/tickets', headers: auth(agentToken), payload: validInput });
    const res = await app.inject({ method: 'GET', url: '/tickets?page=1&pageSize=10', headers: auth(viewerToken) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.meta).toEqual({ total: 1, page: 1, limit: 10 });
  });

  it('gets a ticket by id, 404 + E003 when missing', async () => {
    const created = (await app.inject({ method: 'POST', url: '/tickets', headers: auth(agentToken), payload: validInput })).json();
    const ok = await app.inject({ method: 'GET', url: `/tickets/${created.data.id}`, headers: auth(viewerToken) });
    expect(ok.statusCode).toBe(200);
    const missing = await app.inject({ method: 'GET', url: '/tickets/BF-000000-XXXX', headers: auth(viewerToken) });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toContain('[E003]');
  });

  it('updates the POS field', async () => {
    const created = (await app.inject({ method: 'POST', url: '/tickets', headers: auth(agentToken), payload: validInput })).json();
    const res = await app.inject({
      method: 'PATCH',
      url: `/tickets/${created.data.id}`,
      headers: auth(agentToken),
      payload: { pos: 'GoFrugal' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.pos).toBe('GoFrugal');
  });

  it('updates status and appends a timestamped reason', async () => {
    const created = (await app.inject({ method: 'POST', url: '/tickets', headers: auth(agentToken), payload: validInput })).json();
    const res = await app.inject({
      method: 'PATCH',
      url: `/tickets/${created.data.id}`,
      headers: auth(agentToken),
      payload: { status: 'Completed', appendReason: 'Resolved by re-syncing POS' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.status).toBe('Completed');
    expect(body.data.reason).toMatch(/\] Resolved by re-syncing POS$/);
  });
});

describe('validation', () => {
  it('rejects an invalid status with 400 + E004', async () => {
    const created = (await app.inject({ method: 'POST', url: '/tickets', headers: auth(agentToken), payload: validInput })).json();
    const res = await app.inject({
      method: 'PATCH',
      url: `/tickets/${created.data.id}`,
      headers: auth(agentToken),
      payload: { status: 'Bogus' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('[E004]');
  });

  it('rejects creation missing required fields with 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/tickets', headers: auth(agentToken), payload: { mid: '1' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('[E004]');
  });
});

describe('audit trail', () => {
  it('records a TICKET_CREATED event on create', async () => {
    await app.inject({ method: 'POST', url: '/tickets', headers: auth(agentToken), payload: validInput });
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0].action).toBe('TICKET_CREATED');
    expect(audit.events[0].actor).toBe('agent1@billfree.in');
  });

  it('records a TICKET_UPDATED event with previous→new status + duration on a status change', async () => {
    const created = (await app.inject({ method: 'POST', url: '/tickets', headers: auth(agentToken), payload: validInput })).json();
    await app.inject({
      method: 'PATCH', url: `/tickets/${created.data.id}`, headers: auth(agentToken),
      payload: { status: 'Completed', appendReason: 'done' },
    });
    const upd = audit.events.find((e) => e.action === 'TICKET_UPDATED');
    expect(upd).toBeTruthy();
    expect(upd!.previousStatus).toBe('Not Completed');
    expect(upd!.newStatus).toBe('Completed');
    expect(upd!.reasonAdded).toBe(true);
    expect(typeof upd!.durationMs).toBe('number');
  });

  it('serves the per-ticket history with pagination + duration stats', async () => {
    const created = (await app.inject({ method: 'POST', url: '/tickets', headers: auth(agentToken), payload: validInput })).json();
    await app.inject({
      method: 'PATCH', url: `/tickets/${created.data.id}`, headers: auth(agentToken),
      payload: { status: 'Completed', appendReason: 'resolved' },
    });
    const res = await app.inject({ method: 'GET', url: `/tickets/${created.data.id}/history`, headers: auth(viewerToken) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.length).toBe(2); // created + updated
    expect(body.data[0].action).toMatch(/TICKET_(CREATED|UPDATED)/);
    expect(body.pagination).toMatchObject({ page: 1, pageSize: 20, totalRows: 2 });
    expect(body.durationStats.totalWithDuration).toBe(1); // only the status change carries a duration
  });

  it('returns an empty history (not 404) for a ticket with no events', async () => {
    const res = await app.inject({ method: 'GET', url: '/tickets/BF-000000-XXXX/history', headers: auth(viewerToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(0);
    expect(res.json().durationStats.totalWithDuration).toBe(0);
  });
});

describe('WhatsApp intake (API key)', () => {
  const apiKey = (k: string) => ({ 'x-api-key': k });
  const intake = { phone: '+91 99900 01111', concern: 'POS not printing', mid: '100200' };

  it('rejects intake without the API key (401 + E002)', async () => {
    const res = await app.inject({ method: 'POST', url: '/intake/tickets', payload: intake });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain('[E002]');
  });

  it('rejects a wrong API key', async () => {
    const res = await app.inject({ method: 'POST', url: '/intake/tickets', headers: apiKey('nope'), payload: intake });
    expect(res.statusCode).toBe(401);
  });

  it('creates a ticket: Not Completed, source whatsapp, auto-assigned', async () => {
    const res = await app.inject({ method: 'POST', url: '/intake/tickets', headers: apiKey(INTAKE_KEY), payload: intake });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.ticketId).toMatch(/^BF-\d{6}-[A-Z0-9]{4}$/);
    expect(body.status).toBe('Not Completed');
    expect(body.assignedAgent).toBe('Agent1');
    expect(body.channel).toBe('whatsapp');
    const stored = repo.store.get(body.ticketId)!;
    expect(stored.source).toBe('whatsapp');
    expect(stored.agentEmail).toBe('agent1@billfree.in');
    expect(stored.requestedBy).toBe('WhatsApp Customer');
  });

  it('accepts Business Name when MID is absent', async () => {
    const res = await app.inject({
      method: 'POST', url: '/intake/tickets', headers: apiKey(INTAKE_KEY),
      payload: { phone: '9990002222', concern: 'Settlement issue', business: 'Green Mart' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('rejects when BOTH MID and Business are missing (400 + E004)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/intake/tickets', headers: apiKey(INTAKE_KEY),
      payload: { phone: '9990003333', concern: 'Need help' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('[E004]');
  });

  it('requires phone and concern', async () => {
    const noPhone = await app.inject({ method: 'POST', url: '/intake/tickets', headers: apiKey(INTAKE_KEY), payload: { concern: 'x', mid: '1' } });
    const noConcern = await app.inject({ method: 'POST', url: '/intake/tickets', headers: apiKey(INTAKE_KEY), payload: { phone: '9990004444', mid: '1' } });
    expect(noPhone.statusCode).toBe(400);
    expect(noConcern.statusCode).toBe(400);
  });

  it('lets the customer poll status with a matching phone (different format ok)', async () => {
    const created = (await app.inject({ method: 'POST', url: '/intake/tickets', headers: apiKey(INTAKE_KEY), payload: intake })).json();
    const res = await app.inject({
      method: 'GET',
      url: `/intake/tickets/${created.ticketId}/status?phone=${encodeURIComponent('99900-01111')}`,
      headers: apiKey(INTAKE_KEY),
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.status).toBe('Not Completed');
    expect(data.assignedAgent).toBe('Agent1');
    expect(data.ticketId).toBe(created.ticketId);
    // privacy: never leak the agent email
    expect(JSON.stringify(data)).not.toContain('@billfree.in');
  });

  it('hides a ticket from a non-matching phone (404, no existence leak)', async () => {
    const created = (await app.inject({ method: 'POST', url: '/intake/tickets', headers: apiKey(INTAKE_KEY), payload: intake })).json();
    const res = await app.inject({
      method: 'GET', url: `/intake/tickets/${created.ticketId}/status?phone=9998887777`, headers: apiKey(INTAKE_KEY),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain('[E003]');
  });
});

describe('ops endpoints', () => {
  it('exposes liveness, readiness and metrics', async () => {
    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/readyz' })).statusCode).toBe(200);
    const metrics = await app.inject({ method: 'GET', url: '/metrics' });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.body).toContain('http_request_duration_seconds');
  });
});

// silence unused-import lint for the helper re-export
void newTicket;
