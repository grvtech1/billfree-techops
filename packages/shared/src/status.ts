/**
 * Canonical ticket statuses — the SINGLE SOURCE OF TRUTH shared by the web SPA
 * and the GAS backend (`STATUS_ENUM` in apps/gas/src/Code.gs). These string
 * values are written into the Google Sheet verbatim, so they must never diverge
 * between frontend and backend. If you change one, change both.
 */
export const STATUSES = [
  'Not Completed',
  'Pending',
  'In Progress',
  'Completed',
  'Closed',
  "Can't Do",
] as const;

export type Status = (typeof STATUSES)[number];

/** Type guard for untrusted input (API responses, sheet cells). */
export function isStatus(value: unknown): value is Status {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}
