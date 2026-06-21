import { describe, it, expect, beforeEach } from 'vitest';
import { signAccessToken, type JwtConfig } from '@billfree/service-common';
import { buildServer } from './server.js';
import {
  newCallEvent,
  type CallEventRepository,
  type ListResult,
  type ListScope,
} from './repository.js';
import type { CallEvent, CreateCallEventInput, ListCallQuery } from './domain.js';

const JWT: JwtConfig = { secret: 'test-secret-at-least-16-chars', issuer: 'billfree-techops' };

// In-memory repository so the HTTP layer is testable without Postgres.
class FakeRepo implements CallEventRepository {
  store = new Map<string, CallEvent>();
  async list(q: ListCallQuery, scope?: ListScope): Promise<ListResult> {
    let rows = [...this.store.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (scope?.ownerEmail) rows = rows.filter((e) => e.agentEmail === scope.ownerEmail);
    else if (q.agentEmail) rows = rows.filter((e) => e.agentEmail.includes(q.agentEmail!));
    if (q.ticketId) rows = rows.filter((e) => (e.ticketId ?? '').includes(q.ticketId!));
    if (q.eventType) rows = rows.filter((e) => e.eventType === q.eventType);
    if (q.outcome) rows = rows.filter((e) => e.outcome === q.outcome);
    const total = rows.length;
    const start = (q.page - 1) * q.pageSize;
    return { rows: rows.slice(start, start + q.pageSize), total };
  }
  async create(e: CallEvent): Promise<CallEvent> {
    this.store.set(e.eventId, e);
    return e;
  }
}

const validInput: CreateCallEventInput = {
  agentEmail: 'agent1@billfree.in',
  eventType: 'CALL_COMPLETED',
  outcome: 'CONNECTED',
  durationSec: 95,
  ticketId: 'BF-202606-0001',
  mid: '100200',
  business: 'Green Mart',
  customerPhone: '9990001111',
};

let repo: FakeRepo;
let app: ReturnType<typeof buildServer>;
let agentToken: string;
let agent2Token: string;
let managerToken: string;
let viewerToken: string;

beforeEach(async () => {
  repo = new FakeRepo();
  app = buildServer({ repo, jwt: JWT, logger: false });
  agentToken = await signAccessToken({ sub: 'agent1@billfree.in', name: 'Agent One', role: 'agent' }, JWT);
  agent2Token = await signAccessToken({ sub: 'agent2@billfree.in', name: 'Agent Two', role: 'agent' }, JWT);
  managerToken = await signAccessToken({ sub: 'mgr@billfree.in', name: 'Manager', role: 'manager' }, JWT);
  viewerToken = await signAccessToken({ sub: 'v@billfree.in', name: 'Viewer', role: 'viewer' }, JWT);
});

const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const logCall = (token: string, payload: Partial<CreateCallEventInput> = {}) =>
  app.inject({ method: 'POST', url: '/calls', headers: auth(token), payload: { ...validInput, ...payload } });

describe('auth', () => {
  it('rejects unauthenticated list with 401 + E002', async () => {
    const res = await app.inject({ method: 'GET', url: '/calls' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain('[E002]');
  });

  it('rejects logging by a viewer with 403 + E008', async () => {
    const res = await logCall(viewerToken);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('[E008]');
  });
});

describe('logging', () => {
  it('creates a call event (201) with a generated id', async () => {
    const res = await logCall(agentToken);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.eventId).toMatch(/^CE-\d{6}-[A-Z0-9]{8}$/);
    expect(body.data.outcome).toBe('CONNECTED');
    expect(body.data.agentName).toBe('Agent One');
    expect(body.data.role).toBe('agent');
  });

  it('pins a non-manager event to their own email even if another is supplied', async () => {
    const res = await logCall(agentToken, { agentEmail: 'someoneelse@billfree.in' });
    expect(res.json().data.agentEmail).toBe('agent1@billfree.in');
  });

  it('lets a manager log on behalf of another agent', async () => {
    const res = await logCall(managerToken, { agentEmail: 'agent2@billfree.in' });
    expect(res.json().data.agentEmail).toBe('agent2@billfree.in');
  });

  it('rejects an unknown outcome with 400 + E004', async () => {
    const res = await app.inject({
      method: 'POST', url: '/calls', headers: auth(agentToken),
      payload: { ...validInput, outcome: 'TELEPORTED' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('[E004]');
  });
});

describe('listing + scoping', () => {
  beforeEach(async () => {
    await logCall(agentToken);
    await logCall(agent2Token);
  });

  it('scopes a plain agent to only their own events', async () => {
    const res = await app.inject({ method: 'GET', url: '/calls', headers: auth(agentToken) });
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].agentEmail).toBe('agent1@billfree.in');
    expect(body.meta.total).toBe(1);
  });

  it('lets a manager see every agent’s events', async () => {
    const res = await app.inject({ method: 'GET', url: '/calls', headers: auth(managerToken) });
    expect(res.json().meta.total).toBe(2);
  });

  it('filters by outcome and paginates', async () => {
    const res = await app.inject({
      method: 'GET', url: '/calls?outcome=CONNECTED&page=1&pageSize=10', headers: auth(managerToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().meta).toEqual({ total: 2, page: 1, limit: 10 });
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
void newCallEvent;
