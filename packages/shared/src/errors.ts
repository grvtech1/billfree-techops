/**
 * Canonical API error codes — mirrors `ERROR_CODES` in apps/gas/src/Code.gs.
 * The backend embeds these as `[E0NN]` prefixes in error messages; the web
 * client (apps/web/src/lib/api.ts) parses them back out. Keep both in sync.
 */
export const ERROR_CODES = {
  RATE_LIMITED: 'E001',
  UNAUTHORIZED: 'E002',
  NOT_FOUND: 'E003',
  VALIDATION_FAILED: 'E004',
  SHEET_ERROR: 'E005',
  LOCK_TIMEOUT: 'E006',
  INVALID_STATUS: 'E007',
  INSUFFICIENT_PERMISSIONS: 'E008',
  UNKNOWN_ERROR: 'E999',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Human-friendly fallback messages, keyed by code. */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  E001: 'Too many requests — please wait a moment and try again.',
  E002: 'You need to sign in to do that.',
  E003: 'That ticket could not be found.',
  E004: 'Some of the information provided is invalid.',
  E005: 'There was a problem reading the data sheet.',
  E006: 'The system is busy — please retry in a moment.',
  E007: 'That status value is not allowed.',
  E008: "You don't have permission to do that.",
  E999: 'Something went wrong. Please try again.',
};

/** Extract an `[E0NN]` code from a backend error string, defaulting to E999. */
export function parseErrorCode(message: string | undefined): ErrorCode {
  const m = message?.match(/\[E(\d{3})\]/);
  const code = m ? (`E${m[1]}` as ErrorCode) : 'E999';
  return code in ERROR_MESSAGES ? code : 'E999';
}
