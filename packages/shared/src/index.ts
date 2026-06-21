/**
 * @billfree/shared — the cross-cutting contract shared by the web SPA and the
 * GAS backend. Import the canonical statuses, error codes, and API actions from
 * here instead of redefining them per app, so the two halves cannot drift.
 */
export * from './status.js';
export * from './errors.js';
export * from './api.js';
