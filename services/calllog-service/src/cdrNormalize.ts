/**
 * [GAP-06] CDR outcome normalization — ported from GAS CallLog.gs normalizeProviderOutcome_().
 * Maps the wide variety of provider-specific outcome/status strings to the canonical
 * OUTCOMES vocabulary used by the dashboard's CallLogView.
 */
export function normalizeProviderOutcome(rawOutcome?: string, rawStatus?: string): string {
  const value = String(rawOutcome || rawStatus || '').trim().toLowerCase();
  if (!value) return 'OTHER';

  if (/connected|answered|completed|success|human/.test(value)) return 'CONNECTED';
  if (/no[\s_-]?answer|unanswered|ring[\s_-]?timeout/.test(value)) return 'NO_ANSWER';
  if (/busy/.test(value)) return 'BUSY';
  if (/switched[\s_-]?off|not[\s_-]?reachable|unreachable|power[\s_-]?off/.test(value)) return 'SWITCHED_OFF';
  if (/wrong[\s_-]?number|invalid[\s_-]?number/.test(value)) return 'WRONG_NUMBER';
  if (/callback/.test(value)) return 'CALLBACK_REQUESTED';
  if (/fail|error|cancel|rejected|blocked|missed/.test(value)) return 'FAILED';
  return 'OTHER';
}

/** Normalize a phone number: strip non-digit chars (keep leading +), cap at 20 chars. */
export function normalizePhone(value?: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const cleaned = raw.replace(/[^\d+]/g, '');
  return cleaned.substring(0, 20);
}

/** Sanitize a string: trim, collapse whitespace, cap length. */
export function sanitize(value: unknown, maxLength = 200): string {
  if (value == null) return '';
  return String(value).replace(/\s+/g, ' ').trim().substring(0, maxLength);
}
