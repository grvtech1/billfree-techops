/**
 * ════════════════════════════════════════════════════════════════════════
 *  SHEET SCHEMA GUARD  [DATA-INTEGRITY — P0]   (extracted module)
 * ════════════════════════════════════════════════════════════════════════
 * Extracted from Code.gs as the first step of decomposing the monolith. In
 * Google Apps Script all .gs files share ONE global namespace, so these
 * functions remain callable from Code.gs exactly as before — no import needed.
 *
 * IMPORTANT (why this module is load-order safe): GAS evaluates top-level
 * `const`/`let` at load time, and cross-file references at that point hit a
 * temporal-dead-zone error if files load in the wrong order. This module
 * therefore has ZERO top-level dependency on CONFIG — the column labels are
 * built lazily inside getTicketColumnLabels_(), not as a top-level const. It
 * can sit in any file, in any load order, safely.
 *
 * ── What it does ─────────────────────────────────────────────────────────
 * The read/write path trusts CONFIG.COLS column positions. The DB is a
 * hand-editable Google Sheet, so a single inserted / deleted / reordered
 * column silently misaligns every write (Status → Reason, Phone → Status, …)
 * with NO error surfaced. This guard catches that drift before it corrupts data.
 *
 * Two layers:
 *   1. STRUCTURAL: the sheet must have at least CONFIG.DATA_COLUMNS_MAX columns.
 *   2. BASELINE DRIFT: compares the live header row against a blessed baseline.
 * Both log a CRITICAL audit event on failure; both BLOCK the operation only when
 * the ENFORCE_SHEET_SCHEMA feature flag is on (default false = observe/log-only,
 * so the guard can never break a working deployment before the baseline is set).
 *
 * ── One-time setup (run from the Apps Script editor) ─────────────────────
 *   1. auditTicketSheetHeaders()  → prints live headers vs CONFIG.COLS positions.
 *   2. blessTicketSheetSchema()   → snapshots current headers as the trusted baseline.
 *   3. Set feature flag ENFORCE_SHEET_SCHEMA = true to block writes on drift.
 */
const SCHEMA_BASELINE_PROP_ = 'TICKET_SHEET_SCHEMA_BASELINE';

// Canonical column → human label, derived from CONFIG.COLS. Built lazily (NOT a
// top-level const) so this module has no load-time dependency on CONFIG. Used
// only by the diagnostics; drift detection compares against the captured
// baseline, never against these labels.
let _ticketColumnLabels_ = null;
function getTicketColumnLabels_() {
  if (_ticketColumnLabels_) return _ticketColumnLabels_;
  const c = CONFIG.COLS;
  const labels = {};
  labels[c.TICKET_ID]    = 'Ticket ID';
  labels[c.CREATED_AT]   = 'Created At';
  labels[c.AGENT_EMAIL]  = 'Agent Email';
  labels[c.IT_EMAIL]     = 'IT Email';
  labels[c.REQUESTED_BY] = 'Requested By';
  labels[c.MID]          = 'MID';
  labels[c.BUSINESS]     = 'Business';
  labels[c.POS]          = 'POS';
  labels[c.SUPPORT_TYPE] = 'Support Type';
  labels[c.CONCERN]      = 'Concern';
  labels[c.CONFIG_NOTES] = 'Config Notes';
  labels[c.REMARK]       = 'Remark';
  labels[c.STATUS]       = 'Status';
  labels[c.REASON]       = 'Reason';
  labels[c.PHONE]        = 'Phone';
  _ticketColumnLabels_ = Object.freeze(labels);
  return _ticketColumnLabels_;
}

// Request-scoped memo: validate at most once per execution. GAS resets module
// state between requests, same lifecycle as the _ssInstance singleton — no
// cross-request staleness risk.
let _schemaCheckResult_ = null;

function normalizeHeader_(value) {
  return String(value == null ? '' : value).trim().toLowerCase().replace(/\s+/g, ' ');
}

function readTicketHeaders_(sheet) {
  const values = sheet.getRange(1, 1, 1, CONFIG.DATA_COLUMNS_MAX).getValues()[0];
  return values.map(normalizeHeader_);
}

function getSchemaBaseline_() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(SCHEMA_BASELINE_PROP_);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    Logger.log('[SchemaGuard] baseline parse error: ' + e.message);
    return null;
  }
}

/**
 * Validate the live ticket-sheet layout. Read-only; never throws — returns a
 * verdict the caller acts on.
 * @returns {{ok:boolean, structuralFail:boolean, drift:Array, actual:Array<string>, hasBaseline:boolean}}
 */
function validateTicketSheetSchema_(sheet) {
  const result = { ok: true, structuralFail: false, drift: [], actual: [], hasBaseline: false };

  // Layer 1 — structural (too few columns = guaranteed corruption)
  if (sheet.getLastColumn() < CONFIG.DATA_COLUMNS_MAX) {
    result.ok = false;
    result.structuralFail = true;
    return result;
  }

  result.actual = readTicketHeaders_(sheet);

  // Layer 2 — baseline drift (only meaningful once an admin has blessed a baseline)
  const baseline = getSchemaBaseline_();
  if (baseline) {
    result.hasBaseline = true;
    const labels = getTicketColumnLabels_();
    for (let i = 0; i < CONFIG.DATA_COLUMNS_MAX; i++) {
      const col = i + 1;
      const expected = normalizeHeader_(baseline[i]);
      const got = normalizeHeader_(result.actual[i]);
      if (expected !== got) {
        result.ok = false;
        result.drift.push({
          col: col,
          column: labels[col] || ('Col ' + col),
          expected: expected || '(empty)',
          actual: got || '(empty)'
        });
      }
    }
  }

  return result;
}

/**
 * Assert the ticket-sheet schema before any operation that trusts CONFIG.COLS
 * positions. Memoized per request (validates once, logs side-effects once).
 * Any problem (drift OR too-few-columns) logs a CRITICAL audit event. It only
 * THROWS — blocking the operation — when the ENFORCE_SHEET_SCHEMA flag is on.
 * Default is observe/log-only so the guard can never break a working deployment
 * before an admin has confirmed and blessed the baseline.
 * @throws Error [E005] on structural failure or drift, only when enforcement is on.
 */
function assertTicketSheetSchema_(sheet) {
  if (_schemaCheckResult_ === null) {
    _schemaCheckResult_ = validateTicketSheetSchema_(sheet);
    // Side-effects run exactly once per request, on first validation.
    if (!_schemaCheckResult_.ok) {
      if (_schemaCheckResult_.structuralFail) {
        incrementMetric_('schema_structural_failure');
        logAuditEvent('SCHEMA_STRUCTURAL_FAILURE', null, {
          message: 'Ticket sheet has fewer than ' + CONFIG.DATA_COLUMNS_MAX + ' columns',
          lastColumn: sheet.getLastColumn()
        }, 'CRITICAL');
      } else {
        incrementMetric_('schema_drift_detected');
        logAuditEvent('SCHEMA_DRIFT_DETECTED', null, {
          drift: _schemaCheckResult_.drift,
          enforced: getFeatureFlag('ENFORCE_SHEET_SCHEMA') === true
        }, 'CRITICAL');
      }
    }
  }

  const verdict = _schemaCheckResult_;
  if (verdict.ok) return;

  // Drift and structural insufficiency are both blocked ONLY under enforcement.
  // Observe mode (default) records the CRITICAL audit event above but never breaks
  // a deployment — a legacy sheet may legitimately have fewer than DATA_COLUMNS_MAX
  // columns (the PHONE column is added lazily by ensureTicketPhoneColumn_, and
  // getDataObjects already tolerates short sheets via Math.min).
  if (getFeatureFlag('ENFORCE_SHEET_SCHEMA') !== true) return;

  if (verdict.structuralFail) {
    throw new Error('[' + ERROR_CODES.SHEET_ERROR + '] Ticket sheet column layout is invalid ' +
      '(' + sheet.getLastColumn() + ' columns, expected at least ' + CONFIG.DATA_COLUMNS_MAX + '). ' +
      'Operation blocked to prevent data corruption.');
  }

  throw new Error('[' + ERROR_CODES.SHEET_ERROR + '] Ticket sheet columns have drifted from the ' +
    'approved layout. Operation blocked. Affected columns: ' +
    verdict.drift.map(function (d) { return d.column; }).join(', ') +
    '. Run auditTicketSheetHeaders() to inspect, then fix the sheet or re-bless.');
}

/**
 * One-time / on-demand: snapshot the CURRENT header row as the trusted baseline.
 * Run ONLY when you have confirmed the sheet layout is correct. Idempotent.
 * Intended to be run from the Apps Script editor by an admin.
 * @returns {string} JSON { success, headers }
 */
function blessTicketSheetSchema() {
  const sheet = getSpreadsheet_().getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) throw new Error('[' + ERROR_CODES.SHEET_ERROR + '] Sheet not found: ' + CONFIG.SHEET_NAME);
  if (sheet.getLastColumn() < CONFIG.DATA_COLUMNS_MAX) {
    throw new Error('[' + ERROR_CODES.SHEET_ERROR + '] Refusing to bless: sheet has ' +
      sheet.getLastColumn() + ' columns, expected at least ' + CONFIG.DATA_COLUMNS_MAX + '.');
  }
  const headers = readTicketHeaders_(sheet);
  PropertiesService.getScriptProperties().setProperty(SCHEMA_BASELINE_PROP_, JSON.stringify(headers));
  _schemaCheckResult_ = null; // force re-validation on next assert
  logAuditEvent('SCHEMA_BASELINE_BLESSED', null, { headers: headers }, 'INFO');
  Logger.log('[SchemaGuard] Baseline captured (' + headers.length + ' cols): ' + JSON.stringify(headers));
  return JSON.stringify({ success: true, headers: headers });
}

/**
 * Read-only diagnostic: prints each CONFIG.COLS position next to the live header
 * and the blessed baseline, plus the current verdict. Safe to run anytime.
 * @returns {string} JSON { success, columns, verdict }
 */
function auditTicketSheetHeaders() {
  const sheet = getSpreadsheet_().getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) throw new Error('[' + ERROR_CODES.SHEET_ERROR + '] Sheet not found: ' + CONFIG.SHEET_NAME);
  const actual = readTicketHeaders_(sheet);
  const baseline = getSchemaBaseline_();
  const labels = getTicketColumnLabels_();
  const columns = [];
  for (let i = 0; i < CONFIG.DATA_COLUMNS_MAX; i++) {
    const col = i + 1;
    columns.push({
      col: col,
      configLabel: labels[col] || ('Col ' + col),
      liveHeader: actual[i] || '(empty)',
      baseline: baseline ? (baseline[i] || '(empty)') : '(none)'
    });
  }
  const verdict = validateTicketSheetSchema_(sheet);
  Logger.log('[SchemaGuard] header audit:\n' + JSON.stringify(columns, null, 2));
  Logger.log('[SchemaGuard] verdict: ' + JSON.stringify({
    ok: verdict.ok, structuralFail: verdict.structuralFail,
    hasBaseline: verdict.hasBaseline, drift: verdict.drift
  }));
  return JSON.stringify({ success: true, columns: columns, verdict: verdict });
}
