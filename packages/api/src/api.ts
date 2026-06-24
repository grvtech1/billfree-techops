/// <reference types="vite/client" />
import type { TicketDataResponse, MonthlyReport, AuditLogResponse } from '@billfree/web-core';
import { ApiError, BACKEND, type BackendApi } from './apiClient';
import { gatewayApi, gatewayFetchVersion } from './gateway';

// ApiError is re-exported from the package barrel (src/index.ts), so existing
// imports (`from '@billfree/api'` / the `../lib/api` shim) keep resolving it.

// Defined at build time by Vite (vite.config.ts define: { __GAS_URL__ })
declare const __GAS_URL__: string;

const GAS_URL: string =
  (typeof __GAS_URL__ !== 'undefined' ? __GAS_URL__ : '') ||
  (import.meta.env.VITE_GAS_URL as string | undefined) ||
  '';

// ─── Mock data for dev/standalone mode ──────────────────────
const MOCK_TICKETS = Array.from({ length: 25 }, (_, i) => {
  const STATUS_CYCLE = [
    'Not Completed', 'Completed', 'Pending', 'Closed',
    'In Progress', 'Completed', "Can't Do", 'Completed',
  ] as const;
  const AGE_CYCLE = [0, 2, 5, 1, 8, 3, 12, 0, 18, 4, 7, 2, 15, 6, 1, 9];
  const agents    = ['Suraj', 'Veer Bahadur', 'Neeraj Kumar', 'Admin'];
  const agEmails  = ['suraj.billfree2@gmail.com', 'veer.billfree@gmail.com', 'neerajkumar.billfree@gmail.com', 'gaurav.pal@billfree.in'];
  const concerns  = ['Internet Issue', 'POS Integration', 'Settlement', 'Onboarding', 'Hardware Failure', 'EDC Machine Issue'];
  const bizz      = ['Green Merchants', 'Sunrise Traders', 'City Mart', 'Bharat Stores', 'Metro Hub', 'Pearl Retail'];
  const poses     = ['Tally', 'GoFrugal', 'Petpooja', 'Marg', 'Android POS', 'EDC Standalone'];
  const types     = ['Customer Support', 'IT Floor', 'Floor', 'FOS'];
  const ageDays   = AGE_CYCLE[i % AGE_CYCLE.length];
  const status    = STATUS_CYCLE[i % STATUS_CYCLE.length];
  const dMs       = Date.now() - ageDays * 86_400_000;
  const d         = new Date(dMs);
  const dd        = String(d.getDate()).padStart(2, '0');
  const mm        = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy      = d.getFullYear();
  const reason    = status === 'Completed' || status === 'Closed'
    ? `[${dd}-${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]}-${yyyy} 10:00] Issue resolved`
    : '';
  return {
    id:           `BF-TKT-2026-02-${String(i + 1).padStart(4, '0')}`,
    date:         `${dd}-${mm}-${yyyy}`,
    sortDate:     dMs,
    lastUpdatedMs: dMs,
    ageDays,
    ageCategory:  ageDays >= 15 ? 'critical' : ageDays >= 8 ? 'old' : ageDays >= 4 ? 'aging' : 'fresh',
    hourIST:      10,
    email:        agEmails[i % 4],
    agent:        agents[i % 4],
    requestedBy:  'Branch',
    mid:          String(100_000 + i * 7),
    business:     bizz[i % bizz.length],
    pos:          poses[i % poses.length],
    supportType:  types[i % types.length],
    concern:      concerns[i % concerns.length],
    phone:        `9876500${String(i).padStart(4, '0')}`,
    phoneDisplay: `+91 98765 0${String(i).padStart(4, '0')}`,
    status,
    reasonQuality: reason ? 'detailed' : 'none',
    reason,
    remark:       '',
    // Demo a mix of origin channels so the channel badge is visible in mock mode.
    source:       i % 5 === 0 ? 'whatsapp' : i % 7 === 0 ? 'portal' : 'dashboard',
    rowIndex:     i + 2,
  };
});

function mockTicketData(): TicketDataResponse {
  return {
    success: true,
    tickets: MOCK_TICKETS as unknown as TicketDataResponse['tickets'],
    directory: {},
    version: 1,
    cacheStatus: 'MOCK',
  };
}

// ─── Core POST wrapper ───────────────────────────────────────
/**
 * All authenticated API calls go through here.
 * Content-Type MUST be 'text/plain' — GAS doPost() parses the
 * raw body via e.postData.contents, not as multipart/form-data.
 */
async function post<T>(
  action: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  // Dev / no GAS_URL: return mock data
  if (!GAS_URL) {
    return resolveMock<T>(action, params);
  }

  const body = JSON.stringify({ action, ...params });
  const res  = await fetch(GAS_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'text/plain' },
    body,
  });

  if (!res.ok) throw new ApiError('E999', `HTTP ${res.status}`);

  const json = (await res.json()) as { success: boolean; error?: string } & T;
  if (!json.success) {
    const code = json.error?.match(/\[E(\d{3})\]/)?.[0]?.slice(1, 5) ?? 'E999';
    throw new ApiError(code, json.error ?? 'Unknown error');
  }
  return json;
}

// ─── Mock resolver (used when GAS_URL is not configured) ─────
function resolveMock<T>(action: string, _params: Record<string, unknown>): T {
  switch (action.toLowerCase()) {
    case 'getticketdata':
      return mockTicketData() as unknown as T;
    case 'getcsrftoken':
      return { success: true, token: `DEMO-CSRF-${Date.now()}` } as unknown as T;
    case 'updateticketfull':
    case 'updateticketstatus':
    case 'updateticketpos':
    case 'appendreason':
    case 'createticketauth':
      return { success: true, message: 'Demo mode — not persisted' } as unknown as T;
    case 'getanalytics':
      return { success: true, data: [] } as unknown as T;
    case 'getcallhistory':
      return { success: true, data: [], pagination: { page: 1, pageSize: 25, totalRows: 0, totalPages: 0 } } as unknown as T;
    default:
      return { success: true, data: null } as unknown as T;
  }
}

// ─── Identity (GET request) ──────────────────────────────────
export async function fetchIdentity(idToken: string): Promise<{
  success: boolean;
  email?: string;
  name?: string;
  role?: string;
  isAdmin?: boolean;
  token?: string;
  agents?: unknown[];
  trustedOrigins?: string[];
  error?: string;
}> {
  if (!GAS_URL) {
    return {
      success: true, email: 'demo@billfree.in', name: 'Demo User',
      role: 'admin', isAdmin: true, token: 'DEMO-TOKEN', agents: [], trustedOrigins: [],
    };
  }
  const url = new URL(GAS_URL);
  url.searchParams.set('action', 'identity');
  if (idToken) url.searchParams.set('token', idToken);
  const res  = await fetch(url.toString());
  return res.json();
}

// ─── Version check (GET request) ─────────────────────────────
async function gasFetchVersion(): Promise<number> {
  if (!GAS_URL) return 1;
  const url = new URL(GAS_URL);
  url.searchParams.set('action', 'version');
  const res  = await fetch(url.toString());
  const json = await res.json();
  return (json.version as number) ?? 0;
}

// ─── Client error reporting (best-effort, never throws) ──────
/**
 * Sends an unhandled client error to the GAS backend (`logclienterror` action).
 * Fire-and-forget: failures here must never cascade into more errors, so it
 * swallows everything. No-ops (console only) in mock/dev mode (no GAS_URL).
 */
export function reportClientError(context: string, message: string, stack?: string): void {
  if (!GAS_URL) {
    console.error(`[client-error] ${context}: ${message}`);
    return;
  }
  try {
    const body = JSON.stringify({
      action: 'logclienterror',
      context,
      message,
      stack: stack ?? '',
      url: typeof location !== 'undefined' ? location.href : '',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    });
    // keepalive lets the request survive a page unload / crash.
    void fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* never throw from the error reporter */
  }
}

// ─── GAS api.* surface ───────────────────────────────────────
const gasApi: BackendApi = {
  getCSRFToken: (token: string) =>
    post<{ success: boolean; token: string }>('getCSRFToken', { token }),

  getTicketData: (token: string) =>
    post<TicketDataResponse>('getTicketData', { token }),

  updateFull: (p: {
    ticketId: string; newStatus: string; newReason: string;
    csrfToken: string; token: string;
  }) => post<{ success: boolean; message?: string }>('updateTicketFull', p),

  updateStatus: (p: {
    ticketId: string; newStatus: string;
    csrfToken: string; token: string;
  }) => post<{ success: boolean; message?: string }>('updateTicketStatus', p),

  updatePOS: (p: {
    ticketId: string; pos: string;
    csrfToken: string; token: string;
  }) => post<{ success: boolean; message?: string }>('updateTicketPOS', p),

  appendReason: (p: {
    ticketId: string; reason: string;
    csrfToken: string; token: string;
  }) => post<{ success: boolean; message?: string }>('appendReason', p),

  createTicket: (p: {
    data: unknown; csrfToken: string; token: string;
  }) => post<{ success: boolean; ticketId?: string }>('createTicketAuth', p),

  analytics: (sub: string, token: string) =>
    post<{ success: boolean; data?: unknown }>('getAnalytics', { sub, token }),

  callHistory: (filters: unknown, token: string) =>
    post<{ success: boolean; data?: unknown[]; pagination?: unknown }>(
      'getCallHistory', { filters, token }
    ),

  logCallEvent: (data: unknown, csrfToken: string, token: string) =>
    post<{ success: boolean; eventId?: string }>('logCallEvent', { data, csrfToken, token }),

  monthlyReport: (p: { month: number; year: number; token: string }) =>
    post<{ success: boolean; report: MonthlyReport; error?: string }>(
      'getMonthlyReport',
      { config: { month: p.month, year: p.year, idToken: p.token }, token: p.token }
    ),

  updateHistory: (p: { ticketId?: string; page?: number; pageSize?: number; token: string }) =>
    post<AuditLogResponse>('getUpdateHistory', {
      ticketId: p.ticketId || '',
      page: p.page || 1,
      pageSize: p.pageSize || 50,
      token: p.token,
    }),

  exportTickets: (filters: unknown, csrfToken: string, token: string) =>
    post<{ success: boolean; csv?: string }>('exportTickets', { filters, csrfToken, token }),
};

// ─── Backend selection ───────────────────────────────────────
// The whole app imports `api` / `fetchVersion` from here; which implementation
// they resolve to is decided once, at build time, by VITE_BACKEND.
export const api: BackendApi = BACKEND === 'gateway' ? gatewayApi : gasApi;
export const fetchVersion: () => Promise<number> =
  BACKEND === 'gateway' ? gatewayFetchVersion : gasFetchVersion;
