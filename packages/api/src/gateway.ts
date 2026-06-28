/// <reference types="vite/client" />
import type {
  RawTicket,
  TicketDataResponse,
  CreateTicketPayload,
  AppUser,
  CallEvent,
  AuditLogEntry,
  AuditLogResponse,
  MonthlyReport,
} from '@billfree/web-core';
import { ApiError, emptyAuditLogResponse, type BackendApi } from './apiClient';

// Gateway base URL. Empty → relative paths (the web container's nginx proxies
// /api and /auth to the gateway). For `npm run dev`, set VITE_GATEWAY_URL to the
// gateway origin, e.g. http://localhost:8080.
const BASE: string = (import.meta.env.VITE_GATEWAY_URL as string | undefined) ?? '';

/** Ticket as returned by ticket-service (apps/gas → re-platformed shape). */
interface GatewayTicket {
  id: string;
  createdAt: string;
  agentEmail: string;
  itEmail: string | null;
  requestedBy: string;
  mid: string;
  business: string;
  pos: string;
  supportType: string;
  concern: string;
  configNotes: string | null;
  remark: string | null;
  status: string;
  reason: string;
  phone: string | null;
  source?: string;
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: { total: number; page: number; limit: number };
}

async function gwFetch<T>(
  path: string,
  opts: { method?: string; token?: string; body?: unknown } = {},
): Promise<Envelope<T>> {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  let json: Envelope<T>;
  try {
    json = (await res.json()) as Envelope<T>;
  } catch {
    throw new ApiError('E999', `HTTP ${res.status}`);
  }
  if (!res.ok || !json.success) {
    const code = json.error?.match(/\[E(\d{3})\]/)?.[0]?.slice(1, 5) ?? 'E999';
    throw new ApiError(code, json.error ?? `HTTP ${res.status}`);
  }
  return json;
}

/** Map a gateway Ticket into the RawTicket shape the store's normaliser expects. */
export function gatewayTicketToRaw(t: GatewayTicket): RawTicket {
  const sortDate = Date.parse(t.createdAt) || 0;
  return {
    id: t.id,
    sortDate,
    email: t.agentEmail,
    agent: t.agentEmail, // canonical-agent-key collapses email→name downstream
    requestedBy: t.requestedBy,
    mid: t.mid,
    business: t.business,
    pos: t.pos,
    supportType: t.supportType,
    concern: t.concern,
    phone: t.phone ?? '',
    status: t.status,
    reason: t.reason,
    remark: t.remark ?? '',
    source: t.source ?? 'dashboard',
  };
}

/** Fetch every ticket page (the gateway caps pageSize at 200). */
async function fetchAllTickets(token: string): Promise<GatewayTicket[]> {
  const pageSize = 200;
  const first = await gwFetch<GatewayTicket[]>(`/api/tickets?page=1&pageSize=${pageSize}`, { token });
  const all = first.data ?? [];
  const total = first.meta?.total ?? all.length;
  const pages = Math.ceil(total / pageSize);

  // [GAP-19] Fetch remaining pages in parallel instead of serial.
  // For 5,000 tickets this reduces wall-clock time ~5× (25 sequential RTTs → 5 batches).
  if (pages > 1) {
    const remaining = Array.from({ length: pages - 1 }, (_, i) => i + 2);
    const results = await Promise.all(
      remaining.map((page) =>
        gwFetch<GatewayTicket[]>(`/api/tickets?page=${page}&pageSize=${pageSize}`, { token }),
      ),
    );
    for (const res of results) all.push(...(res.data ?? []));
  }
  return all;
}

/** Call event as returned by calllog-service. */
interface GatewayCallEvent {
  eventId: string;
  createdAt: string;
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

/** Mask all but the last 4 digits of a phone number for display. */
function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 4 ? `••••${digits.slice(-4)}` : phone;
}

/** Map a calllog-service event into the CallEvent shape CallLogView renders. */
export function gatewayCallToEvent(e: GatewayCallEvent): CallEvent {
  const ms = Date.parse(e.createdAt) || 0;
  const phone = e.customerPhone ?? '';
  return {
    timestamp: ms ? new Date(ms).toLocaleString() : e.createdAt,
    timestampMs: ms,
    eventId: e.eventId,
    ticketId: e.ticketId ?? '',
    mid: e.mid ?? '',
    business: e.business ?? '',
    customerPhone: phone,
    customerPhoneDisplay: phone ? maskPhone(phone) : '',
    agentEmail: e.agentEmail,
    agentName: e.agentName ?? e.agentEmail,
    role: e.role ?? '',
    eventType: e.eventType,
    outcome: e.outcome,
    durationSec: e.durationSec,
    channel: e.channel ?? '',
    provider: e.provider ?? '',
    providerCallId: e.providerCallId ?? '',
    source: e.source ?? '',
    notes: e.notes ?? '',
    verified: e.verified ? 'YES' : 'NO',
  };
}

export const gatewayApi: BackendApi = {
  // JWT replaces CSRF — return a sentinel so the withCSRF() wrapper is a no-op.
  getCSRFToken: async () => ({ success: true, token: 'jwt' }),

  getTicketData: async (token) => {
    const tickets = (await fetchAllTickets(token)).map(gatewayTicketToRaw);
    return {
      success: true,
      tickets,
      directory: {},
      version: 1, // gateway has no version counter; polling is a benign no-op
      cacheStatus: 'GATEWAY',
    } as TicketDataResponse;
  },

  updateFull: async ({ ticketId, newStatus, newReason, token }) => {
    const body: Record<string, string> = {};
    if (newStatus) body.status = newStatus;
    if (newReason && newReason.trim()) body.appendReason = newReason.trim();
    await gwFetch(`/api/tickets/${encodeURIComponent(ticketId)}`, { method: 'PATCH', token, body });
    return { success: true, message: 'Ticket updated' };
  },

  updateStatus: async ({ ticketId, newStatus, token }) => {
    await gwFetch(`/api/tickets/${encodeURIComponent(ticketId)}`, { method: 'PATCH', token, body: { status: newStatus } });
    return { success: true, message: 'Status updated' };
  },

  updatePOS: async ({ ticketId, pos, token }) => {
    await gwFetch(`/api/tickets/${encodeURIComponent(ticketId)}`, { method: 'PATCH', token, body: { pos } });
    return { success: true, message: 'POS updated' };
  },

  appendReason: async ({ ticketId, reason, token }) => {
    await gwFetch(`/api/tickets/${encodeURIComponent(ticketId)}`, { method: 'PATCH', token, body: { appendReason: reason } });
    return { success: true, message: 'Reason added' };
  },

  createTicket: async ({ data, token }) => {
    const d = data as CreateTicketPayload;
    const body = {
      agentEmail: d.agentEmail,
      requestedBy: d.requestedBy,
      mid: d.mid,
      business: d.business,
      pos: d.pos,
      supportType: d.supportType,
      concern: d.concern,
      remark: d.remark || undefined,
      phone: d.phone || undefined,
    };
    const res = await gwFetch<GatewayTicket>('/api/tickets', { method: 'POST', token, body });
    return { success: true, ticketId: res.data?.id };
  },

  // [GAP-16] Analytics — all 6 sub-endpoints now dispatch to analytics-service.
  analytics: async (sub, token) => {
    const routeMap: Record<string, string> = {
      toppos: '/api/analytics/top-pos?limit=10',
      topmidssame: '/api/analytics/top-mids-same?limit=10',
      topmidsdiff: '/api/analytics/top-mids-diff?limit=10',
      repeatcustomers: '/api/analytics/repeat-customers?limit=10',
      concerntrend: '/api/analytics/concern-trend',
      agentmatrix: '/api/analytics/agent-matrix',
    };
    const endpoint = routeMap[sub.toLowerCase()];
    if (!endpoint) return { success: true, data: [] };
    const res = await gwFetch<unknown>(endpoint, { token });
    return { success: true, data: res.data };
  },

  // Call log — served by calllog-service via /api/calls.
  callHistory: async (filters, token) => {
    const f = (filters ?? {}) as {
      page?: number; pageSize?: number; ticketId?: string; mid?: string;
      agentEmail?: string; eventType?: string; outcome?: string;
    };
    const qs = new URLSearchParams();
    qs.set('page', String(f.page ?? 1));
    qs.set('pageSize', String(f.pageSize ?? 50));
    for (const k of ['ticketId', 'mid', 'agentEmail', 'eventType', 'outcome'] as const) {
      const v = f[k];
      if (v && v !== 'all') qs.set(k, String(v));
    }
    const res = await gwFetch<GatewayCallEvent[]>(`/api/calls?${qs.toString()}`, { token });
    const data = (res.data ?? []).map(gatewayCallToEvent);
    const total = res.meta?.total ?? data.length;
    const pageSize = res.meta?.limit ?? f.pageSize ?? 50;
    const page = res.meta?.page ?? f.page ?? 1;
    return {
      success: true,
      data,
      pagination: { page, pageSize, totalRows: total, totalPages: Math.ceil(total / pageSize) },
    };
  },
  logCallEvent: async (data, _csrf, token) => {
    const res = await gwFetch<GatewayCallEvent>('/api/calls', { method: 'POST', token, body: data });
    return { success: true, eventId: res.data?.eventId };
  },

  // Per-ticket audit trail — ticket-service GET /tickets/:id/history.
  updateHistory: async ({ ticketId, page, pageSize, token }) => {
    if (!ticketId) return emptyAuditLogResponse('Select a ticket to view its audit trail.');
    const qs = new URLSearchParams({ page: String(page ?? 1), pageSize: String(pageSize ?? 20) });
    // The endpoint already returns the AuditLogResponse shape (data + pagination
    // + durationStats); gwFetch validates success/error and passes it through.
    const res = await gwFetch<AuditLogEntry[]>(
      `/api/tickets/${encodeURIComponent(ticketId)}/history?${qs.toString()}`,
      { token },
    );
    return res as unknown as AuditLogResponse;
  },

  // Monthly operations report — report-service GET /reports/monthly.
  monthlyReport: async ({ month, year, token }) => {
    // report-service returns { success, report }; gwFetch validates success and
    // passes the whole object through (the report sits alongside, not under data).
    const res = await gwFetch<MonthlyReport>(`/api/reports/monthly?month=${month}&year=${year}`, { token });
    const report = (res as unknown as { report?: MonthlyReport }).report ?? res.data;
    return { success: true, report };
  },

  // Trigger monthly email report dispatch — report-service POST /reports/monthly/email.
  emailMonthlyReport: async ({ month, year, recipients, token }) => {
    const res = await gwFetch<{ message: string; mode: string; html?: string; aiError?: string }>(
      '/api/reports/monthly/email',
      {
        method: 'POST',
        token,
        body: { month, year, recipients },
      },
    );
    // gwFetch guarantees success===true, but not that `data` is populated; guard
    // rather than assert so a malformed envelope surfaces a clear error.
    if (!res.data) throw new ApiError('E999', 'Email report returned no data');
    return {
      success: true,
      message: res.data.message,
      mode: res.data.mode,
      html: res.data.html,
      error: res.data.aiError,
    };
  },


  // [GAP-18] exportTickets stays client-side (MasterDb view builds the CSV from store data).
  // Return success: true so the client-side CSV builder path is triggered correctly.
  exportTickets: async () => ({ success: true }),
};

/** Exchange an email for a JWT + identity (auth-service via the gateway). */
export async function gatewayLogin(
  email: string,
  name?: string,
): Promise<{ token: string; user: AppUser }> {
  const res = await gwFetch<{ token: string; user: { sub: string; name: string; role: string } }>(
    '/auth/token',
    { method: 'POST', body: { email, ...(name ? { name } : {}) } },
  );
  if (!res.data?.token || !res.data.user) {
    throw new ApiError('E999', 'Login response missing token or user');
  }
  const { token, user: u } = res.data;
  return {
    token,
    user: {
      email: u.sub,
      name: u.name,
      token,
      role: u.role as AppUser['role'],
      isAdmin: u.role === 'admin',
    },
  };
}

/** [GAP-20] Fetch the data version from ticket-service (replaces constant-1 stub). */
export async function gatewayFetchVersion(): Promise<number> {
  try {
    const res = await gwFetch<{ version: number }>('/api/tickets/version');
    return res.data?.version ?? 0;
  } catch {
    // Non-fatal — if polling fails, the SPA simply won't auto-refresh.
    return 0;
  }
}

/**
 * [GAP-04] Fetch the agent directory from auth-service via the gateway.
 * Requires a bearer token — the endpoint is authenticated (it exposes agent PII).
 */
export async function gatewayFetchAgents(
  token: string,
): Promise<Array<{ name: string; email: string; role: string }>> {
  const res = await gwFetch<{ agents: Array<{ name: string; email: string; role: string }>; count: number }>(
    '/auth/agents',
    { token },
  );
  return res.data?.agents ?? [];
}
