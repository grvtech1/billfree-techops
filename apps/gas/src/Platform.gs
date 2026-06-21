/**
 * ════════════════════════════════════════════════════════════════════════
 *  PLATFORM UTILITIES   (extracted module)
 * ════════════════════════════════════════════════════════════════════════
 * Cross-cutting, dependency-free helpers shared across the app: the canonical
 * API response envelope + boundary normalizer, and best-effort metrics.
 *
 * Extracted from Code.gs. In Google Apps Script all .gs files share ONE global
 * namespace, so okResult_(), parseResult_(), incrementMetric_(), etc. remain
 * callable from any file unchanged. These functions touch only CacheService at
 * call time and have no top-level dependencies, so they are load-order safe in
 * any file position.
 *
 * ── API CONTRACT ─────────────────────────────────────────────────────────
 * The codebase historically mixed return types — some handlers return a JSON
 * string, some a plain object — which forced doPost to repeat
 * `typeof x === 'string' ? JSON.parse(x) : x` at every route. okResult_/
 * errResult_ make the contract explicit; parseResult_ is the single safe
 * boundary normalizer doPost now uses.
 *
 * ── OBSERVABILITY ────────────────────────────────────────────────────────
 * incrementMetric_/getMetric_ are best-effort event counters backed by
 * ScriptCache — no sheet write on the hot path, strictly non-fatal (observability
 * must never break the request it observes). For volume signals (tickets
 * created, schema drift, rate-limit hits).
 */

// Canonical success envelope. `extra` merges in meta (e.g. pagination).
function okResult_(data, extra) {
  return Object.assign({ success: true, data: data === undefined ? null : data }, extra || {});
}

// Canonical error envelope. Mirrors the success shape so callers branch on .success only.
function errResult_(error, extra) {
  return Object.assign({ success: false, error: String(error || 'Unknown error'), data: null }, extra || {});
}

/**
 * Normalize ANY handler return — JSON string OR object — into a plain object.
 * Single replacement for the scattered `typeof x === 'string' ? JSON.parse(x) : x`.
 * Never throws: malformed JSON or unexpected types become a clean error envelope
 * instead of bubbling an exception out of the request boundary.
 */
function parseResult_(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') {
    return { success: false, error: 'Handler returned a non-serializable result', data: null };
  }
  try {
    return JSON.parse(value);
  } catch (e) {
    return { success: false, error: 'Handler returned malformed JSON', data: null };
  }
}

function incrementMetric_(name, by) {
  try {
    const cache = CacheService.getScriptCache();
    const key = 'METRIC_' + String(name);
    const current = parseInt(cache.get(key) || '0', 10) || 0;
    const next = current + (Number(by) || 1);
    cache.put(key, String(next), 21600); // ~6h rolling window
    return next;
  } catch (e) {
    return null;
  }
}

function getMetric_(name) {
  try {
    return parseInt(CacheService.getScriptCache().get('METRIC_' + String(name)) || '0', 10) || 0;
  } catch (e) {
    return 0;
  }
}
