import { describe, it, expect, vi, beforeEach } from 'vitest';
import { gatewayApi, gatewayTicketToRaw, gatewayCallToEvent, gatewayLogin } from '@billfree/api';

const gwTicket = {
  id: 'BF-1',
  createdAt: '2026-06-01T10:00:00.000Z',
  agentEmail: 'agent1@billfree.in',
  itEmail: null,
  requestedBy: 'Branch',
  mid: '100',
  business: 'Green Mart',
  pos: 'Tally',
  supportType: 'Customer Support',
  concern: 'POS issue',
  configNotes: null,
  remark: null,
  status: 'Completed',
  reason: 'done',
  phone: '9990001111',
  source: 'whatsapp',
};

function mockFetch(body: unknown, ok = true, status = 200) {
  const fn = vi.fn().mockResolvedValue({ ok, status, json: async () => body });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

beforeEach(() => vi.restoreAllMocks());

describe('gatewayTicketToRaw', () => {
  it('maps a gateway ticket into the RawTicket shape', () => {
    const r = gatewayTicketToRaw(gwTicket);
    expect(r.id).toBe('BF-1');
    expect(r.email).toBe('agent1@billfree.in');
    expect(r.sortDate).toBe(Date.parse('2026-06-01T10:00:00.000Z'));
    expect(r.status).toBe('Completed');
    expect(r.pos).toBe('Tally');
    expect(r.phone).toBe('9990001111');
    expect(r.source).toBe('whatsapp');
  });

  it('defaults source to dashboard when the gateway omits it', () => {
    const { source, ...noSource } = gwTicket;
    void source;
    expect(gatewayTicketToRaw(noSource).source).toBe('dashboard');
  });
});

describe('gatewayApi', () => {
  it('getTicketData fetches + adapts tickets', async () => {
    mockFetch({ success: true, data: [gwTicket], meta: { total: 1, page: 1, limit: 200 } });
    const res = await gatewayApi.getTicketData('jwt');
    expect(res.success).toBe(true);
    expect(res.tickets).toHaveLength(1);
    expect(res.tickets[0].id).toBe('BF-1');
    expect(res.cacheStatus).toBe('GATEWAY');
  });

  it('updateStatus issues a PATCH with Bearer auth + status body', async () => {
    const f = mockFetch({ success: true, data: gwTicket });
    await gatewayApi.updateStatus({
      ticketId: 'BF-1',
      newStatus: 'Completed',
      csrfToken: '',
      token: 'jwt',
    });
    const [url, opts] = f.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/api/tickets/BF-1');
    expect(opts.method).toBe('PATCH');
    expect((opts.headers as Record<string, string>).authorization).toBe('Bearer jwt');
    expect(JSON.parse(opts.body as string)).toEqual({ status: 'Completed' });
  });

  it('updatePOS sends the pos field', async () => {
    const f = mockFetch({ success: true, data: gwTicket });
    await gatewayApi.updatePOS({ ticketId: 'BF-1', pos: 'GoFrugal', csrfToken: '', token: 'jwt' });
    expect(JSON.parse((f.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      pos: 'GoFrugal',
    });
  });

  it('parses the [E0NN] code into an ApiError on failure', async () => {
    mockFetch({ success: false, error: '[E008] forbidden' }, false, 403);
    await expect(gatewayApi.getTicketData('jwt')).rejects.toMatchObject({ code: 'E008' });
  });

  it('getCSRFToken is a no-op sentinel (gateway uses JWT)', async () => {
    const res = await gatewayApi.getCSRFToken('jwt');
    expect(res.success).toBe(true);
  });
});

const gwCall = {
  eventId: 'CE-202606-ABCD1234',
  createdAt: '2026-06-01T10:05:00.000Z',
  ticketId: 'BF-1',
  mid: '100',
  business: 'Green Mart',
  customerPhone: '9990001111',
  agentEmail: 'agent1@billfree.in',
  agentName: 'Agent One',
  role: 'agent',
  eventType: 'CALL_COMPLETED',
  outcome: 'CONNECTED',
  durationSec: 142,
  channel: 'voice',
  provider: 'demo',
  providerCallId: null,
  source: 'dashboard',
  notes: null,
  verified: true,
};

describe('gatewayCallToEvent', () => {
  it('adapts a call event + masks the phone + maps verified→YES', () => {
    const e = gatewayCallToEvent(gwCall);
    expect(e.eventId).toBe('CE-202606-ABCD1234');
    expect(e.outcome).toBe('CONNECTED');
    expect(e.durationSec).toBe(142);
    expect(e.customerPhoneDisplay).toBe('••••1111');
    expect(e.verified).toBe('YES');
    expect(e.timestampMs).toBe(Date.parse('2026-06-01T10:05:00.000Z'));
  });
});

describe('gatewayApi call log', () => {
  it('callHistory fetches /api/calls + adapts events + computes pagination', async () => {
    const f = mockFetch({ success: true, data: [gwCall], meta: { total: 1, page: 1, limit: 50 } });
    const res = await gatewayApi.callHistory({ page: 1, pageSize: 50, outcome: 'all' }, 'jwt');
    const [url] = f.mock.calls[0] as [string];
    expect(String(url)).toContain('/api/calls?');
    expect(String(url)).not.toContain('outcome=all'); // 'all' is dropped
    expect(res.success).toBe(true);
    expect(res.data as unknown[]).toHaveLength(1);
    expect((res.pagination as { totalRows: number }).totalRows).toBe(1);
  });

  it('logCallEvent POSTs the payload and returns the new eventId', async () => {
    const f = mockFetch({ success: true, data: gwCall });
    const res = await gatewayApi.logCallEvent(
      {
        eventType: 'CALL_COMPLETED',
        outcome: 'CONNECTED',
        durationSec: '142',
        agentEmail: 'agent1@billfree.in',
      },
      '',
      'jwt',
    );
    const [url, opts] = f.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/api/calls');
    expect(opts.method).toBe('POST');
    expect(res.eventId).toBe('CE-202606-ABCD1234');
  });
});

describe('gatewayApi updateHistory', () => {
  it('returns an empty response without a network call when no ticketId is given', async () => {
    const f = mockFetch({});
    const res = await gatewayApi.updateHistory({ token: 'jwt' });
    expect(f).not.toHaveBeenCalled();
    expect(res.data).toHaveLength(0);
    expect(res.durationStats.totalWithDuration).toBe(0);
  });

  it('fetches /api/tickets/:id/history and passes the audit response through', async () => {
    const f = mockFetch({
      success: true,
      data: [
        {
          rowNum: 1,
          action: 'TICKET_UPDATED',
          previousStatus: 'Not Completed',
          newStatus: 'Completed',
        },
      ],
      pagination: { page: 1, pageSize: 20, totalRows: 1, totalPages: 1 },
      durationStats: {
        totalWithDuration: 1,
        avgHours: 1,
        fastCount: 1,
        normalCount: 0,
        slowCount: 0,
        criticalCount: 0,
      },
    });
    const res = await gatewayApi.updateHistory({
      ticketId: 'BF-1',
      page: 1,
      pageSize: 20,
      token: 'jwt',
    });
    const [url] = f.mock.calls[0] as [string];
    expect(String(url)).toContain('/api/tickets/BF-1/history');
    expect(res.data).toHaveLength(1);
    expect(res.pagination.totalRows).toBe(1);
    expect(res.durationStats.totalWithDuration).toBe(1);
  });
});

describe('gatewayApi monthlyReport', () => {
  it('fetches /api/reports/monthly and unwraps { report }', async () => {
    const report = { title: 'June 2026 — Operations Report', summary: { totalTickets: 5 } };
    const f = mockFetch({ success: true, report });
    const res = await gatewayApi.monthlyReport({ month: 6, year: 2026, token: 'jwt' });
    const [url] = f.mock.calls[0] as [string];
    expect(String(url)).toContain('/api/reports/monthly?month=6&year=2026');
    expect(res.success).toBe(true);
    expect(res.report?.title).toContain('June 2026');
  });

  it('surfaces an [E0NN] error as an ApiError', async () => {
    mockFetch({ success: false, error: '[E004] bad month' }, false, 400);
    await expect(
      gatewayApi.monthlyReport({ month: 13, year: 2026, token: 'jwt' }),
    ).rejects.toMatchObject({ code: 'E004' });
  });
});

describe('gatewayLogin', () => {
  it('exchanges an email for a token + user', async () => {
    mockFetch({
      success: true,
      data: {
        token: 'jwt-123',
        user: { sub: 'agent1@billfree.in', name: 'Agent One', role: 'agent' },
      },
    });
    const { token, user } = await gatewayLogin('agent1@billfree.in');
    expect(token).toBe('jwt-123');
    expect(user.email).toBe('agent1@billfree.in');
    expect(user.role).toBe('agent');
    expect(user.isAdmin).toBe(false);
  });
});
