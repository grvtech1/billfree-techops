import type { TicketDataResponse, MonthlyReport, AuditLogResponse } from '@billfree/web-core';

/** Error carrying the backend's `[E0NN]` code (GAS or gateway). */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * The data-access surface the app depends on. Two implementations satisfy it —
 * the legacy GAS client (`api.ts`) and the microservices gateway client
 * (`gateway.ts`) — selected at build time by `VITE_BACKEND`. The rest of the app
 * (hooks, store, views) is unaware of which backend is active.
 */
export interface BackendApi {
  getCSRFToken(token: string): Promise<{ success: boolean; token: string }>;
  getTicketData(token: string): Promise<TicketDataResponse>;
  updateFull(p: { ticketId: string; newStatus: string; newReason: string; csrfToken: string; token: string }): Promise<{ success: boolean; message?: string }>;
  updateStatus(p: { ticketId: string; newStatus: string; csrfToken: string; token: string }): Promise<{ success: boolean; message?: string }>;
  updatePOS(p: { ticketId: string; pos: string; csrfToken: string; token: string }): Promise<{ success: boolean; message?: string }>;
  appendReason(p: { ticketId: string; reason: string; csrfToken: string; token: string }): Promise<{ success: boolean; message?: string }>;
  createTicket(p: { data: unknown; csrfToken: string; token: string }): Promise<{ success: boolean; ticketId?: string }>;
  analytics(sub: string, token: string): Promise<{ success: boolean; data?: unknown }>;
  callHistory(filters: unknown, token: string): Promise<{ success: boolean; data?: unknown[]; pagination?: unknown }>;
  logCallEvent(data: unknown, csrfToken: string, token: string): Promise<{ success: boolean; eventId?: string }>;
  monthlyReport(p: { month: number; year: number; token: string }): Promise<{ success: boolean; report?: MonthlyReport; error?: string }>;
  updateHistory(p: { ticketId?: string; page?: number; pageSize?: number; token: string }): Promise<AuditLogResponse>;
  exportTickets(filters: unknown, csrfToken: string, token: string): Promise<{ success: boolean; csv?: string }>;
}

/** Which backend the build targets. */
export const BACKEND: 'gateway' | 'gas' =
  (import.meta.env.VITE_BACKEND as string) === 'gateway' ? 'gateway' : 'gas';

/** An empty audit-log response (used where the gateway has no equivalent endpoint). */
export function emptyAuditLogResponse(message: string): AuditLogResponse {
  return {
    success: true,
    data: [],
    pagination: { page: 1, pageSize: 50, totalRows: 0, totalPages: 0 },
    durationStats: { totalWithDuration: 0, avgHours: 0, fastCount: 0, normalCount: 0, slowCount: 0, criticalCount: 0 },
    message,
  };
}
