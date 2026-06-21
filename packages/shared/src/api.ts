/**
 * The HTTP contract between the web SPA and the GAS backend.
 *
 * Transport: the SPA POSTs `{ action, ...params }` as `text/plain` to the GAS
 * web-app URL (GAS parses `e.postData.contents`). Identity and version are GET
 * requests with `?action=`. The backend router lives in apps/gas/src/Code.gs
 * (`doPost` / `doGet`); every action string below maps to a handler there.
 */

/** POST actions (authenticated SPA + portal + external API + telephony CDR). */
export const POST_ACTIONS = [
  'getticketdata',
  'getcsrftoken',
  'updateticketfull',
  'updateticketstatus',
  'updateticketpos',
  'appendreason',
  'createticketauth',
  'getanalytics',
  'getcallhistory',
  'logcallevent',
  'getmonthlyreport',
  'getupdatehistory',
  'exporttickets',
  'logclienterror', // SPA ErrorBoundary → backend audit log
  'createticket', // external API (api-key auth)
  'portal_create', // public portal
  'portal_lookup', // public portal
  'provider_cdr', // telephony webhook
] as const;

/** GET actions (served by doGet). */
export const GET_ACTIONS = ['identity', 'version'] as const;

export type PostAction = (typeof POST_ACTIONS)[number];
export type GetAction = (typeof GET_ACTIONS)[number];
export type ApiAction = PostAction | GetAction;

/**
 * Canonical success/error envelope. The backend normalizes every handler return
 * through `parseResult_` (apps/gas/src/Platform.gs) into this shape; the client
 * branches on `.success`.
 */
export interface ApiEnvelope<T = unknown> {
  success: boolean;
  data?: T | null;
  error?: string;
  meta?: { total: number; page: number; limit: number };
}
