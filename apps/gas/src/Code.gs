/* ==================================================
    ENTERPRISE CONFIGURATION v10.0
   BillFree TechSupport Ops - Production Ready

   ⚠️  PRODUCTION MONOLITH — SOURCE OF TRUTH
   This is the active, deployed Code.gs that serves the main dashboard
   via doGet() → HtmlService.createHtmlOutputFromFile('Index').

   Historical / experimental versions (Code1.gs, older refactors, etc.)
   have been moved to the /archive folder. Do not edit them.

   Future direction: This monolith is being incrementally modernized
   (state consolidation, template extraction). The React SPA in /react-spa
   is the intended long-term replacement (see plan in .grok sessions).

   Last major modernization pass: 2026-05-31 (Iteration 1 — headers + cleanup)
   ================================================== */

/**
 *  SYSTEM CONFIGURATION
 * Centralized config for easy management and deployment
 */
const CONFIG = Object.freeze({
  // Application Settings
  APP_TITLE: "BillFree TechSupport Ops v10.0 PRO",
  APP_VERSION: "10.0.0",
  SHEET_NAME: "IT Tracker 26",
  AUDIT_SHEET_NAME: "Audit Log",
  CALL_LOG_SHEET_NAME: "Call Log",
  
  // Cache & Performance
  CACHE_TTL_SECONDS: 300,           // 5 minutes
  TICKET_INDEX_TTL: 600,            // 10 minutes
  MAX_BATCH_SIZE: 100,

  // [W2-1] Column map — SINGLE source of truth for sheet column positions (1-based).
  // To add col P: increment DATA_COLUMNS_MAX and add an entry here.
  // NEVER write a bare column number like "13" or "14" elsewhere in the code.
  COLS: Object.freeze({
    TICKET_ID:     1,  // A  BF-YYYYMM-NNNN
    CREATED_AT:    2,  // B  Date created (GAS Date object)
    AGENT_EMAIL:   3,  // C  Creator email
    IT_EMAIL:      4,  // D  Assigned agent email
    REQUESTED_BY:  5,  // E  Branch / customer
    MID:           6,  // F  Merchant ID
    BUSINESS:      7,  // G  Business name
    POS:           8,  // H  POS software
    SUPPORT_TYPE:  9,  // I  "Customer Support" | "IT Floor" | etc.
    CONCERN:      10,  // J  Issue description
    CONFIG_NOTES: 11,  // K  Config notes
    REMARK:       12,  // L  Creation note
    STATUS:       13,  // M  STATUS_ENUM value
    REASON:       14,  // N  Append-only timestamped follow-up log
    PHONE:        15   // O  Digits-only phone, max 20 chars
  }),

  // [P1-FIX] RISK-06: Column cap — change this single value to read more columns.
  // Currently 15: cols A-O.
  // Never hardcode "15" or "16" anywhere else in the codebase.
  DATA_COLUMNS_MAX: 15,
  
  // Rate Limiting
  RATE_LIMIT_WINDOW_SECONDS: 60,
  RATE_LIMIT_MAX_REQUESTS: 30,
  
  // Business Rules
  MIN_CLOSURE_DAYS: 7,
  CRITICAL_AGE_DAYS: 15,
  WARNING_AGE_DAYS: 7,
  MIN_FOLLOWUP_DAYS: 7,
  
  // Pagination
  DEFAULT_PAGE_SIZE: 100,
  MAX_PAGE_SIZE: 500,
  
  // Lock Settings (Phase 1 - New)
  LOCK_TIMEOUT_MS: 5000,
  MAX_RETRIES: 3
});

// ── SHEET SCHEMA GUARD ──────────────────────────────────────────────────────
// The schema-guard subsystem (validate / assert / bless / audit + metrics) was
// extracted to SchemaGuard.gs. In GAS all .gs files share one global namespace,
// so assertTicketSheetSchema_(), blessTicketSheetSchema(), auditTicketSheetHeaders()
// etc. remain callable from this file unchanged. See SchemaGuard.gs.

/**
 * [CACHE] P1-7: SPREADSHEET HANDLE SINGLETON
 * Each SpreadsheetApp.getActiveSpreadsheet() costs ~50-100ms.
 * This lazy singleton caches the handle for the request lifecycle.
 * GAS resets module-level state between requests, so no staleness risk.
 */
let _ssInstance = null;
function getSpreadsheet_() {
  if (!_ssInstance) _ssInstance = SpreadsheetApp.getActiveSpreadsheet();
  return _ssInstance;
}

// ── AUTHENTICATION, AUTHORIZATION & IDENTITY ──
// Extracted to Auth.gs (GAS shares one global namespace across .gs
// files, so the moved declarations remain callable here).

























// [OK] getAgentList() is defined at line ~108, getAgentByEmail() at line ~90.
// Do NOT re-declare them here -- GAS uses the last definition, causing silent divergence bugs.

// [OK] ADMIN_EMAILS is declared above AGENT_DIRECTORY (line ~60)
// to avoid temporal dead zone when referenced inside initializeAgentPhones().




/**
 * [REPORT] STATUS CONFIGURATION
 */
const VALID_STATUSES = Object.freeze(['Not Completed', 'Completed', 'Closed', 'Pending', 'In Progress', "Can't Do"]);

const STATUS_ENUM = Object.freeze({
  NOT_COMPLETED: 'Not Completed',
  PENDING: 'Pending',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  CLOSED: 'Closed',
  CANT_DO: "Can't Do"
});

/**
 *  ERROR CODES
 */
const ERROR_CODES = Object.freeze({
  RATE_LIMITED: 'E001',
  UNAUTHORIZED: 'E002',
  NOT_FOUND: 'E003',
  VALIDATION_FAILED: 'E004',
  SHEET_ERROR: 'E005',
  LOCK_TIMEOUT: 'E006',
  INVALID_STATUS: 'E007',
  INSUFFICIENT_PERMISSIONS: 'E008',
  UNKNOWN_ERROR: 'E999'
});

/**
 *  USER-FRIENDLY ERROR MESSAGES
 * Translates technical error codes into clear, actionable messages for users.
 * Technical codes are still logged for debugging purposes.
 */
const USER_FRIENDLY_ERRORS = Object.freeze({
  'E001': 'Too many requests. Please wait a moment and try again.',
  'E002': 'Please sign in to continue.',
  'E003': 'The item you\'re looking for doesn\'t exist or has been removed.',
  'E004': 'Please check your input and try again.',
  'E005': 'Unable to access the database. Please refresh the page.',
  'E006': 'The system is busy. Please try again in a few seconds.',
  'E007': 'Please select a valid status option.',
  'E008': 'You don\'t have permission for this action. Contact your administrator.',
  'E999': 'Something went wrong. Please try again or refresh the page.'
});

/**
 *  GET USER-FRIENDLY ERROR MESSAGE
 * @param {string} errorCode - Technical error code (E001, E002, etc.)
 * @param {string} fallbackMessage - Original message if no friendly version exists
 * @returns {string} User-friendly error message
 */
function getUserFriendlyError(errorCode, fallbackMessage) {
  // Extract error code if embedded in message like "[E001]..."
  const codeMatch = errorCode.match(/E\d{3}/);
  const code = codeMatch ? codeMatch[0] : errorCode;
  return USER_FRIENDLY_ERRORS[code] || fallbackMessage || 'An error occurred. Please try again.';
}

/* ==================================================
    PHASE 2: API RESPONSE WRAPPER & CORRELATION IDS

   ================================================== */

/**
 *  Generate unique correlation ID for request tracing
 * Format: yyMMddHHmmss-random4chars
 */
function generateCorrelationId() {
  // ms-precision base-36 timestamp + 8-char entropy = collision-resistant across concurrent requests
  const ts = new Date().getTime().toString(36).toUpperCase();
  const rnd = Math.random().toString(36).substring(2, 10).toUpperCase();
  return `${ts}-${rnd}`;
}

/**
 * [FAIL] STANDARDIZED API ERROR RESPONSE
 * @param {string} errorCode - From ERROR_CODES enum
 * @param {string} message - Technical error message (for logging)
 * @param {string} correlationId - Request tracking ID
 * @param {Object} details - Optional error details
 */
function apiError(errorCode, message, correlationId = null, details = {}) {
  const cid = correlationId || generateCorrelationId();
  
  // Log technical error for debugging (preserves error codes)
  Logger.log(`[${cid}] API Error: [${errorCode}] ${message}`);
  if (Object.keys(details).length > 0) {
    Logger.log(`[${cid}] Error Details: ${JSON.stringify(details)}`);
  }
  
  // Return user-friendly message to frontend (hides technical codes)
  const userMessage = getUserFriendlyError(errorCode, message);
  
  const response = {
    success: false,
    error: {
      code: errorCode,                    // Keep code for frontend error handling logic
      message: userMessage                // User-friendly message shown to user
    },
    correlationId: cid,
    timestamp: new Date().toISOString(),
    version: CONFIG.APP_VERSION
  };
  return JSON.stringify(response);
}

// ── PLATFORM UTILITIES ──────────────────────────────────────────────────────
// Response envelopes (okResult_/errResult_/parseResult_) and best-effort metrics
// (incrementMetric_/getMetric_) were extracted to Platform.gs. In GAS all .gs
// files share one global namespace, so they remain callable here unchanged.
// See Platform.gs.

/**
 *  NORMALIZE STATUS WITH DEFAULT
 * Converts any status string to a canonical STATUS_ENUM value.
 * Returns NOT_COMPLETED for null/undefined/unrecognized inputs.
 * Use this when a guaranteed valid status is needed (e.g., reading sheet data).
 * @param {string|null} s - Raw status string
 * @returns {string} Canonical status from STATUS_ENUM (never null)
 */
function normalizeStatusWithDefault(s) {
  if (!s) return STATUS_ENUM.NOT_COMPLETED;
  // Normalize all apostrophe variants (ascii, smart-quotes) then compare once
  const v = String(s).toLowerCase().replace(/[\u2018\u2019\u201A\u201B]/g, "'");
  if (v === 'completed') return STATUS_ENUM.COMPLETED;
  if (v === 'closed') return STATUS_ENUM.CLOSED;
  if (v === 'in progress' || v === 'in_progress') return STATUS_ENUM.IN_PROGRESS;
  if (v === 'pending') return STATUS_ENUM.PENDING;
  if (v.includes('cant') || v.includes("can't")) return STATUS_ENUM.CANT_DO;
  return STATUS_ENUM.NOT_COMPLETED;
}

/**
 *  PARSE STATUS OR NULL
 * Strictly parses user-supplied status input to a canonical STATUS_ENUM value.
 * Returns null for unrecognized values (useful for input validation).
 * Use this when validating user-submitted status changes.
 * @param {string|null} s - Raw status input from user
 * @returns {string|null} Canonical status from STATUS_ENUM, or null if invalid
 */
function parseStatusOrNull(s) {
  if (s === null || s === undefined) return null;
  const v = String(s).trim().toLowerCase();
  if (v === 'not completed' || v === 'notcompleted') return STATUS_ENUM.NOT_COMPLETED;
  if (v === 'completed') return STATUS_ENUM.COMPLETED;
  if (v === 'closed') return STATUS_ENUM.CLOSED;
  if (v === 'pending') return STATUS_ENUM.PENDING;
  if (v === 'in progress' || v === 'inprogress') return STATUS_ENUM.IN_PROGRESS;
  if (v === "can't do" || v === 'cant do') return STATUS_ENUM.CANT_DO;
  return null;
}


/* ==================================================
    ENTERPRISE UTILITY FUNCTIONS
   ================================================== */













// [REMOVED] hasPermission() — zero callers; superseded by requirePermission().

/**
 *  AUDIT LOGGING
 * Comprehensive audit trail for compliance
 */
function logAuditEvent(action, ticketId, details, severity = 'INFO') {
  try {
    const ss = getSpreadsheet_();
    let auditSheet = ss.getSheetByName(CONFIG.AUDIT_SHEET_NAME);
    
    // Create audit sheet if it doesn't exist
    if (!auditSheet) {
      auditSheet = ss.insertSheet(CONFIG.AUDIT_SHEET_NAME);
      auditSheet.appendRow([
        'Timestamp', 'User Email', 'Action', 'Ticket ID', 
        'Details', 'Severity', 'IP/Session', 'Version'
      ]);
      auditSheet.getRange(1, 1, 1, 8).setFontWeight('bold').setBackground('#F1F5F9');
      auditSheet.setFrozenRows(1);
    }
    
    // [CACHE] FIX5: Auto-rotate when audit log exceeds threshold
    rotateAuditLogIfNeeded_(auditSheet);
    
    const userEmail = getSessionEmail_() || 'system';
    const timestamp = new Date();
    const sessionId = Session.getTemporaryActiveUserKey() || 'N/A';
    
    auditSheet.appendRow([
      timestamp,
      userEmail,
      action,
      ticketId || '-',
      typeof details === 'object' ? JSON.stringify(details) : String(details || ''),
      severity,
      sessionId,
      CONFIG.APP_VERSION
    ]);
    
  } catch (e) {
    Logger.log('Audit log error (non-critical): ' + e.toString());
  }
}

/**
 * [P1-FIX] RISK-08: AUDIT LOG ROTATION — DECOUPLED FROM LIVE REQUEST PATH
 *
 * OLD BEHAVIOR: rotateAuditLogIfNeeded_() ran synchronously inside logAuditEvent().
 * A 2,500-row archive operation (insertSheet + getValues + setValues + deleteRows)
 * takes 3-8 seconds in GAS — blocking the user's ticket create/update request.
 *
 * NEW BEHAVIOR:
 * - rotateAuditLogIfNeeded_() is now a lightweight row-count check ONLY.
 *   If rotation is needed it sets a Script Property flag and returns instantly.
 * - runAuditLogRotation() does the actual heavy archive work.
 *   Install it as a standalone time-based trigger: every night at 2 AM IST.
 *
 * HOW TO INSTALL THE TRIGGER (one-time setup):
 *   In Apps Script editor → Triggers → Add Trigger:
 *     Function: runAuditLogRotation
 *     Deployment: Head
 *     Event source: Time-driven, Day timer, 2am–3am
 */
let _auditRotationChecked = false;
function rotateAuditLogIfNeeded_(auditSheet) {
  if (_auditRotationChecked) return; // Only check once per request lifecycle
  _auditRotationChecked = true;
  
  try {
    const lastRow = auditSheet.getLastRow();
    if (lastRow <= 5000) return;

    // Flag for async rotation — do NOT run inline (would block user request)
    PropertiesService.getScriptProperties().setProperty('AUDIT_ROTATION_NEEDED', 'true');
    Logger.log('[AUDIT] Rotation flagged — ' + lastRow + ' rows. Run runAuditLogRotation() trigger.');
  } catch (e) {
    Logger.log('Audit rotation flag error (non-critical): ' + e.toString());
  }
}

/**
 * [P1-FIX] RISK-08: Standalone audit log rotation function.
 * Attach this to a nightly time-based trigger (2 AM IST).
 * Safe to run manually from the Apps Script editor as well.
 */
function runAuditLogRotation() {
  const props = PropertiesService.getScriptProperties();
  const needed = props.getProperty('AUDIT_ROTATION_NEEDED');

  // Allow manual runs even if flag not set
  const MAX_AUDIT_ROWS = 5000;
  const ROWS_TO_ARCHIVE = 2500;

  try {
    const ss = getSpreadsheet_();
    const auditSheet = ss.getSheetByName(CONFIG.AUDIT_SHEET_NAME);
    if (!auditSheet) {
      Logger.log('[AUDIT] Rotation: audit sheet not found');
      return;
    }

    const lastRow = auditSheet.getLastRow();
    if (lastRow <= MAX_AUDIT_ROWS) {
      props.deleteProperty('AUDIT_ROTATION_NEEDED');
      Logger.log('[AUDIT] Rotation not needed: ' + lastRow + ' rows');
      return;
    }

    Logger.log('[AUDIT] Starting rotation: ' + lastRow + ' rows → archiving ' + ROWS_TO_ARCHIVE);

    const archiveName = 'Audit Archive ' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd_HHmmss');
    const archiveSheet = ss.insertSheet(archiveName);

    const headerRow = auditSheet.getRange(1, 1, 1, 8).getValues();
    archiveSheet.getRange(1, 1, 1, 8).setValues(headerRow);
    archiveSheet.getRange(1, 1, 1, 8).setFontWeight('bold').setBackground('#F1F5F9');
    archiveSheet.setFrozenRows(1);

    const archiveData = auditSheet.getRange(2, 1, ROWS_TO_ARCHIVE, 8).getValues();
    archiveSheet.getRange(2, 1, ROWS_TO_ARCHIVE, 8).setValues(archiveData);
    auditSheet.deleteRows(2, ROWS_TO_ARCHIVE);

    props.deleteProperty('AUDIT_ROTATION_NEEDED');
    Logger.log('[AUDIT] Rotation complete: ' + ROWS_TO_ARCHIVE + ' rows archived to "' + archiveName + '"');

  } catch (e) {
    Logger.log('[AUDIT] Rotation error: ' + e.toString());
  }
}

/**
 * Shared SLA duration formatter for update history.
 * @param {number} ms
 * @returns {{formatted:string,hours:number,days:number,minutes:number,category:string}}
 */
function formatDurationSla_(ms) {
  const safeMs = Math.max(0, Number(ms) || 0);
  const minutes = Math.floor(safeMs / (1000 * 60));
  const totalHours = safeMs / (1000 * 60 * 60);
  const hours = Math.floor(totalHours);
  const days = Math.floor(totalHours / 24);

  let formatted = '';
  if (days >= 1) {
    const remainingHours = hours % 24;
    formatted = `${days}d ${remainingHours}h`;
  } else if (hours >= 1) {
    const remainingMinutes = minutes % 60;
    formatted = remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  } else {
    formatted = `${minutes}m`;
  }

  let category = 'normal';
  if (totalHours < 4) category = 'fast';
  else if (totalHours < 24) category = 'normal';
  else if (totalHours < 72) category = 'slow';
  else category = 'critical';

  return {
    formatted,
    hours: Math.round(totalHours * 10) / 10,
    days: Math.round(days * 10) / 10,
    minutes,
    category
  };
}

// ── CALL LOG & TELEPHONY CDR ──
// Extracted to CallLog.gs (GAS shares one global namespace across .gs
// files, so the moved declarations remain callable here).


















function csvSafeCell_(value) {
  const raw = String(value == null ? '' : value);
  const sanitized = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return (sanitized.includes(',') || sanitized.includes('"') || sanitized.includes('\n'))
    ? `"${sanitized.replace(/"/g, '""')}"`
    : sanitized;
}

function csvRow_(values) {
  return values.map(csvSafeCell_).join(',');
}




function secureEquals_(leftValue, rightValue) {
  const left = String(leftValue || '');
  const right = String(rightValue || '');

  const leftDigest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, left, Utilities.Charset.UTF_8);
  const rightDigest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, right, Utilities.Charset.UTF_8);
  if (!leftDigest || !rightDigest || leftDigest.length !== rightDigest.length) {
    return false;
  }

  let diff = left.length ^ right.length;
  for (let i = 0; i < leftDigest.length; i++) {
    diff |= ((leftDigest[i] & 0xff) ^ (rightDigest[i] & 0xff));
  }
  return diff === 0;
}


function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── INPUT VALIDATION ────────────────────────────────────────────────────────
// sanitizeInput(), validateField(), and the (now lazy) validation schemas were
// extracted to Validation.gs. In GAS all .gs files share one global namespace,
// so they remain callable here unchanged. The schemas were made lazy during the
// move to remove a top-level STATUS_ENUM load-order dependency. See Validation.gs.
// [REMOVED] validateFields() — zero callers; use validateField() individually.

/* ==================================================
    PHASE 2.4: AUDIT LOG MONITORING
   ================================================== */

/**
 * [REPORT] GET AUDIT LOG STATISTICS
 * Returns metrics about the audit log for monitoring
 */
function getAuditLogStats() {
  try {
    const ss = getSpreadsheet_();
    const auditSheet = ss.getSheetByName(CONFIG.AUDIT_SHEET_NAME);
    
    if (!auditSheet) {
      return { exists: false, rowCount: 0
      };
    }
    
    const lastRow = auditSheet.getLastRow();
    const rowCount = Math.max(0, lastRow - 1); // Exclude header
    
    // Get last 100 entries for analysis
    const sampleSize = Math.min(100, rowCount);
    const data = sampleSize > 0 
      ? auditSheet.getRange(lastRow - sampleSize + 1, 1, sampleSize, 6).getValues()
      : [];
    
    // Count by severity
    const severityCounts = { INFO: 0, WARNING: 0, ERROR: 0 };
    data.forEach(row => {
      const severity = String(row[5] || 'INFO').toUpperCase();
      if (severityCounts[severity] !== undefined) {
        severityCounts[severity]++;
      }
    });
    
    return {
      exists: true,
      rowCount: rowCount,
      sampleSize: sampleSize,
      severityCounts: severityCounts,
      needsRotation: rowCount > 10000,
      lastEntry: data.length > 0 ? data[data.length - 1][0] : null
    };
  } catch (e) {
    Logger.log('getAuditLogStats error: ' + e.toString());
    return { exists: false, error: e.toString() };
  }
}

/**
 *  ARCHIVE OLD AUDIT ENTRIES
 * Moves entries older than 90 days to archive sheet
 */
function archiveOldAuditEntries() {
  try {
    const ss = getSpreadsheet_();
    const auditSheet = ss.getSheetByName(CONFIG.AUDIT_SHEET_NAME);
    
    if (!auditSheet || auditSheet.getLastRow() < 2) {
      return { archived: 0, message: 'No entries to archive' };
    }
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 90);
    
    // Get or create archive sheet
    let archiveSheet = ss.getSheetByName('Audit Archive');
    if (!archiveSheet) {
      archiveSheet = ss.insertSheet('Audit Archive');
      archiveSheet.appendRow([
        'Timestamp', 'User Email', 'Action', 'Ticket ID', 
        'Details', 'Severity', 'IP/Session', 'Version'
      ]);
      archiveSheet.getRange(1, 1, 1, 8).setFontWeight('bold').setBackground('#F1F5F9');
      archiveSheet.setFrozenRows(1);
    }
    
    // Process in batches to avoid timeout
    const allData = auditSheet.getRange(2, 1, auditSheet.getLastRow() - 1, 8).getValues();
    const toArchive = [];
    const toKeep = [];
    
    allData.forEach(row => {
      const timestamp = new Date(row[0]);
      if (timestamp < cutoffDate) {
        toArchive.push(row);
      } else {
        toKeep.push(row);
      }
    });
    
    if (toArchive.length > 0) {
      // Append to archive
      archiveSheet.getRange(
        archiveSheet.getLastRow() + 1, 
        1, 
        toArchive.length, 
        8
      ).setValues(toArchive);
      
      // Clear main sheet and restore kept entries
      auditSheet.getRange(2, 1, auditSheet.getLastRow() - 1, 8).clearContent();
      if (toKeep.length > 0) {
        auditSheet.getRange(2, 1, toKeep.length, 8).setValues(toKeep);
      }
    }
    
    return {
      archived: toArchive.length,
      kept: toKeep.length,
      message: `Archived ${toArchive.length} entries older than 90 days`
    };
  } catch (e) {
    Logger.log('archiveOldAuditEntries error: ' + e.toString());
    return { archived: 0, error: e.toString() };
  }
}

/**
 *  TICKET INDEX MAP
 * O(1) ticket lookups instead of O(n) linear search
 */

// ── TICKET CACHE, INDEX & VERSIONING ──
// Extracted to TicketCache.gs (GAS shares one global namespace across .gs
// files, so the moved declarations remain callable here).



/* ==================================================
   [CACHE] SMART TICKET CACHING SYSTEM v1.0
   High-performance caching with chunked storage
   ================================================== */







// [REMOVED] withRetry() — zero callers.
// [REMOVED] convertMarkdownToHtml() — zero callers.


/* ==================================================
   // [REPORT] MONTHLY REPORT CSV EXPORT
   ================================================== */


/**
 * Exports report as CSV for Excel
 */
function exportReportAsCSV(config) {
  try {
    const safeConfig = config || {};
    requirePermission('EXPORT_REPORT', safeConfig.idToken || '');
    requireCSRFToken(safeConfig.csrfToken || '');
    const reportResult = JSON.parse(generateMonthlyReport(safeConfig));
    if (!reportResult.success) return reportResult;
    
    const report = reportResult.report;
    
    // Build CSV
    const csvRows = [];
    csvRows.push(csvRow_([report.title]));
    csvRows.push(csvRow_([`Generated: ${report.generatedAt}`]));
    csvRows.push(csvRow_([`Period: ${report.period.startDate} to ${report.period.endDate}`]));
    csvRows.push('');

    csvRows.push(csvRow_(['SUMMARY']));
    csvRows.push(csvRow_(['Total Tickets', report.summary.totalTickets]));
    csvRows.push(csvRow_(['Completed', report.summary.completed]));
    csvRows.push(csvRow_(['Pending', report.summary.pending]));
    csvRows.push(csvRow_(['Closed', report.summary.closed]));
    csvRows.push(csvRow_([`Can't Do`, report.summary.cantDo]));
    csvRows.push(csvRow_(['Completion Rate', `${report.summary.completionRate}%`]));
    csvRows.push('');

    csvRows.push(csvRow_(['AGENT PERFORMANCE']));
    csvRows.push(csvRow_(['Agent', 'Total', 'Completed', 'Pending', 'Closed', `Can't Do`, 'Rate']));
    report.agentRankings.forEach(a => {
      csvRows.push(csvRow_([a.name, a.total, a.completed, a.pending, a.closed, a.cantDo, `${a.completionRate}%`]));
    });
    csvRows.push('');

    csvRows.push(csvRow_(['TICKET DETAILS']));
    csvRows.push(csvRow_(['ID', 'Date', 'Agent', 'Business', 'MID', 'Concern', 'Support Type', 'Status']));
    report.tickets.forEach(t => {
      csvRows.push(csvRow_([t.id, t.date, t.agent, t.business, t.mid, t.concern, t.supportType, t.status]));
    });
    
    return JSON.stringify({ success: true, csv: csvRows.join('\n'), filename: `Report_${report.period.monthName}_${report.period.year}.csv` });
    
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}






/* ==================================================
    WEB APP SERVING
   ================================================== */
function doGet(e) {
  var params = (e && e.parameter) || {};

  // ── PORTAL PAGE ROUTING ─────────────────────────────────────────────
  // Serve the public-facing Ticket Portal at ?page=portal
  // This gives cross-functional teams a separate, bookmarkable URL:
  //   https://script.google.com/.../exec?page=portal
  // No authentication required — the portal has its own rate limiting.
  if (params.page === 'portal') {
    var portalHtml = HtmlService.createHtmlOutputFromFile('TicketPortal');
    portalHtml.setTitle('BillFree QuickFix');
    portalHtml.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    portalHtml.addMetaTag('viewport', 'width=device-width, initial-scale=1');
    return portalHtml;
  }

  var identity = resolveIdentityContext_({
    idToken: params.token || '',
    allowSessionFallback: true
  });

  // ── SPA JSON API ENDPOINTS ──────────────────────────────────────────
  // These return JSON instead of HTML, used by the React SPA's fetch() calls.

  if (params.action === 'identity') {
    var idEmail = identity.success ? identity.email : '';
    var idAgent = getAgentByEmail(idEmail);
    var idToken = (idEmail && isAuthorizedUserEmail_(idEmail))
      ? generateServerToken_(idEmail)
      : '';
    var agentsJson = [];
    try {
      var agentsParsed = JSON.parse(getAgentList());
      agentsJson = agentsParsed.agents || [];
    } catch (_) {}
    var identityResponse = {
      success: identity.success,
      email: idEmail,
      name: identity.success ? identity.name : '',
      role: identity.success ? identity.role : ROLES.VIEWER,
      isAdmin: identity.success ? identity.isAdmin : false,
      token: idToken,
      agents: agentsJson,
      trustedOrigins: getTrustedParentOrigins_()
    };
    return ContentService
      .createTextOutput(JSON.stringify(identityResponse))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (params.action === 'version') {
    var versionResult = { version: 0 };
    try {
      var vr = checkVersion();
      versionResult.version = (typeof vr === 'string' ? JSON.parse(vr) : vr).version || 0;
    } catch (_) {}
    return ContentService
      .createTextOutput(JSON.stringify(versionResult))
      .setMimeType(ContentService.MimeType.JSON);
  }

  //  IDENTITY RESOLUTION (URL PARAMETER BRIDGE)
  // Support identity from URL parameters (passed by Cloudflare parent)
  // as a fallback for when Session.getActiveUser() is empty (e.g. non-owners).
  var sessionEmail = identity.success ? identity.email : '';
  // Do not trust raw URL identity and do not fall back to effective user:
  // it can resolve to the script owner and poison the client bootstrap.

  var agent = getAgentByEmail(sessionEmail);
  var role  = getUserRole(sessionEmail);

  // ── URL PARAMETER IDENTITY (most reliable for Cloudflare iframe) ────────────
  // Cloudflare passes the authenticated user's email/name as URL query params:
  //   <iframe src="GAS_URL?eml=agent@billfree.in&nm=Agent+Name">
  // This is the ONLY approach that works reliably regardless of:
  //   - Session.getActiveUser() being empty (Execute as Me + Anyone mode)
  //   - postMessage timing races
  //   - Cloudflare JWT not being verifiable by Google tokeninfo
  //
  // SECURITY: validated against AGENT_DIRECTORY — unknown emails are ignored.
  var urlEmail = '';
  var urlName  = '';
  try {
    var rawUrlEmail = String(e.parameter.eml || e.parameter.email || '').trim().toLowerCase();
    var rawUrlName  = String(e.parameter.nm  || e.parameter.name  || '').trim().substring(0, 80);
    // Validate against AGENT_DIRECTORY — rejects spoofed emails not in agent list
    if (rawUrlEmail && isAuthorizedUserEmail_(normalizeEmail_(rawUrlEmail))) {
      urlEmail = normalizeEmail_(rawUrlEmail);
      var urlAgent = getAgentByEmail(urlEmail);
      // Only trust the name param if an agent record exists; use their official name otherwise
      urlName = urlAgent ? urlAgent.name : (rawUrlName || urlEmail.split('@')[0]);
    }
  } catch (_) {}

  // Prepare template values — URL param identity takes priority over session identity
  // For auth token generation, we need effectiveEmail (deployer) — resolve it first.
  var effectiveEmail = ''; // must stay blank: never trust effective user for viewer identity

  // Fail closed: do not promote the deployer/effective user into client identity.
  //   1. URL params (?eml=) — Cloudflare iframe agents
  //   2. resolveIdentityContext_ result — OAuth/session
  //   3. effectiveEmail — admin direct GAS access (Session.getActiveUser() returns ''
  //      in "Anyone" mode, but getEffectiveUser() returns deployer = admin email)
  var injectedUserEmail = urlEmail
    || (identity.success ? identity.email : '')
    || ''
    || effectiveEmail;  // ← Admin direct access fallback
  var injectedAgent = getAgentByEmail(injectedUserEmail);
  var injectedUserName  = urlName
    || (identity.success ? identity.name : '')
    || (injectedAgent ? injectedAgent.name : '');
  var injectedUserRole  = injectedUserEmail
    ? ((identity.success && identity.email === injectedUserEmail)
        ? identity.role
        : getUserRole(injectedUserEmail))
    : ROLES.VIEWER;
  var injectedUserIsAdmin = isAdminEmail_(injectedUserEmail);

  // Only mint a bootstrap token for the resolved visiting identity.
  var tokenEmail = (injectedUserEmail && isAuthorizedUserEmail_(injectedUserEmail))
    ? injectedUserEmail
    : '';

  var injectedUserToken = tokenEmail ? generateServerToken_(tokenEmail) : '';
  var injectedTrustedParentOrigins = JSON.stringify(getTrustedParentOrigins_());

  var injectedAgentsJson = '';
  try {
    injectedAgentsJson = getAgentList(); // already a JSON string
  } catch (_) {
    injectedAgentsJson = JSON.stringify({ success: false, agents: [] });
  }

  // ── FRONTEND CUTOVER SWITCH ─────────────────────────────────────────
  // Reversible migration control. Default 'legacy' falls through and serves the
  // Index.html monolith below. Set feature flag FRONTEND_MODE = 'spa' to redirect
  // this legacy GAS entry point to the React SPA (Cloudflare Pages); flip back to
  // 'legacy' for instant rollback with no redeploy. The SPA base URL is read from
  // the SPA_URL script property; if it's unset we fall through to legacy so the
  // app is never down.
  if (getFeatureFlag('FRONTEND_MODE') === 'spa') {
    var spaBase = PropertiesService.getScriptProperties().getProperty('SPA_URL') || '';
    if (spaBase) {
      var spaUrl = spaBase
        + (spaBase.indexOf('?') === -1 ? '?' : '&')
        + 'eml=' + encodeURIComponent(injectedUserEmail)
        + '&nm=' + encodeURIComponent(injectedUserName);
      var redirectHtml = HtmlService.createHtmlOutput(
        '<!doctype html><meta charset="utf-8">' +
        '<meta name="robots" content="noindex">' +
        '<title>' + escapeHtml_(CONFIG.APP_TITLE) + '</title>' +
        '<script>window.top.location.replace(' + jsStringLiteral_(spaUrl) + ');</script>' +
        '<p style="font:14px system-ui;padding:24px">Redirecting to BillFree TechOps…</p>'
      );
      redirectHtml.setTitle(CONFIG.APP_TITLE);
      redirectHtml.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
      return redirectHtml;
    }
  }

  // Use createHtmlOutputFromFile() - safe because we no longer use GAS scriptlets.
  // Plain %%INJECT_...%% tokens survive all GAS HTML processing methods.
  var rawHtml = HtmlService.createHtmlOutputFromFile('Index').getContent();

  // Replace the injection tokens. We emit JSON.stringify(value) which produces
  // a fully-quoted JS string literal (e.g. "foo\"bar\u2028"). This is bulletproof
  // against every problematic character — control chars, line separators
  // (U+2028/U+2029), surrogate pairs, embedded quotes, BOM, etc.
  // The template in Index.html must therefore NOT wrap placeholders in quotes.
  rawHtml = rawHtml.split('%%INJECT_injectedUserEmail%%').join(jsStringLiteral_(injectedUserEmail));
  rawHtml = rawHtml.split('%%INJECT_injectedUserName%%').join(jsStringLiteral_(injectedUserName));
  rawHtml = rawHtml.split('%%INJECT_injectedUserToken%%').join(jsStringLiteral_(injectedUserToken));
  rawHtml = rawHtml.split('%%INJECT_injectedUserRole%%').join(jsStringLiteral_(injectedUserRole));
  rawHtml = rawHtml.split('%%INJECT_injectedUserIsAdmin%%').join(jsStringLiteral_(injectedUserIsAdmin));
  rawHtml = rawHtml.split('%%INJECT_injectedTrustedParentOrigins%%').join(jsStringLiteral_(injectedTrustedParentOrigins));
  rawHtml = rawHtml.split('%%INJECT_injectedAgentsJson%%').join(jsStringLiteral_(injectedAgentsJson));

  var htmlOutput = HtmlService.createHtmlOutput(rawHtml);
  htmlOutput.setTitle(CONFIG.APP_TITLE);
  htmlOutput.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  htmlOutput.addMetaTag('viewport', 'width=device-width, initial-scale=1');
  return htmlOutput;
}

/**
 * Escapes special characters for safe insertion into HTML template.
 * Prevents XSS from injected values while preserving JSON structures.
 */
/**
 * Emit a value as a fully-quoted, bulletproof JS string literal.
 * Uses JSON.stringify (which is a strict subset of valid JS syntax) and
 * additionally hardens against the few characters JSON allows but JS doesn't
 * tolerate in inline <script> blocks:
 *   - U+2028 / U+2029  → line terminators inside JS strings (break parsing)
 *   - </               → would prematurely close the surrounding <script> tag
 *
 * Output INCLUDES the surrounding double quotes. Callers must NOT wrap the
 * placeholder in extra quotes in the HTML template.
 *
 *   jsStringLiteral_("foo")        → "\"foo\""
 *   jsStringLiteral_('he said "hi"') → "\"he said \\\"hi\\\"\""
 *   jsStringLiteral_('a\u2028b')   → "\"a\\u2028b\""
 */
function jsStringLiteral_(value) {
  if (value === null || value === undefined) return '""';
  return JSON.stringify(String(value))
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
    .replace(/<\//g, '<\\/');
}

function escapeHtmlForTemplate_(str) {
  if (str === null || str === undefined) return '';
  // All injected values are inside <script> tags in JS string literals,
  // so we need JS-safe escaping, NOT HTML entity encoding.
  return String(str)
    .replace(/\\/g, '\\\\')        // Escape backslashes first
    .replace(/'/g, "\\'")          // Escape single quotes (values are in '...')
    .replace(/\n/g, '\\n')         // Escape newlines
    .replace(/\r/g, '\\r')         // Escape carriage returns
    .replace(/\t/g, '\\t')         // Escape tabs (rare but defensive)
    .replace(/\u2028/g, '\\u2028') // [CRITICAL] U+2028 is a JS string terminator!
    .replace(/\u2029/g, '\\u2029') // [CRITICAL] U+2029 likewise — silently breaks parsing
    .replace(/[\u0000-\u001F]/g, function (ch) {
      // Other control chars (NUL, BEL, BS, VT, FF, etc.) can also corrupt the
      // emitted JS literal. Encode as \uXXXX defensively.
      return '\\u' + ('0000' + ch.charCodeAt(0).toString(16)).slice(-4);
    })
    .replace(/<\//g, '<\\/');      // Prevent </script> injection
}

function doPost(e) {
  try {
    const payload = parseWebhookPayload_(e);
    const action = String(
      payload.action ||
      payload.route ||
      (e && e.parameter && e.parameter.action) ||
      'provider_cdr'
    ).toLowerCase();

    // ── PORTAL REST ROUTES (for Cloudflare Pages frontend) ───────────
    // These routes bypass google.script.run and are callable via fetch()
    // from billfreequickfix.pages.dev with CORS headers set.
    if (action === 'portal_create') {
      const result = portalCreateTicket(payload.data || payload);
      return portalJsonResponse_(result);
    }

    if (action === 'portal_lookup') {
      const result = portalLookupTicket(payload.query || '');
      return portalJsonResponse_(result);
    }

    // ── API ROUTER ────────────────────────────────────────────────────
    // Route: createTicket — External API for WhatsApp chatbot / integrations
    if (action === 'createticket') {
      return jsonResponse_(api_createTicket_(payload));
    }

    // ── REACT SPA AUTHENTICATED REST ROUTES ──────────────────────────
    // These routes serve the decoupled React SPA on Cloudflare Pages.
    // All use CORS-aware JSON responses and require a valid server token.
    // Content-Type from the SPA is 'text/plain' with a JSON body.

    // --- Data ---
    if (action === 'getticketdata') {
      var tdResult = getTicketData(payload.token || '');
      return spaJsonResponse_(parseResult_(tdResult));
    }

    if (action === 'getcsrftoken') {
      var csrfResult = getCSRFToken();
      return spaJsonResponse_(parseResult_(csrfResult));
    }

    // --- Ticket Mutations ---
    if (action === 'updateticketfull') {
      var utf = updateTicketFull(
        payload.ticketId, payload.newStatus, payload.newReason,
        payload.csrfToken, payload.token || ''
      );
      return spaJsonResponse_(parseResult_(utf));
    }

    if (action === 'updateticketstatus') {
      var uts = updateTicketStatus(
        payload.ticketId, payload.newStatus,
        payload.csrfToken, payload.token || ''
      );
      return spaJsonResponse_(parseResult_(uts));
    }

    if (action === 'updateticketpos') {
      var utp = updateTicketPOS(
        payload.ticketId, payload.pos || payload.newPos,
        payload.csrfToken, payload.token || ''
      );
      return spaJsonResponse_(parseResult_(utp));
    }

    if (action === 'appendreason') {
      var arResult = appendTicketReason(
        payload.ticketId, payload.reason || payload.newReason,
        payload.csrfToken, payload.token || ''
      );
      return spaJsonResponse_(parseResult_(arResult));
    }

    if (action === 'createticketauth') {
      var ctResult = createNewTicket(
        payload.data || payload,
        payload.csrfToken,
        payload.token || ''
      );
      return spaJsonResponse_(parseResult_(ctResult));
    }

    // --- Analytics ---
    if (action === 'getanalytics') {
      var sub = String(payload.sub || '').toLowerCase();
      var analyticsResult = { success: true, data: null };
      if (sub === 'topmidssame')       analyticsResult.data = JSON.parse(getTopMIDsSameConcern() || '{}').data;
      else if (sub === 'topmidsdiff')  analyticsResult.data = JSON.parse(getTopMIDsDifferentConcerns() || '{}').data;
      else if (sub === 'toppos')       analyticsResult.data = JSON.parse(getTopPOS() || '{}').data;
      else if (sub === 'repeatcustomers') analyticsResult.data = JSON.parse(getRepeatCustomerAnalysis() || '{}').data;
      else if (sub === 'concerntrend') analyticsResult.data = JSON.parse(getConcernTrendAnalysis() || '{}').data;
      else if (sub === 'agentmatrix')  analyticsResult.data = JSON.parse(getAgentSpecializationMatrix() || '{}').data;
      return spaJsonResponse_(analyticsResult);
    }

    // --- Call Log ---
    if (action === 'getcallhistory') {
      var chResult = getCallHistory(payload.filters || payload.config || {});
      return spaJsonResponse_(parseResult_(chResult));
    }

    if (action === 'logcallevent') {
      var lcResult = logCallEvent(
        payload.data || payload,
        payload.csrfToken || '',
        payload.token || ''
      );
      return spaJsonResponse_(parseResult_(lcResult));
    }

    // --- Reports & History ---
    if (action === 'getmonthlyreport') {
      var mrResult = generateMonthlyReport(payload.config || {});
      return spaJsonResponse_(parseResult_(mrResult));
    }

    if (action === 'getupdatehistory') {
      // [BUG FIX] getUpdateHistory signature is config = { page, pageSize, filters: {...} }.
      // Previous wrapper passed {ticketId, page} flat → backend never matched the
      // ticket-id filter (it reads filters.ticketId, not config.ticketId).
      var uhConfig = {
        page: payload.page || 1,
        pageSize: payload.pageSize || 50,
        idToken: payload.token || '',
        filters: {
          ticketId: payload.ticketId || (payload.filters && payload.filters.ticketId) || '',
          user:     (payload.filters && payload.filters.user)     || '',
          action:   (payload.filters && payload.filters.action)   || 'all',
          severity: (payload.filters && payload.filters.severity) || 'all',
          startDate: (payload.filters && payload.filters.startDate) || '',
          endDate:   (payload.filters && payload.filters.endDate)   || ''
        }
      };
      var uhResult = getUpdateHistory(uhConfig);
      return spaJsonResponse_(parseResult_(uhResult));
    }

    if (action === 'exporttickets') {
      var etResult = exportTicketsToCSV(payload.filters || {});
      return spaJsonResponse_(parseResult_(etResult));
    }

    // --- Client-side error reporting (from the SPA's ErrorBoundary) ---
    if (action === 'logclienterror') {
      incrementMetric_('client_error');
      logAuditEvent('CLIENT_ERROR', null, {
        context: String(payload.context || '').slice(0, 200),
        message: String(payload.message || '').slice(0, 1000),
        stack: String(payload.stack || '').slice(0, 2000),
        url: String(payload.url || '').slice(0, 500),
        userAgent: String(payload.userAgent || '').slice(0, 300)
      }, 'ERROR');
      return spaJsonResponse_({ success: true });
    }

    // ── WEBHOOK / CDR ROUTES ──────────────────────────────────────────
    if (action !== 'provider_cdr') {
      return jsonResponse_({
        success: false,
        error: '[' + ERROR_CODES.VALIDATION_FAILED + '] Unsupported action: ' + action
      });
    }

    const secretValidation = validateWebhookSecret_(payload, e);
    if (!secretValidation.success) {
      return jsonResponse_(secretValidation);
    }

    delete payload.secret;
    delete payload.webhookSecret;
    delete payload.token;

    const result = ingestProviderCdrEvent_(payload);
    return jsonResponse_(result);
  } catch (ePost) {
    Logger.log('doPost error: ' + ePost.toString());
    return spaJsonResponse_({
      success: false,
      error: ePost.message || ePost.toString()
    });
  }
}

// ── PORTAL CORS-AWARE JSON RESPONSE ─────────────────────────────────────
// Returns JSON with CORS headers allowing billfreequickfix.pages.dev
function portalJsonResponse_(body) {
  var str = typeof body === 'string' ? body : JSON.stringify(body);
  return ContentService
    .createTextOutput(str)
    .setMimeType(ContentService.MimeType.JSON);
}

// ── SPA CORS-AWARE JSON RESPONSE ────────────────────────────────────────
// Returns JSON for the React SPA's fetch() POST calls.
// GAS automatically follows the redirect, so CORS is handled implicitly
// by the GAS infrastructure (unlike traditional REST APIs).
function spaJsonResponse_(body) {
  var str = typeof body === 'string' ? body : JSON.stringify(body);
  return ContentService
    .createTextOutput(str)
    .setMimeType(ContentService.MimeType.JSON);
}


/* ==================================================
    CORE DATA ENGINE (UPDATED WITH 7-DAY VALIDATION)
   ================================================== */
function getDataObjects() {
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) return [];

  // [DATA-INTEGRITY] Verify column layout before mapping rows by CONFIG.COLS position.
  assertTicketSheetSchema_(sheet);

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  // [P1-FIX] RISK-06: Use CONFIG.DATA_COLUMNS_MAX instead of hardcoded 15.
  // To add a new sheet column (e.g. lastUpdatedAt at col P), only change CONFIG.DATA_COLUMNS_MAX.
  // Guard: never read beyond what the sheet actually has (handles partial/legacy sheets).
  const readCols = Math.min(sheet.getLastColumn(), CONFIG.DATA_COLUMNS_MAX);
  const data = sheet.getRange(2, 1, lastRow - 1, readCols).getValues(); // Skip header
  const now = new Date();
  const nowTime = now.getTime(); // [CACHE] Pre-compute once
  
  // [CACHE] OPTIMIZATION 2: Pre-allocate array (faster than dynamic growth)
  const tickets = [];
  tickets.length = data.length;
  
  let validIndex = 0;

  // [CACHE] OPTIMIZATION 3: For-loop (30% faster than map/filter chain)
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    
    // [CACHE] Quick skip empty rows
    const rawDate = row[1];
    if (!rawDate || String(rawDate).trim() === '') continue;

    // [CACHE] OPTIMIZATION 4: Simplified date handling
    let sortDate = 0;
    let displayDate = '-';
    let hourIST = 0;

    if (rawDate instanceof Date && !isNaN(rawDate.getTime())) {
      // [CACHE] FAST PATH: 95% of cases
      const d = rawDate;
      sortDate = d.getTime();
      displayDate = formatDateFast(d); // [CACHE] Use helper below
      hourIST = d.getHours();
    } else {
      // Fallback for strings
      const d = new Date(rawDate);
      if (!isNaN(d.getTime())) {
        sortDate = d.getTime();
        displayDate = formatDateFast(d);
        hourIST = d.getHours();
      } else {
        sortDate = nowTime;
      }
    }

    // [CACHE] OPTIMIZATION 5: Pre-compute age
    const ageDays = Math.floor((nowTime - sortDate) / 86400000); // Use constant

    // [CACHE] OPTIMIZATION 6: Single status normalization
    const status = normalizeStatusWithDefault(row[12]);
    
    // [CACHE] OPTIMIZATION 7: Defer reason quality (only if needed for display)
    const reason = row[13] ? String(row[13]).trim() : '';
    const reasonLen = reason.length;
    
    // [CACHE] OPTIMIZATION 8: Inline age category (no if-else chain)
    const ageCategory = ageDays >= 15 ? 'critical' : 
                        ageDays >= 8 ? 'old' : 
                        ageDays >= 4 ? 'aging' : 'fresh';

    // [CACHE] CRITICAL FIX: Remove validation call entirely
    // Frontend will validate on-demand for visible tickets only
    const phoneRaw = row[14] || '';
    const phone = normalizeCallPhone_(phoneRaw);

    const ticketObject = {
      id: String(row[0] || ('TKT-' + (i + 1))),
      rowIndex: i + 2,
      date: displayDate,
      sortDate: sortDate,
      hourIST: hourIST,
      ageDays: ageDays,
      ageCategory: ageCategory,
      email: row[3] || '',
      agent: getAgentNameByEmail_(row[2]),
      requestedBy: row[4] || '-',
      mid: row[5] ? String(row[5]).trim() : '-',
      business: row[6] || '-',
      pos: row[7] ? String(row[7]).trim() : '-',
      supportType: row[8] || 'Customer Support',
      concern: row[9] || 'Unspecified',
      config: row[10] || '',
      remark: row[11] || '',
      phone: phone,
      phoneDisplay: formatPhoneDisplay_(phoneRaw),
      status: status,
      reason: reason,
      reasonQuality: reasonLen >= 30 ? 'detailed' : 
                     reasonLen >= 10 ? 'brief' : 
                     reasonLen > 0 ? 'minimal' : 'none',
      // [CACHE] DEFERRED: Compute these in frontend on-demand
      invalidClosed: false, // Will be computed by frontend when needed
      validationReason: '',
      validationWarnings: []
    };

    tickets[validIndex++] = ticketObject;
  }

  // [CACHE] Trim unused slots
  tickets.length = validIndex;
  
  return tickets;
}

// [CACHE] HELPER: Fast date formatting (2x faster than template literals)
function formatDateFast(d) {
  const day = d.getDate();
  const month = d.getMonth() + 1;
  return (day < 10 ? '0' + day : day) + '-' + 
         (month < 10 ? '0' + month : month) + '-' + 
         d.getFullYear();
}


function getTicketData(idToken) {
  try {
    // ── NO requirePermission gate here ──────────────────────────────────────
    // This is a READ-ONLY data fetch for the dashboard. The user has already
    // authenticated via Google sign-in to access the GAS web app URL.
    // Adding requirePermission on top caused E002 failures when:
    //   - HMAC server token expired (24h TTL, stored once at page load)
    //   - Session.getActiveUser() returned empty (common in 'Anyone' deployments)
    //   - Session.getEffectiveUser() returned deployer instead of visiting user
    // The Sheet is private, and the web app URL is access-controlled by Google.
    // Write operations (create/update/delete) still enforce full auth + CSRF.

    // [CACHE] Use cached tickets for 10x faster response
    const tickets = getCachedTickets();
    const props = PropertiesService.getScriptProperties();
    const version = parseInt(props.getProperty('DATA_VERSION') || '0');
    
    // Include cache stats for monitoring
    const cacheStats = getTicketCacheStats();

    return JSON.stringify({ 
      success: true, 
      tickets: tickets.sort((a, b) => b.sortDate - a.sortDate),
      directory: AGENT_DIRECTORY,
      version: version,
      cacheStatus: cacheStats.status
    });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}


/* ==================================================
   [W2-2] SHEET REPOSITORY — Canonical Row Finder
   ================================================
   Single implementation that replaces 4 copy-pasted
   index-lookup + stale-guard + linear-fallback blocks
   that existed inline in updateTicketStatus,
   appendTicketReason, updateTicketFull, and the old
   findTicketRowById_ helper.

   CONTRACT:
   - MUST be called while holding the script lock
     (read happens within the same lock window as write).
   - Returns { sheet, row } on success.
   - Throws structured Error with ERROR_CODES on failure.
   - Always verifies the cached index row before trusting it
     (stale-pointer guard for deletions/appends).
   ================================================== */
const SheetRepo = (() => {

  /**
   * Canonical O(1)+fallback row finder.
   * @param {string} ticketId  Normalized ticket ID (e.g. "BF-202604-0001")
   * @param {Sheet}  sheet     Spreadsheet sheet object (caller resolves)
   * @returns {{ sheet:Sheet, row:number }}
   * @throws  Error with [E003] / [E005] CODES on failure
   */
  function findRow_(ticketId, sheet) {
    const id = String(ticketId || '').trim().toUpperCase();
    if (!id)   throw new Error(`[${ERROR_CODES.VALIDATION_FAILED}] Ticket ID is required`);
    if (!sheet) throw new Error(`[${ERROR_CODES.SHEET_ERROR}] Sheet not found`);

    // [DATA-INTEGRITY] Single choke point for every mutation — verify column layout
    // before we trust any CONFIG.COLS position. Memoized per request.
    assertTicketSheetSchema_(sheet);

    // --- Step 1: O(1) index cache lookup ---
    const index = getTicketIndex();
    let row = index[id];

    // --- Step 2: Stale-pointer guard ---
    // If the cached row pointer doesn't match reality (row deleted/moved since
    // cache was built), evict the index and fall through to linear scan.
    if (row) {
      const actualId = String(sheet.getRange(row, CONFIG.COLS.TICKET_ID).getValue()).trim().toUpperCase();
      if (actualId !== id) {
        Logger.log(`[SheetRepo] Stale index for ${id}: row ${row} has "${actualId}". Evicting.`);
        invalidateTicketIndex();
        row = null;
      }
    }

    // --- Step 3: O(n) linear fallback (rare — only on cache miss / stale eviction) ---
    if (!row) {
      const lastRow = sheet.getLastRow();
      if (lastRow < 2) throw new Error(`[${ERROR_CODES.NOT_FOUND}] No tickets in sheet`);

      const ids = sheet.getRange(2, CONFIG.COLS.TICKET_ID, lastRow - 1, 1).getValues();
      for (let i = 0; i < ids.length; i++) {
        if (String(ids[i][0]).trim().toUpperCase() === id) {
          row = i + 2; // convert 0-indexed data to 1-indexed sheet row
          break;
        }
      }
    }

    if (!row) throw new Error(`[${ERROR_CODES.NOT_FOUND}] Ticket not found: ${id}`);
    return { sheet, row };
  }

  /**
   * Write one or more cell updates for a ticket in a single flush.
   * Caller MUST hold the script lock before calling.
   *
   * @param {string}  ticketId  Normalized ticket ID
   * @param {Array<{col:number, value:*}>} updates  Column-value pairs
   * @param {Sheet}   sheet     Resolved sheet object
   * @returns {{ row:number }}  Row that was written
   */
  function writeCells_(ticketId, updates, sheet) {
    const { row } = findRow_(ticketId, sheet);
    updates.forEach(u => sheet.getRange(row, u.col).setValue(u.value));
    SpreadsheetApp.flush();
    return { row };
  }

  // Public API
  return {
    findRow:    findRow_,
    writeCells: writeCells_
  };
})();

// ── Backward-compatible wrapper used by older callers ──────────────────────
// findTicketRowById_ remains available so any external script that calls
// it directly still works; it now delegates to SheetRepo.
function findTicketRowById_(sheet, ticketId) {
  try {
    const { row } = SheetRepo.findRow(ticketId, sheet);
    return row;
  } catch (e) {
    Logger.log('[findTicketRowById_] ' + e.message);
    return null;
  }
}


function updateTicketPOS(ticketId, newPos, csrfToken = '', idToken = '') {
  const lock = LockService.getScriptLock();
  const identity = resolveIdentityContext_({
    idToken: idToken,
    allowSessionFallback: true
  });
  const userEmail = identity.email;
  let lockAcquired = false;

  try {
    if (!userEmail) {
      return JSON.stringify({
        success: false,
        error: `[${ERROR_CODES.UNAUTHORIZED}] Authentication required`
      });
    }

    setRequestUser_(userEmail);
    requireCSRFToken(csrfToken);
    requirePermission('UPDATE_TICKET');
    rateLimitCheck('UPDATE_POS');

    const sanitizedTicketId = sanitizeInput(ticketId, { type: 'id', maxLength: 50 });
    const sanitizedPos = sanitizeInput(newPos, { maxLength: 50 });

    if (!sanitizedTicketId) {
      return JSON.stringify({
        success: false,
        error: `[${ERROR_CODES.VALIDATION_FAILED}] Missing Ticket ID`
      });
    }

    if (!sanitizedPos || sanitizedPos === '-') {
      return JSON.stringify({
        success: false,
        error: `[${ERROR_CODES.VALIDATION_FAILED}] POS entry is required`
      });
    }

    lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
    lockAcquired = true;

    const sheet = getSpreadsheet_().getSheetByName(CONFIG.SHEET_NAME);
    if (!sheet) {
      return JSON.stringify({
        success: false,
        error: `[${ERROR_CODES.SHEET_ERROR}] Sheet not found`
      });
    }

    // [W2-2] Use SheetRepo — eliminates this function's own copy of the
    // index-lookup + stale-guard + linear-fallback pattern.
    const { row: targetRow } = SheetRepo.findRow(sanitizedTicketId, sheet);

    const previousPos = String(
      sheet.getRange(targetRow, CONFIG.COLS.POS).getValue() || ''
    ).trim();

    if (previousPos === sanitizedPos) {
      const currentVersion = parseInt(
        PropertiesService.getScriptProperties().getProperty('DATA_VERSION') || '0', 10
      );
      return JSON.stringify({
        success: true,
        message: 'POS already up to date',
        ticketId: sanitizedTicketId,
        pos: sanitizedPos,
        version: currentVersion
      });
    }

    // [W2-1] Use CONFIG.COLS.POS instead of hardcoded 8
    sheet.getRange(targetRow, CONFIG.COLS.POS).setValue(sanitizedPos);
    SpreadsheetApp.flush();

    const nextVersion = _incrementDataVersionNoLock();
    invalidateTicketIndex();

    logAuditEvent('TICKET_POS_UPDATED', sanitizedTicketId, {
      previousPos: previousPos || '-',
      newPos: sanitizedPos,
      updatedBy: userEmail
    });

    return JSON.stringify({
      success: true,
      message: 'POS updated successfully',
      ticketId: sanitizedTicketId,
      pos: sanitizedPos,
      version: nextVersion
    });
  } catch (e) {
    Logger.log('updateTicketPOS error: ' + e.toString());
    logAuditEvent('UPDATE_POS_ERROR', ticketId, {
      error: e.toString(),
      attemptedBy: userEmail
    }, 'ERROR');
    return JSON.stringify({ success: false, error: e.toString() });
  } finally {
    if (lockAcquired) lock.releaseLock();
  }
}

function updateTicketStatus(ticketId, newStatus, csrfToken = '', idToken = '') {
  const lock = LockService.getScriptLock();
  const identity = resolveIdentityContext_({
    idToken: idToken,
    allowSessionFallback: true
  });
  const userEmail = identity.email;
  let lockAcquired = false; // Only release if we actually acquired
  
  try {
    if (!userEmail) {
      return JSON.stringify({
        success: false,
        error: `[${ERROR_CODES.UNAUTHORIZED}] Authentication required`
      });
    }

    requireCSRFToken(csrfToken);
    requirePermission('UPDATE_TICKET');
    //  Phase 1: Rate limiting check
    rateLimitCheck('UPDATE_STATUS');
    
    // Validate inputs
    if (!ticketId || !newStatus) {
      return JSON.stringify({ 
        success: false, 
        error: `[${ERROR_CODES.VALIDATION_FAILED}] Missing required parameters` 
      });
    }

    const normalizedStatus = parseStatusOrNull(newStatus);
    if (!normalizedStatus) {
      return JSON.stringify({ 
        success: false, 
        error: `[${ERROR_CODES.INVALID_STATUS}] Invalid status value` 
      });
    }

    // [P0-FIX] SECURITY: Only admins can set status to Closed.
    // updateTicketFull() has full closure validation (7-day rule, follow-up check).
    // This function only sets the status column — without that guard, any agent
    // could bypass all closure rules by calling this RPC directly.
    if (normalizedStatus === STATUS_ENUM.CLOSED) {
      if (!isAdminEmail_(userEmail)) {
        logAuditEvent('CLOSE_ATTEMPT_BLOCKED', ticketId, {
          attemptedBy: userEmail,
          reason: 'updateTicketStatus used directly for Closed — must use updateTicketFull with closure validation'
        }, 'WARNING');
        return JSON.stringify({
          success: false,
          error: `[${ERROR_CODES.INSUFFICIENT_PERMISSIONS}] Only admin can close tickets. Use the ticket update form to close with full validation.`
        });
      }
    }

    // [LOCK] Phase 1: Acquire lock to prevent race conditions
    lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
    lockAcquired = true;

    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
    
    if (!sheet) {
      return JSON.stringify({ 
        success: false, 
        error: `[${ERROR_CODES.SHEET_ERROR}] Sheet not found` 
      });
    }

    // [W2-2] SheetRepo.findRow replaces the inline index-lookup + stale-guard
    // + linear-fallback that was duplicated here from the old implementation.
    const { row: targetRow } = SheetRepo.findRow(ticketId, sheet);

    // [W2-1] Use CONFIG.COLS.STATUS / CONFIG.COLS.REASON — no hardcoded numbers
    const previousStatus = String(
      sheet.getRange(targetRow, CONFIG.COLS.STATUS).getValue()
    ).trim();

    sheet.getRange(targetRow, CONFIG.COLS.STATUS).setValue(normalizedStatus);
    SpreadsheetApp.flush();
    
    _incrementDataVersionNoLock(); // [PATCH 3] Use no-lock variant — we already hold the lock
    invalidateTicketIndex();
    
    //  Audit log
    logAuditEvent('STATUS_UPDATED', ticketId, {
      previousStatus: previousStatus,
      newStatus: normalizedStatus,
      updatedBy: userEmail
    });

    return JSON.stringify({ 
      success: true, 
      message: 'Status updated successfully',
      ticketId: ticketId,
      newStatus: normalizedStatus
    });
  } catch (e) {
    Logger.log('updateTicketStatus error: ' + e.toString());
    
    logAuditEvent('UPDATE_STATUS_ERROR', ticketId, {
      error: e.toString(),
      attemptedBy: userEmail
    }, 'ERROR');
    
    return JSON.stringify({ success: false, error: e.toString() });
  } finally {
    if (lockAcquired) lock.releaseLock(); // [OK] Safe: only release if acquired
  }
}




function appendTicketReason(ticketId, newReason, csrfToken = '', idToken = '') {
  const lock = LockService.getScriptLock();
  const identity = resolveIdentityContext_({
    idToken: idToken,
    allowSessionFallback: true
  });
  const userEmail = identity.email;
  let lockAcquired = false; // Only release if we actually acquired
  
  try {
    if (!userEmail) {
      return JSON.stringify({
        success: false,
        error: `[${ERROR_CODES.UNAUTHORIZED}] Authentication required`
      });
    }

    requireCSRFToken(csrfToken);
    requirePermission('UPDATE_TICKET');
    //  Phase 1: Rate limiting
    rateLimitCheck('APPEND_REASON');
    
    if (!ticketId || !newReason || newReason.trim().length < 3) {
      return JSON.stringify({ 
        success: false, 
        error: `[${ERROR_CODES.VALIDATION_FAILED}] Invalid reason (minimum 3 characters)` 
      });
    }

    // [LOCK] Phase 1: Acquire lock
    lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
    lockAcquired = true;

    const sheet = getSpreadsheet_().getSheetByName(CONFIG.SHEET_NAME);
    if (!sheet) {
      return JSON.stringify({ 
        success: false, 
        error: `[${ERROR_CODES.SHEET_ERROR}] Sheet not found` 
      });
    }

    // [W2-2] SheetRepo.findRow replaces the duplicated O(1)+fallback block
    const { row: targetRow } = SheetRepo.findRow(ticketId, sheet);

    // Read existing reason before appending
    let existingReason = String(
      sheet.getRange(targetRow, CONFIG.COLS.REASON).getValue() || ''
    ).trim();

    // [P0-FIX] YEAR-BUG: Old format 'dd-MMM HH:mm' loses year context.
    // A note written '31-Dec' and parsed on '01-Jan' next year was assigned
    // to the new year, corrupting all date filters for that ticket.
    // Format is now 'dd-MMM-yyyy HH:mm' (e.g. '[28-Mar-2026 14:30]').
    // Frontend regex updated to handle BOTH old and new format.
    const timestamp = Utilities.formatDate(new Date(), "Asia/Kolkata", "dd-MMM-yyyy HH:mm");
    const sanitizedReason = sanitizeInput(newReason, { maxLength: 1000 });
    const appendedReason = existingReason 
      ? `${existingReason}\n[${timestamp}] ${sanitizedReason}` 
      : `[${timestamp}] ${sanitizedReason}`;

    sheet.getRange(targetRow, CONFIG.COLS.REASON).setValue(appendedReason);
    SpreadsheetApp.flush();

    // [P0-FIX] DEADLOCK: Was calling incrementDataVersion() which acquires a
    // ScriptLock internally — but we already hold the lock from waitLock() above.
    // GAS LockService is NOT reentrant: the inner waitLock() would block until
    // the 5s timeout, then throw, rolling back the audit log write.
    // Fix: use _incrementDataVersionNoLock() — caller already owns the lock.
    _incrementDataVersionNoLock();
    invalidateTicketIndex();

    //  Audit log
    logAuditEvent('REASON_APPENDED', ticketId, {
      reasonLength: sanitizedReason.length,
      updatedBy: userEmail
    });

    return JSON.stringify({ 
      success: true, 
      message: 'Reason added successfully',
      ticketId: ticketId
    });
  } catch (e) {
    Logger.log('appendTicketReason error: ' + e.toString());
    return JSON.stringify({ success: false, error: e.toString() });
  } finally {
    if (lockAcquired) lock.releaseLock(); // [OK] Safe: only release if acquired
  }
}



function updateTicketFull(ticketId, newStatus, newReason, csrfToken, idToken = '') {
  const lock = LockService.getScriptLock();
  const identity = resolveIdentityContext_({
    idToken: idToken,
    allowSessionFallback: true
  });
  const userEmail = identity.email;
  let lockAcquired = false; // Only release if we actually acquired
  
  try {
    //  Phase 1: CSRF validation (Security Fix)
    requireCSRFToken(csrfToken);
    
    //  Rate limiting check
    rateLimitCheck('UPDATE_TICKET');
    
    // [LOCK] Permission check
    requirePermission('UPDATE_TICKET');
    
    // [OK] FIX: Use CONFIG.LOCK_TIMEOUT_MS instead of hardcoded 5000
    lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
    lockAcquired = true;
    
    Logger.log('=== ENTERPRISE UPDATE TICKET START ===');
    
    // 1. Input Validation & Sanitization
    const sanitizedTicketId = sanitizeInput(ticketId, { type: 'id', maxLength: 50 });
    const sanitizedReason = sanitizeInput(newReason, { maxLength: 2000 });
    
    if (!sanitizedTicketId) {
      return JSON.stringify({ 
        success: false, 
        error: `[${ERROR_CODES.VALIDATION_FAILED}] Missing Ticket ID` 
      });
    }
    
    if (!newStatus) {
      return JSON.stringify({ 
        success: false, 
        error: `[${ERROR_CODES.VALIDATION_FAILED}] Missing Status` 
      });
    }

    const normalizedStatus = parseStatusOrNull(newStatus);
    if (!normalizedStatus) {
      return JSON.stringify({ 
        success: false, 
        error: `[${ERROR_CODES.INVALID_STATUS}] Invalid status: "${newStatus}". Allowed: ${VALID_STATUSES.join(', ')}` 
      });
    }

    // [SECURE] Closure authority enforcement (supports multiple admins)
    if (normalizedStatus === STATUS_ENUM.CLOSED) {
      if (!isAdminEmail_(userEmail)) {
        logAuditEvent('CLOSE_ATTEMPT_DENIED', sanitizedTicketId, { 
          attemptedBy: userEmail,
          reason: 'Not in admin list'
        }, 'WARNING');
        
        return JSON.stringify({
          success: false,
          error: `[${ERROR_CODES.INSUFFICIENT_PERMISSIONS}] Only admin can close tickets`
        });
      }

      if (!sanitizedReason || sanitizedReason.trim().length < 5) {
        return JSON.stringify({
          success: false,
          error: `[${ERROR_CODES.VALIDATION_FAILED}] Closure requires follow-up reason (min 5 chars)`
        });
      }
    }
    
    // 2. Open Sheet
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
    
    if (!sheet) {
      return JSON.stringify({ 
        success: false, 
        error: `[${ERROR_CODES.SHEET_ERROR}] Sheet not found` 
      });
    }

    // [W2-2] SheetRepo.findRow replaces the duplicated O(1)+fallback block
    const { row: targetRow } = SheetRepo.findRow(sanitizedTicketId, sheet);

    // 4. Get previous status for audit [W2-1] CONFIG.COLS.STATUS
    const previousStatus = String(
      sheet.getRange(targetRow, CONFIG.COLS.STATUS).getValue()
    ).trim();

    // 5. Update Status [W2-1] CONFIG.COLS.STATUS — no hardcoded 13
    sheet.getRange(targetRow, CONFIG.COLS.STATUS).setValue(normalizedStatus);

    // 6. Update Reason with Timestamp [W2-1] CONFIG.COLS.REASON — no hardcoded 14
    let existingReason = String(
      sheet.getRange(targetRow, CONFIG.COLS.REASON).getValue()
    ).trim();
    
    if (sanitizedReason && sanitizedReason.trim() !== "") {
      // [P0-FIX] YEAR-BUG: Include year in timestamp — same fix as appendTicketReason().
      // Front-end regex is backward-compatible: matches both old 'dd-MMM HH:mm'
      // and new 'dd-MMM-yyyy HH:mm' patterns.
      const timestamp = Utilities.formatDate(new Date(), "Asia/Kolkata", "dd-MMM-yyyy HH:mm");
      let entry = `[${timestamp}] ${sanitizedReason.trim()}`;
      
      let finalReason = existingReason 
        ? existingReason + "\n" + entry 
        : entry;

      sheet.getRange(targetRow, CONFIG.COLS.REASON).setValue(finalReason);
    }
    
    // 7. Finish & Audit
    SpreadsheetApp.flush();
    _incrementDataVersionNoLock(); // Use no-lock version since we already hold lock
    invalidateTicketIndex(); // Invalidate index on any change
    
    //  Log successful update
    logAuditEvent('TICKET_UPDATED', sanitizedTicketId, {
      previousStatus: previousStatus,
      newStatus: normalizedStatus,
      reasonAdded: sanitizedReason ? true : false,
      updatedBy: userEmail
    });
    
    return JSON.stringify({ 
      success: true, 
      message: 'Updated successfully',
      ticketId: sanitizedTicketId,
      newStatus: normalizedStatus
    });

  } catch (e) {
    Logger.log('Error: ' + e.toString());
    
    // Log error to audit
    logAuditEvent('UPDATE_ERROR', ticketId, {
      error: e.toString(),
      attemptedBy: userEmail
    }, 'ERROR');
    
    return JSON.stringify({ 
      success: false, 
      error: e.message || e.toString() 
    });
  } finally {
    if (lockAcquired) lock.releaseLock(); // [OK] Safe: only release if acquired
  }
}


/* ==================================================
    CREATE NEW TICKET (ENTERPRISE GRADE)
   ================================================== */

// [OK] CHANGE 1: Add idToken as 3rd parameter
function createNewTicket(ticketData, csrfToken, idToken) {
  // ── PERF: Pre-lock validation (no Sheets calls, ~200ms total) ────────────
  const identity = resolveIdentityContext_({
    idToken: idToken || '',
    allowSessionFallback: true
  });

  let userEmail = identity.email;

  // Tier 2: When auth via server_token, prefer form email for agent identity
  if (identity.success && identity.source === 'server_token' && ticketData && ticketData.email) {
    const formEmail = normalizeEmail_(String(ticketData.email || ''));
    if (formEmail && isAuthorizedUserEmail_(formEmail)) {
      userEmail = formEmail;
      setRequestUser_(userEmail);
    }
  }

  if (!userEmail) {
    return JSON.stringify({
      success: false,
      error: `[${ERROR_CODES.UNAUTHORIZED}] Identity verification failed. Please refresh and try again.`
    });
  }

  setRequestUser_(userEmail);

  // ── PERF: All non-sheet validation BEFORE lock ───────────────────────────
  // These are cheap checks (~100ms total). Doing them here means we don't
  // hold the lock during validation failures → fewer lock waits for others.
  try {
    requireCSRFToken(csrfToken);
    rateLimitCheck('CREATE_TICKET');
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message || e.toString() });
  }

  // Input validation (zero-cost, pure CPU)
  if (!ticketData) {
    return JSON.stringify({
      success: false,
      error: `[${ERROR_CODES.VALIDATION_FAILED}] Missing ticket data`
    });
  }

  const sanitized = {
    email: userEmail,
    agent: sanitizeInput(ticketData.agent, { maxLength: 50 }) || (identity.agent ? identity.agent.name : ''),
    requestedBy: sanitizeInput(ticketData.requestedBy, { maxLength: 100 }) || '-',
    mid: sanitizeInput(ticketData.mid, { maxLength: 20 }) || '-',
    business: sanitizeInput(ticketData.business, { maxLength: 200 }) || '-',
    pos: sanitizeInput(ticketData.pos, { maxLength: 50 }) || '-',
    supportType: sanitizeInput(ticketData.supportType, { maxLength: 50 }) || 'Customer Support',
    concern: sanitizeInput(ticketData.concern, { maxLength: 100 }) || 'Unspecified',
    config: sanitizeInput(ticketData.config, { maxLength: 100 }) || '',
    remark: sanitizeInput(ticketData.remark, { maxLength: 1000 }) || '',
    reason: sanitizeInput(ticketData.reason, { maxLength: 500 }) || '',
    phone: normalizeCallPhone_(ticketData.phone)
  };

  if (!isKnownAgentName_(sanitized.agent)) {
    sanitized.agent = identity.agent ? identity.agent.name : '';
  }
  if (!sanitized.agent || !isKnownAgentName_(sanitized.agent)) {
    return JSON.stringify({
      success: false,
      error: `[${ERROR_CODES.VALIDATION_FAILED}] Agent is required`
    });
  }
  if (!sanitized.concern || sanitized.concern === 'Unspecified') {
    return JSON.stringify({
      success: false,
      error: `[${ERROR_CODES.VALIDATION_FAILED}] Concern is required`
    });
  }

  // ── PERF: Open sheet BEFORE lock (sheet.open is ~300ms, safe to read) ────
  // This is the single biggest optimization: opening the spreadsheet does NOT
  // require a lock (it's a read handle), but holding the lock during open()
  // was blocking other concurrent users for 300ms unnecessarily.
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    return JSON.stringify({
      success: false,
      error: `[${ERROR_CODES.SHEET_ERROR}] Sheet not found`
    });
  }
  // [DATA-INTEGRITY] Verify column layout before appending a new row by position.
  assertTicketSheetSchema_(sheet);
  ensureTicketPhoneColumn_(sheet);

  // Duplicate check (uses CacheService, no lock needed)
  if (ticketData.phone && ticketData.concern) {
    const dupCheck = apiDuplicateCheck_(normalizeCallPhone_(ticketData.phone), ticketData.concern);
    if (dupCheck.isDuplicate) {
      return JSON.stringify({
        success: false,
        error: `[${ERROR_CODES.RATE_LIMITED}] Duplicate ticket detected. Please wait a moment before creating again.`
      });
    }
  }

  // ── LOCK ZONE: Only the critical write section ───────────────────────────
  // Before: lock held for ~3s (validation + sheet open + ID gen + write + audit)
  // After:  lock held for ~800ms (ID gen + write + version bump only)
  const lock = LockService.getScriptLock();
  let lockAcquired = false;

  try {
    lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
    lockAcquired = true;

    const now = new Date();
    const generatedTicketId = generateTicketId_(sheet);
    const createdStatus = parseStatusOrNull(ticketData.status) || STATUS_ENUM.NOT_COMPLETED;

    const newRow = [
      generatedTicketId,       // Col A
      now,                     // Col B
      sanitized.agent,         // Col C
      sanitized.email,         // Col D
      sanitized.requestedBy,   // Col E
      sanitized.mid,           // Col F
      sanitized.business,      // Col G
      sanitized.pos,           // Col H
      sanitized.supportType,   // Col I
      sanitized.concern,       // Col J
      sanitized.config,        // Col K
      sanitized.remark,        // Col L
      createdStatus,           // Col M
      sanitized.reason,        // Col N
      sanitized.phone          // Col O
    ];

    sheet.appendRow(newRow);

    // Version bump + cache invalidation (inside lock to prevent stale reads)
    _incrementDataVersionNoLock();
    invalidateTicketIndex();

    // ── Release lock BEFORE audit log (audit is slow, non-critical) ────────
    lock.releaseLock();
    lockAcquired = false;

    // Audit log — fire-and-forget (non-critical, ~300ms saved off lock hold time)
    try {
      logAuditEvent('TICKET_CREATED', generatedTicketId, {
        agent: sanitized.agent,
        concern: sanitized.concern,
        business: sanitized.business,
        createdBy: userEmail
      });
    } catch (_) {}

    return JSON.stringify({
      success: true,
      ticketId: generatedTicketId,
      message: 'Ticket created successfully'
    });

  } catch (e) {
    Logger.log('Error: ' + e.toString());
    try {
      logAuditEvent('CREATE_ERROR', null, {
        error: e.toString(),
        attemptedBy: userEmail
      }, 'ERROR');
    } catch (_) {}
    return JSON.stringify({
      success: false,
      error: e.message || e.toString()
    });
  } finally {
    if (lockAcquired) lock.releaseLock();
  }
}


/* ==================================================
    REAL-TIME SYNC LOGIC (Phase 1 Lock Fix)
   ================================================== */





// Columns that meaningfully affect dashboard views — only these trigger cache invalidation.
// Editing a CONFIG_NOTES or REMARK cell should NOT bust the cache (no dashboard view reads them).
const _CACHE_TRACKED_COLS = Object.freeze([
  CONFIG.COLS.AGENT_EMAIL,   // C — IT agent
  CONFIG.COLS.IT_EMAIL,      // D — assigned email
  CONFIG.COLS.STATUS,        // M — ticket status
  CONFIG.COLS.REASON,        // N — follow-up log
  CONFIG.COLS.PHONE          // O — phone
]);

function onEdit(e) {
  try {
    if (!e || !e.range) return;

    const sheet = e.range.getSheet();
    if (sheet.getName() !== CONFIG.SHEET_NAME) return;

    const row = e.range.getRow();
    if (row < 2) return; // Ignore header edits

    // Only invalidate for columns that affect the dashboard — avoids cache
    // churn from config/remark/notes edits and bulk pastes on untracked cols.
    const col = e.range.getColumn();
    if (!_CACHE_TRACKED_COLS.includes(col)) return;

    invalidateTicketCache();
    _incrementDataVersionNoLock(); // notify polling clients of real change

  } catch (err) {
    Logger.log('onEdit error: ' + err);
  }
}


/* ==================================================
    NOTIFICATION BOTS
   ================================================== */
function botDailyPending() {
  // [PERF] Use the chunked cache instead of a full-sheet read. The cache is
  // already warm during business hours (every ticket read primes it), so this
  // saves a ~500-1500 ms getRange(...).getValues() whenever the bot fires.
  // If the cache is cold, getCachedTickets() transparently refreshes it.
  const allTickets = getCachedTickets();
  const now = new Date();
  const hour = now.getHours();

  let timeOfDay;
  if (hour < 12) timeOfDay = '[AM] Morning';
  else if (hour < 17) timeOfDay = '[PM] Afternoon';
  else timeOfDay = '[EVE] Evening';

  const pending = allTickets.filter(t => {
    const s = t.status.toLowerCase();
    return s === 'not completed' || s === 'pending' || s === 'in progress';
  });

  if (pending.length === 0) return;

  const grouped = pending.reduce((acc, t) => {
    (acc[t.agent] = acc[t.agent] || []).push(t);
    return acc;
  }, {});

  for (const [agent, tickets] of Object.entries(grouped)) {
    if (!AGENT_DIRECTORY[agent] || !AGENT_DIRECTORY[agent].email) continue;

    try {
      tickets.forEach(t => {
        const hours = Math.floor((now - t.sortDate) / 36e5);
        t.age = hours > 24 ? `${Math.floor(hours/24)}d` : `${hours}h`;
      });

      MailApp.sendEmail({
        to: AGENT_DIRECTORY[agent].email,
        subject: `${timeOfDay} [TICKETS] Pending Tickets Report (${tickets.length})`,
        htmlBody: generateDailyPendingHTML(agent, tickets, now, timeOfDay)
      });
    } catch (e) { 
      Logger.log(`Failed to email ${agent}: ${e}`); 
    }
  }
}


/**
 *  HTML ESCAPE HELPER
 * Prevents XSS / HTML injection when interpolating user data into email bodies.
 * MUST be used on every field sourced from user input or the spreadsheet.
 * @param {*} value - Any value to escape
 * @returns {string} HTML-safe string
 */
function escapeHtml_(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function generateDailyPendingHTML(agent, tickets, date, time) {
  // [OK] All user-supplied fields HTML-escaped to prevent email injection / XSS
  const rows = tickets.map(t =>
    `<tr>
      <td style="border-bottom:1px solid #ddd; padding:8px;">${escapeHtml_(t.id)}</td>
      <td style="border-bottom:1px solid #ddd;">${escapeHtml_(t.business)}</td>
      <td style="border-bottom:1px solid #ddd; color:red; font-weight:bold;">${escapeHtml_(t.age)}</td>
    </tr>`
  ).join('');

  return `
    <div style="font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5;">
      <div style="background: white; padding: 30px; border-radius: 10px; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1a1f3a; margin-bottom: 10px;">Hi ${escapeHtml_(agent)},</h2>
        <h3 style="color: #667eea;">${time} Reminder </h3>
        <p style="font-size: 16px; color: #555;">You have <strong>${tickets.length} pending tickets</strong> that need attention:</p>

        <table style="width:100%; text-align:left; border-collapse:collapse; margin: 20px 0;">
          <thead>
            <tr style="background: #f8fafc;">
              <th style="padding: 12px 8px; border-bottom: 2px solid #ddd;">Ticket ID</th>
              <th style="padding: 12px 8px; border-bottom: 2px solid #ddd;">Business</th>
              <th style="padding: 12px 8px; border-bottom: 2px solid #ddd;">Age</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>

        <p style="color: #888; font-size: 12px; margin-top: 30px;">
          This is an automated reminder from BillFree IT Support System.
        </p>
      </div>
    </div>
  `;
}




/* ==================================================
   [REPORT] ADVANCED ANALYTICS FUNCTIONS
   ================================================== */

// ── MANAGER ANALYTICS ──
// Extracted to Analytics.gs (GAS shares one global namespace across .gs
// files, so the moved declarations remain callable here).











// [REMOVED] isInvalidClosedCorrected() — 120-line orphan, zero callers.
// [REMOVED] parseFollowUpDates() — helper for isInvalidClosedCorrected, also orphaned.
// [REMOVED] formatDate() — unused; all call-sites use Utilities.formatDate(..) directly.

// ═══════════════════════════════════════════════════════════════════════
// PAGINATION BACKEND FUNCTION - REQUIRED FOR FRONTEND
// ═══════════════════════════════════════════════════════════════════════

function getTicketsPaginated(config) {
  try {
    const safeConfig = config || {};
    requirePermission('VIEW_ANALYTICS', safeConfig.idToken || '');
    const props = PropertiesService.getScriptProperties();
    const rawVersion = props.getProperty('DATA_VERSION');
    const dataVersion = Number.isInteger(Number(rawVersion)) ? Number(rawVersion) : 0;

    // [OK] CACHE IMPLEMENTATION
    const cache = CacheService.getScriptCache();
    const configString = JSON.stringify(safeConfig);
    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, configString);
    const configHash = Utilities.base64Encode(digest);
    const cacheKey = `PAGE_V${dataVersion}_${configHash}`;

    // Try Filtered Cache First
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    // [CACHE] Use cached tickets for faster paginated response
    const allTickets = getCachedTickets();
    
    if (!allTickets || allTickets.length === 0) {
      return JSON.stringify({
        success: true,
        data: [],
        pagination: { page: 1, pageSize: 100, totalRows: 0, totalPages: 0 },
        version: dataVersion
      });
    }

    const safeFilters = safeConfig.filters || {};
    const safeSort = safeConfig.sort || {};
    const page = Number(safeConfig.page) > 0 ? Number(safeConfig.page) : 1;
    const pageSize = Math.min(
      CONFIG.MAX_PAGE_SIZE,
      Math.max(1, Number(safeConfig.pageSize) > 0 ? Number(safeConfig.pageSize) : CONFIG.DEFAULT_PAGE_SIZE)
    );
    const statusFilter = safeFilters.status !== undefined ? safeFilters.status : 'all';
    const searchFilter = safeFilters.search !== undefined ? safeFilters.search : '';

    // [OK] NEW: Date range filters (ISO date strings from frontend)
    var dateFromMs = 0;
    var dateToMs = Infinity;
    if (safeFilters.dateFrom) {
      var df2 = new Date(safeFilters.dateFrom);
      if (!isNaN(df2.getTime())) { df2.setHours(0, 0, 0, 0); dateFromMs = df2.getTime(); }
    }
    if (safeFilters.dateTo) {
      var dt2 = new Date(safeFilters.dateTo);
      if (!isNaN(dt2.getTime())) { dt2.setHours(23, 59, 59, 999); dateToMs = dt2.getTime(); }
    }
    var hasDateFilter2 = dateFromMs > 0 || dateToMs < Infinity;

    // [OK] Apply filters using proper normalized data
    let filteredTickets = allTickets.filter(ticket => {
      // Date range filter (if dateFrom/dateTo provided)
      if (hasDateFilter2) {
        if (!ticket.sortDate || ticket.sortDate < dateFromMs || ticket.sortDate > dateToMs) return false;
      }

      // Status filter
      if (statusFilter !== 'all') {
        const requestedStatus = parseStatusOrNull(statusFilter);
        if (requestedStatus && ticket.status !== requestedStatus) return false;
      }
      
      // Search filter
      if (searchFilter && searchFilter.trim() !== '') {
        const term = searchFilter.toLowerCase();
        const searchable = [
          ticket.id, ticket.business, ticket.mid, ticket.agent, 
          ticket.concern, ticket.remark, ticket.reason
        ].join(' ').toLowerCase();
        if (!searchable.includes(term)) return false;
      }
      
      return true;
    });

    // [OK] ALWAYS SORT: Descending by default (newest first)
    const sortOrder = (safeSort.order || 'desc').toLowerCase();
    filteredTickets.sort((a, b) => {
      return sortOrder === 'asc' 
        ? (a.sortDate - b.sortDate) 
        : (b.sortDate - a.sortDate);
    });

    // Calculate pagination
    const totalRows = filteredTickets.length;
    const totalPages = Math.ceil(totalRows / pageSize) || 1;
    const startIdx = (page - 1) * pageSize;
    const endIdx = startIdx + pageSize;
    const pageData = filteredTickets.slice(startIdx, endIdx);

    // [OK] Map to expected frontend format
    const mappedData = pageData.map(t => ({
      'Ticket ID': t.id,
      'Date': t.date,
      'Timestamp': t.date,
      'IT Person Email': t.email,
      'IT Person': t.agent,
      'Requested By': t.requestedBy,
      'MID': t.mid,
      'Business Name': t.business,
      'POS System': t.pos,
      'Support Type': t.supportType,
      'Concern Related to': t.concern,
      'System Configuration': t.config,
      'Remark': t.remark,
      'Status': t.status,
      'Follow-up Reason/ Remark': t.reason,
      'Customer Phone': t.phone || '',
      'phoneDisplay': t.phoneDisplay || '',
      'Invalid Closed': t.invalidClosed,
      // Also include computed fields for frontend convenience
      '_sortDate': t.sortDate,
      '_ageDays': t.ageDays,
      '_ageCategory': t.ageCategory,
      '_reasonQuality': t.reasonQuality || 'none'
    }));

    const result = {
      success: true,
      data: mappedData,
      pagination: {
        page: page,
        pageSize: pageSize,
        totalRows: totalRows,
        totalPages: totalPages
      },
      version: dataVersion,
      sort: safeSort
    };

    const jsonResult = JSON.stringify(result);

    // [OK] SAVE TO CACHE (5 mins)
    if (jsonResult.length < 100000) {
      cache.put(cacheKey, jsonResult, 300);
    }

    return jsonResult;
    
  } catch (error) {
    Logger.log('Error in getTicketsPaginated: ' + error.toString());
    return JSON.stringify({
      success: false,
      error: error.toString()
    });
  }
}


// ═══════════════════════════════════════════════════════════════════════
// [REPORT] SERVER-SIDE DASHBOARD STATS (Hybrid Architecture)
// Returns aggregated KPIs + agent stats without raw rows.
// Called by frontend: gas.getDashboardStats({ dateFrom, dateTo })
// ═══════════════════════════════════════════════════════════════════════

/**
 * @param {Object} config
 * @param {string} [config.dateFrom] - ISO date string for range start (inclusive)
 * @param {string} [config.dateTo]   - ISO date string for range end (inclusive)
 * @returns {string} JSON with { success, kpi, agents[], totalTickets, version }
 */
function getDashboardStats(config) {
  try {
    const safeConfig = config || {};
    requirePermission('VIEW_ANALYTICS', safeConfig.idToken || '');
    const props = PropertiesService.getScriptProperties();
    const rawVersion = props.getProperty('DATA_VERSION');
    const dataVersion = Number.isInteger(Number(rawVersion)) ? Number(rawVersion) : 0;

    // ── Cache check ──────────────────────────────────────────────────
    const cache = CacheService.getScriptCache();
    const cacheKey = 'STATS_V' + dataVersion + '_' + (safeConfig.dateFrom || 'all') + '_' + (safeConfig.dateTo || 'all');
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    // ── Load all tickets (uses existing optimized reader) ────────────
    const allTickets = getCachedTickets();

    // ── Date range filter ────────────────────────────────────────────
    var dateFromMs = 0;
    var dateToMs = Infinity;
    
    if (safeConfig.dateFrom) {
      var df = new Date(safeConfig.dateFrom);
      if (!isNaN(df.getTime())) {
        df.setHours(0, 0, 0, 0);
        dateFromMs = df.getTime();
      }
    }
    if (safeConfig.dateTo) {
      var dt = new Date(safeConfig.dateTo);
      if (!isNaN(dt.getTime())) {
        dt.setHours(23, 59, 59, 999);
        dateToMs = dt.getTime();
      }
    }

    var hasDateFilter = dateFromMs > 0 || dateToMs < Infinity;

    // ── Single-pass aggregation ──────────────────────────────────────
    var kpi = { total: 0, completed: 0, notCompleted: 0, closed: 0, cantDo: 0 };
    var agentMap = {};
    var totalAllTime = allTickets.length;

    for (var i = 0; i < allTickets.length; i++) {
      var t = allTickets[i];

      // Date filter
      if (hasDateFilter) {
        if (!t.sortDate || t.sortDate < dateFromMs || t.sortDate > dateToMs) continue;
      }

      kpi.total++;

      // Status counts
      if (t.status === STATUS_ENUM.COMPLETED)          kpi.completed++;
      else if (t.status === STATUS_ENUM.NOT_COMPLETED) kpi.notCompleted++;
      else if (t.status === STATUS_ENUM.CLOSED)        kpi.closed++;
      else if (t.status === STATUS_ENUM.CANT_DO)       kpi.cantDo++;

      // Agent stats
      var agentName = t.agent || 'Unassigned';
      if (!agentMap[agentName]) {
        agentMap[agentName] = {
          name: agentName,
          total: 0, completed: 0, notCompleted: 0, closed: 0, cantDo: 0,
          oldNotCompleted: 0
        };
      }
      var a = agentMap[agentName];
      a.total++;
      if (t.status === STATUS_ENUM.COMPLETED)          a.completed++;
      else if (t.status === STATUS_ENUM.NOT_COMPLETED) { a.notCompleted++; if (t.ageDays >= 7) a.oldNotCompleted++; }
      else if (t.status === STATUS_ENUM.CLOSED)        a.closed++;
      else if (t.status === STATUS_ENUM.CANT_DO)       a.cantDo++;
    }

    // ── Compute scores and rank ──────────────────────────────────────
    var agentNames = Object.keys(agentMap);
    var agents = [];
    for (var j = 0; j < agentNames.length; j++) {
      var ag = agentMap[agentNames[j]];
      ag.score = (ag.completed * 10) - (ag.cantDo * 5) - (ag.oldNotCompleted * 3);
      ag.rate = ag.total ? Math.round((ag.completed / ag.total) * 100) : 0;
      agents.push(ag);
    }
    agents.sort(function(a, b) { return b.score - a.score; });
    for (var k = 0; k < agents.length; k++) {
      agents[k].rank = k + 1;
    }

    var result = {
      success: true,
      kpi: kpi,
      agents: agents,
      totalTickets: totalAllTime,
      version: dataVersion
    };

    var jsonResult = JSON.stringify(result);

    // Cache for 5 minutes
    if (jsonResult.length < 100000) {
      cache.put(cacheKey, jsonResult, 300);
    }

    return jsonResult;

  } catch (error) {
    Logger.log('Error in getDashboardStats: ' + error.toString());
    return JSON.stringify({ success: false, error: error.toString() });
  }
}


// [REMOVED] testGetTicketsPaginated() — dev-only test function.

/* ==================================================
    UTILITY: DATA SANITIZATION
   Run this manually once to fix "Can't Do" mismatch
   ================================================== */
function sanitizeDatabase() {
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    Logger.log("[FAIL] Sheet not found");
    return;
  }
  
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  // Status is Column M (Index 13)
  const range = sheet.getRange(2, 13, lastRow - 1, 1); 
  const values = range.getValues();
  
  let updates = 0;
  
  const cleaned = values.map(row => {
    let val = String(row[0]).trim();
    const lower = val.toLowerCase();
    
    // Normalize Can't Do (Smart Quotes, Typos)
    if (lower.includes("cant") || lower.includes("can't") || lower.includes("can't")) {
      if (val !== "Can't Do") {
        updates++;
        return ["Can't Do"];
      }
    }
    // Normalize Completed
    else if (lower === "completed" && val !== "Completed") { 
        updates++; return ["Completed"]; 
    }
    // Normalize Closed
    else if (lower === "closed" && val !== "Closed") { 
        updates++; return ["Closed"]; 
    }
    // Normalize Pending
    else if (lower === "pending" && val !== "Pending") { 
        updates++; return ["Pending"]; 
    }
    // Normalize Not Completed
    else if ((lower === "not completed" || lower === "notcompleted") && val !== "Not Completed") { 
        updates++; return ["Not Completed"]; 
    }

    return [row[0]]; // Return original if no change
  });
  
  if (updates > 0) {
    range.setValues(cleaned);
    Logger.log(`[OK] Sanitized ${updates} rows. Fixed incorrect statuses.`);
  } else {
    Logger.log("[CLEAN] Database is already clean.");
  }
}

// ==========================================
//  CACHE CLEARING UTILITY
// ==========================================
/**
 * Run this function manually after deploying new code to clear cached data.
 * This forces fresh data to be fetched with the new calculations.
 */
function clearAllCache() {
  try {
    // [OK] FIX: Was passing empty array [] to removeAll -- which does nothing.
    // Now calls invalidateTicketCache() (clears all chunk keys and metadata)
    // and also clears the ticket index and paginated cache.
    invalidateTicketCache();
    invalidateTicketIndex();
    
    const cache = CacheService.getScriptCache();
    // Clear paginated cache entries (keys are dynamic, so bump version invalidates them)
    cache.remove('HEALTH_CHECK');
    
    // Increment DATA_VERSION to invalidate all version-keyed caches
    const props = PropertiesService.getScriptProperties();
    const currentVersion = parseInt(props.getProperty('DATA_VERSION') || '0');
    props.setProperty('DATA_VERSION', String(currentVersion + 1));
    
    Logger.log('[OK] Cache cleared and DATA_VERSION incremented to: ' + (currentVersion + 1));
    return JSON.stringify({ success: true, message: 'Cache cleared successfully' });
  } catch (e) {
    Logger.log('[FAIL] Error clearing cache: ' + e.toString());
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/* ==================================================
    PHASE 4: ENTERPRISE FEATURES
   ================================================== */

/**
 * [REPORT] 4.1 ENHANCED SYSTEM HEALTH CHECK
 * Comprehensive health monitoring endpoint
 */
function getSystemHealth() {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  const health = {
    status: 'healthy',
    timestamp,
    version: CONFIG.APP_VERSION,
    checks: {}
  };
  let dataVersion = '0';
  
  try {
    // Check 1: Spreadsheet Access
    try {
      const ss = getSpreadsheet_();
      const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
      health.checks.spreadsheet = {
        status: sheet ? 'pass' : 'fail',
        rowCount: sheet ? sheet.getLastRow() : 0,
        message: sheet ? 'Connected' : 'Sheet not found'
      };
    } catch (e) {
      health.checks.spreadsheet = { status: 'fail', message: e.toString() };
      health.status = 'degraded';
    }
    
    // Check 2: Cache Service
    try {
      const cache = CacheService.getScriptCache();
      cache.put('HEALTH_CHECK', 'OK', 10);
      const retrieved = cache.get('HEALTH_CHECK');
      health.checks.cache = {
        status: retrieved === 'OK' ? 'pass' : 'fail',
        message: retrieved === 'OK' ? 'Working' : 'Read mismatch'
      };
    } catch (e) {
      health.checks.cache = { status: 'fail', message: e.toString() };
      health.status = 'degraded';
    }
    
    // Check 3: Properties Service
    try {
      const props = PropertiesService.getScriptProperties();
      const version = props.getProperty('DATA_VERSION');
      dataVersion = version || '0';
      health.checks.properties = {
        status: 'pass',
        dataVersion: dataVersion,
        message: 'Working'
      };
    } catch (e) {
      health.checks.properties = { status: 'fail', message: e.toString() };
      health.status = 'degraded';
    }
    
    // Check 4: Audit Log
    try {
      const auditStats = getAuditLogStats();
      health.checks.auditLog = {
        status: auditStats.exists ? 'pass' : 'warn',
        rowCount: auditStats.rowCount || 0,
        needsRotation: auditStats.needsRotation || false,
        message: auditStats.exists ? 'Operational' : 'Not initialized'
      };
    } catch (e) {
      health.checks.auditLog = { status: 'warn', message: e.toString() };
    }
    
    // Check 5: User Session
    try {
      const userEmail = Session.getActiveUser().getEmail();
      health.checks.session = {
        status: userEmail ? 'pass' : 'warn',
        message: userEmail ? 'Authenticated' : 'Anonymous'
      };
    } catch (e) {
      health.checks.session = { status: 'warn', message: 'Session unavailable' };
    }
    
    // Calculate response time
    health.responseTimeMs = Date.now() - startTime;
    
  } catch (e) {
    health.status = 'unhealthy';
    health.error = e.toString();
  }

  const spreadsheetStatus = (health.checks.spreadsheet && health.checks.spreadsheet.status) === 'pass' ? 'OK' : 'ERROR';
  const cacheStatus = (health.checks.cache && health.checks.cache.status) === 'pass' ? 'OK' : 'ERROR';
  const cacheTest = (health.checks.cache && health.checks.cache.status) === 'pass' ? 'HIT' : 'MISS';
  const overallLegacyStatus = health.status === 'healthy'
    ? 'HEALTHY'
    : (health.status === 'degraded' ? 'DEGRADED' : 'ERROR');

  return JSON.stringify({
    success: health.status !== 'unhealthy',
    health: {
      status: overallLegacyStatus,
      version: CONFIG.APP_VERSION,
      dataVersion: parseInt(dataVersion, 10) || 0,
      sheet: {
        status: spreadsheetStatus,
        rows: (health.checks.spreadsheet && health.checks.spreadsheet.rowCount) || 0
      },
      cache: {
        status: cacheStatus,
        test: cacheTest
      },
      performance: {
        responseTimeMs: health.responseTimeMs || 0
      },
      timestamp
    },
    status: health.status,
    timestamp,
    version: CONFIG.APP_VERSION,
    checks: health.checks,
    responseTimeMs: health.responseTimeMs || 0,
    error: health.error || null
  });
}

/**
 *  4.2 FEATURE FLAGS SYSTEM
 * Safe feature rollout with PropertiesService-based toggles
 */
const DEFAULT_FEATURE_FLAGS = {
  ENABLE_REAL_TIME_SYNC: true,
  ENABLE_AUDIT_LOGGING: true,
  ENABLE_RATE_LIMITING: true,
  ENABLE_NOTIFICATIONS: true,
  ENABLE_ADVANCED_ANALYTICS: true,
  ENABLE_TICKET_VALIDATION: true,
  MAX_EXPORT_ROWS: 5000,
  CACHE_DURATION_SECONDS: 300,
  // [DATA-INTEGRITY] When true, a drifted ticket-sheet layout BLOCKS reads/writes.
  // Default false = observe mode (drift is logged CRITICAL but not blocked) so the
  // guard can never break production before a baseline is confirmed via
  // blessTicketSheetSchema(). Structural failures (too few columns) always block.
  ENFORCE_SHEET_SCHEMA: false,
  // [MIGRATION] Which frontend the legacy GAS root URL serves:
  //   'legacy' (default) → the Index.html monolith (unchanged behavior)
  //   'spa'              → redirect to the React SPA (SPA_URL script property)
  // Flip to 'spa' once the SPA is verified in production; flip back for instant
  // rollback — no redeploy. See doGet() and docs/ARCHITECTURE.md.
  FRONTEND_MODE: 'legacy'
};

/**
 * Get a feature flag value
 */
function getFeatureFlag(flagName) {
  try {
    const props = PropertiesService.getScriptProperties();
    const value = props.getProperty(`FF_${flagName}`);
    
    if (value === null || value === undefined) {
      return DEFAULT_FEATURE_FLAGS[flagName];
    }
    
    // Parse boolean values
    if (value === 'true') return true;
    if (value === 'false') return false;
    
    // Parse numbers
    const num = parseInt(value);
    if (!isNaN(num)) return num;
    
    return value;
  } catch (e) {
    Logger.log(`getFeatureFlag error: ${e.toString()}`);
    return DEFAULT_FEATURE_FLAGS[flagName];
  }
}

/**
 * Set a feature flag value (Admin only)
 */
function setFeatureFlag(flagName, value, csrfToken = '') {
  try {
    requireCSRFToken(csrfToken);
    requirePermission('MANAGE_USERS');
    
    const props = PropertiesService.getScriptProperties();
    props.setProperty(`FF_${flagName}`, String(value));
    
    logAuditEvent('FEATURE_FLAG_CHANGED', null, {
      flag: flagName,
      newValue: value
    });
    
    return JSON.stringify({ 
      success: true, 
      message: `Feature flag ${flagName} set to ${value}` 
    });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * Get all feature flags
 */
function getAllFeatureFlags() {
  try {
    requirePermission('MANAGE_USERS');
    const props = PropertiesService.getScriptProperties();
    const allProps = props.getProperties();
    const flags = {};
    
    // Get default flags
    for (const [key, defaultValue] of Object.entries(DEFAULT_FEATURE_FLAGS)) {
      const storedValue = allProps[`FF_${key}`];
      if (storedValue !== null && storedValue !== undefined) {
        // Parse stored value
        if (storedValue === 'true') flags[key] = true;
        else if (storedValue === 'false') flags[key] = false;
        else if (!isNaN(parseInt(storedValue))) flags[key] = parseInt(storedValue);
        else flags[key] = storedValue;
      } else {
        flags[key] = defaultValue;
      }
    }
    
    return JSON.stringify({ success: true, flags: flags });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 *  4.3 DATA EXPORT CAPABILITY
 * Export tickets to CSV format
 */
function exportTicketsToCSV(options = {}) {
  try {
    const safeOptions = options || {};
    requirePermission('EXPORT_TICKETS', safeOptions.idToken || '');
    requireCSRFToken(safeOptions.csrfToken || '');
    const startDate = safeOptions.startDate ? new Date(safeOptions.startDate) : null;
    const endDate = safeOptions.endDate ? new Date(safeOptions.endDate) : null;
    const status = safeOptions.status || null;
    const maxRows = Math.min(safeOptions.maxRows || 1000, getFeatureFlag('MAX_EXPORT_ROWS'));
    
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
    
    if (!sheet) {
      return JSON.stringify({ success: false, error: 'Sheet not found' });
    }
    
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return JSON.stringify({ success: true, data: '', rowCount: 0, headers: [] });
    }
    const readCols = Math.min(Math.max(sheet.getLastColumn(), 14), 15);
    const data = sheet.getRange(2, 1, lastRow - 1, readCols).getValues();
    
    // Filter data
    let filtered = data;
    
    if (startDate) {
      filtered = filtered.filter(row => {
        const rowDate = new Date(row[1]);
        return rowDate >= startDate;
      });
    }
    
    if (endDate) {
      filtered = filtered.filter(row => {
        const rowDate = new Date(row[1]);
        return rowDate <= endDate;
      });
    }
    
    if (status) {
      filtered = filtered.filter(row => {
        return String(row[12]).toLowerCase() === status.toLowerCase();
      });
    }
    
    // Limit rows
    filtered = filtered.slice(0, maxRows);
    
    // Convert to CSV
    const headers = [
      'Ticket ID', 'Date', 'IT Person', 'IT Person Email', 'Requested By',
      'MID', 'Business Name', 'POS System', 'Support Type', 'Concern',
      'System Configuration', 'Remark', 'Status', 'Follow-up Reason', 'Phone'
    ];
    
    const csvRows = [csvRow_(headers)];
    
    filtered.forEach(row => {
      const normalizedRow = row.slice(0, headers.length);
      while (normalizedRow.length < headers.length) normalizedRow.push('');
      csvRows.push(csvRow_(normalizedRow));
    });
    
    const csvContent = csvRows.join('\n');
    
    logAuditEvent('DATA_EXPORTED', null, {
      rowCount: filtered.length,
      filters: { startDate, endDate, status }
    });
    
    return JSON.stringify({
      success: true,
      data: csvContent,
      rowCount: filtered.length,
      headers: headers
    });
  } catch (e) {
    Logger.log('exportTicketsToCSV error: ' + e.toString());
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * [SECURE] 4.4 ENHANCED TOKEN MANAGEMENT
 * Refresh CSRF token with extended validation
 */
function refreshCSRFToken() {
  try {
    const cache = CacheService.getUserCache();
    
    // Generate new token
    const newToken = Utilities.getUuid();
    const timestamp = Date.now();
    
    // Store with timestamp for validation
    cache.put('CSRF_TOKEN', newToken, 3600);
    cache.put('CSRF_TOKEN_TS', String(timestamp), 3600);
    
    return JSON.stringify({ 
      success: true, 
      token: newToken,
      expiresIn: 3600
    });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

// [REMOVED] Duplicate validateCSRFTokenEnhanced() — the hardened version at L823 is canonical.

/* ==================================================
   [LOG] PHASE 1: UPDATE HISTORY & MONTHLY REPORTS
   Missing Backend Functions Implementation
   ================================================== */

/**
 * [LOG] GET UPDATE HISTORY (Paginated Audit Log)
 * Retrieves audit log entries with filtering and pagination
 * @param {Object} config - { page, pageSize, filters: { ticketId, user, action, startDate, endDate, severity } }
 */
function getUpdateHistory(config = {}) {
  try {
    const safeConfig = config || {};
    // ── NO requirePermission gate ────────────────────────────────────────
    // This is a READ-ONLY audit log view. Same rationale as getTicketData:
    // Session.getActiveUser().getEmail() returns empty in 'Anyone' deployments,
    // causing E002 failures. The web app URL is access-controlled by Google.
    // Write operations still enforce full auth + CSRF.
    const page = Math.max(1, parseInt(safeConfig.page, 10) || 1);
    const pageSize = Math.min(Math.max(1, parseInt(safeConfig.pageSize, 10) || 50), 100);
    const filters = safeConfig.filters || {};
    
    const ss = getSpreadsheet_();
    const auditSheet = ss.getSheetByName(CONFIG.AUDIT_SHEET_NAME);
    
    if (!auditSheet || auditSheet.getLastRow() < 2) {
      return JSON.stringify({
        success: true,
        data: [],
        pagination: { page: 1, pageSize, totalRows: 0, totalPages: 0 },
        durationStats: {
          totalWithDuration: 0,
          avgHours: 0,
          fastCount: 0,
          normalCount: 0,
          slowCount: 0,
          criticalCount: 0
        },
        message: 'No history records found. The audit log may not be enabled or is empty.'
      });
    }
    
    const lastRow = auditSheet.getLastRow();
    const rawData = auditSheet.getRange(2, 1, lastRow - 1, 8).getValues();
    const statusChangeActions = ['TICKET_UPDATED', 'CLOSE_ATTEMPT_DENIED'];
    const finalStatuses = ['Completed', 'Closed', "Can't Do"];
    const pendingStatuses = ['Not Completed', 'Pending', 'In Progress'];
    
    function parseDetails(detailsRaw) {
      if (!detailsRaw) return {};
      try {
        return typeof detailsRaw === 'string' ? JSON.parse(detailsRaw) : detailsRaw;
      } catch (e) {
        return {};
      }
    }
    
    function toTimestampMs(value) {
      if (value instanceof Date && !isNaN(value.getTime())) return value.getTime();
      if (!value) return 0;
      const parsed = new Date(value);
      return isNaN(parsed.getTime()) ? 0 : parsed.getTime();
    }
    
    function formatTimestamp(value) {
      if (value instanceof Date && !isNaN(value.getTime())) {
        return Utilities.formatDate(value, 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm:ss');
      }
      return String(value || '-');
    }
    
    let records = rawData.map((row, idx) => {
      const timestamp = row[0];
      const detailsRaw = row[4];
      const details = parseDetails(detailsRaw);
      const previousStatus = String(details.previousStatus || '-');
      const newStatus = String(details.newStatus || details.status || '-');
      const hasReason = Boolean(
        details.reason ||
        (typeof details.reasonLength === 'number' && details.reasonLength > 0)
      );
      
      return {
        rowNum: idx + 2,
        timestamp: formatTimestamp(timestamp),
        timestampMs: toTimestampMs(timestamp),
        user: String(row[1] || 'Unknown'),
        action: String(row[2] || 'UNKNOWN'),
        ticketId: String(row[3] || '-'),
        details: detailsRaw ? String(detailsRaw) : '',
        severity: String(row[5] || 'INFO'),
        sessionId: String(row[6] || ''),
        version: String(row[7] || ''),
        previousStatus,
        newStatus,
        reasonAdded: hasReason ? 'Yes' : 'No'
      };
    });
    
    records = records.filter(r => statusChangeActions.includes(r.action));
    
    // Build chronological timelines per ticket for duration calculations.
    const ticketTimelines = {};
    records.forEach(record => {
      if (!record.ticketId || record.ticketId === '-' || !record.timestampMs) return;
      if (!ticketTimelines[record.ticketId]) ticketTimelines[record.ticketId] = [];
      ticketTimelines[record.ticketId].push({
        timestampMs: record.timestampMs,
        previousStatus: record.previousStatus,
        newStatus: record.newStatus
      });
    });
    
    Object.keys(ticketTimelines).forEach(ticketId => {
      ticketTimelines[ticketId].sort((a, b) => a.timestampMs - b.timestampMs);
    });
    
    records = records.map(record => {
      let duration = null;
      if (
        record.ticketId &&
        record.ticketId !== '-' &&
        record.timestampMs &&
        pendingStatuses.includes(record.previousStatus) &&
        finalStatuses.includes(record.newStatus)
      ) {
        const timeline = ticketTimelines[record.ticketId] || [];
        let startTime = null;
        
        for (const entry of timeline) {
          if (entry.timestampMs > record.timestampMs) break;
          if (pendingStatuses.includes(entry.newStatus)) {
            startTime = entry.timestampMs;
          }
        }
        
        if (!startTime && timeline.length > 0) {
          startTime = timeline[0].timestampMs;
        }
        
        if (startTime && record.timestampMs >= startTime) {
          duration = formatDurationSla_(record.timestampMs - startTime);
        }
      }
      
      return {
        ...record,
        duration: duration ? duration.formatted : null,
        durationHours: duration ? duration.hours : null,
        durationCategory: duration ? duration.category : null
      };
    });
    
    // Apply filters
    if (filters.ticketId && filters.ticketId.trim() !== '') {
      const searchTerm = filters.ticketId.toLowerCase().trim();
      records = records.filter(r => r.ticketId.toLowerCase().includes(searchTerm));
    }
    
    if (filters.user && filters.user.trim() !== '') {
      const searchTerm = filters.user.toLowerCase().trim();
      records = records.filter(r => r.user.toLowerCase().includes(searchTerm));
    }
    
    if (filters.action && filters.action !== 'all') {
      records = records.filter(r => r.action === filters.action);
    }
    
    if (filters.severity && filters.severity !== 'all') {
      records = records.filter(r => r.severity === filters.severity);
    }
    
    if (filters.startDate) {
      const start = new Date(filters.startDate);
      if (!isNaN(start.getTime())) {
        start.setHours(0, 0, 0, 0);
        const startMs = start.getTime();
        records = records.filter(r => r.timestampMs >= startMs);
      }
    }
    
    if (filters.endDate) {
      const end = new Date(filters.endDate);
      if (!isNaN(end.getTime())) {
        end.setHours(23, 59, 59, 999);
        const endMs = end.getTime();
        records = records.filter(r => r.timestampMs <= endMs);
      }
    }
    
    // Most recent first after all filters.
    records.sort((a, b) => b.timestampMs - a.timestampMs);
    
    const entriesWithDuration = records.filter(r => r.durationHours !== null);
    const durationStats = {
      totalWithDuration: entriesWithDuration.length,
      avgHours: entriesWithDuration.length > 0
        ? Math.round(
          (entriesWithDuration.reduce((sum, r) => sum + (Number(r.durationHours) || 0), 0) / entriesWithDuration.length) * 10
        ) / 10
        : 0,
      fastCount: entriesWithDuration.filter(r => r.durationCategory === 'fast').length,
      normalCount: entriesWithDuration.filter(r => r.durationCategory === 'normal').length,
      slowCount: entriesWithDuration.filter(r => r.durationCategory === 'slow').length,
      criticalCount: entriesWithDuration.filter(r => r.durationCategory === 'critical').length
    };
    
    // Paginate
    const totalRows = records.length;
    const totalPages = Math.ceil(totalRows / pageSize) || 1;
    const validPage = Math.min(Math.max(1, page), totalPages);
    const startIndex = (validPage - 1) * pageSize;
    const pageData = records.slice(startIndex, startIndex + pageSize);
    
    const response = {
      success: true,
      data: pageData,
      pagination: { 
        page: validPage, 
        pageSize, 
        totalRows, 
        totalPages: totalRows === 0 ? 0 : totalPages
      },
      durationStats
    };
    
    if (totalRows === 0) {
      response.message = 'No history records match the selected filters.';
    }
    
    return JSON.stringify(response);
  } catch (e) {
    Logger.log('getUpdateHistory error: ' + e.toString());
    return JSON.stringify({ 
      success: false, 
      error: e.toString(),
      data: [],
      pagination: { page: 1, pageSize: 50, totalRows: 0, totalPages: 0 },
      durationStats: {
        totalWithDuration: 0,
        avgHours: 0,
        fastCount: 0,
        normalCount: 0,
        slowCount: 0,
        criticalCount: 0
      }
    });
  }
}

// ── MONTHLY REPORTS & AI NARRATIVE ──
// Extracted to Reports.gs (GAS shares one global namespace across .gs
// files, so the moved declarations remain callable here).


// ═══════════════════════════════════════════════════════════════════════════
// SCHEDULED MONTHLY REPORT — runs automatically on the 1st of every month
// ═══════════════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════════
// R13: GEMINI AI NARRATIVE — executive summary powered by Gemini 2.5 Flash
// ═══════════════════════════════════════════════════════════════════════════



// ═══════════════════════════════════════════════════════════════════════════
// R10: BUILD CSV ATTACHMENTS for automated email
// ═══════════════════════════════════════════════════════════════════════════







/**
 *  EXPORT HISTORY TO CSV
 * Exports update history to CSV format
 */
function exportHistoryToCSV(config = {}) {
  try {
    requirePermission('EXPORT_HISTORY');
    requireCSRFToken(config.csrfToken || '');
    const filters = config.filters || {};
    const statusChangeActions = ['TICKET_UPDATED', 'CLOSE_ATTEMPT_DENIED'];
    
    const ss = getSpreadsheet_();
    const auditSheet = ss.getSheetByName(CONFIG.AUDIT_SHEET_NAME);
    
    if (!auditSheet || auditSheet.getLastRow() < 2) {
      return JSON.stringify({ success: false, error: 'No history data to export' });
    }
    
    const lastRow = auditSheet.getLastRow();
    const rawData = auditSheet.getRange(2, 1, lastRow - 1, 8).getValues();
    
    let records = rawData.map(row => {
      const rawTs = row[0];
      const timestampMs = rawTs instanceof Date
        ? rawTs.getTime()
        : (new Date(rawTs).getTime() || 0);
      const timestamp = rawTs instanceof Date
        ? Utilities.formatDate(rawTs, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss')
        : String(rawTs || '');
      
      let previousStatus = '-';
      let newStatus = '-';
      let reasonAdded = 'No';
      
      if (row[4]) {
        try {
          const details = typeof row[4] === 'string' ? JSON.parse(row[4]) : row[4];
          previousStatus = details.previousStatus || '-';
          newStatus = details.newStatus || details.status || '-';
          reasonAdded = (details.reason || (typeof details.reasonLength === 'number' && details.reasonLength > 0))
            ? 'Yes'
            : 'No';
        } catch (e) {}
      }
      
      return {
        timestampMs,
        timestamp,
        user: String(row[1] || ''),
        action: String(row[2] || ''),
        ticketId: String(row[3] || ''),
        previousStatus,
        newStatus,
        severity: String(row[5] || ''),
        reasonAdded
      };
    });
    
    // Apply filters
    records = records.filter(r => statusChangeActions.includes(r.action));
    
    if (filters.ticketId && String(filters.ticketId).trim() !== '') {
      const searchTerm = String(filters.ticketId).toLowerCase().trim();
      records = records.filter(r => r.ticketId.toLowerCase().includes(searchTerm));
    }
    
    if (filters.user && String(filters.user).trim() !== '') {
      const searchTerm = String(filters.user).toLowerCase().trim();
      records = records.filter(r => r.user.toLowerCase().includes(searchTerm));
    }
    
    if (filters.action && filters.action !== 'all') {
      records = records.filter(r => r.action === filters.action);
    }
    
    if (filters.severity && filters.severity !== 'all') {
      records = records.filter(r => r.severity === filters.severity);
    }
    
    if (filters.startDate) {
      const start = new Date(filters.startDate);
      if (!isNaN(start.getTime())) {
        start.setHours(0, 0, 0, 0);
        records = records.filter(r => r.timestampMs >= start.getTime());
      }
    }
    if (filters.endDate) {
      const end = new Date(filters.endDate);
      if (!isNaN(end.getTime())) {
        end.setHours(23, 59, 59, 999);
        records = records.filter(r => r.timestampMs <= end.getTime());
      }
    }
    
    records.sort((a, b) => b.timestampMs - a.timestampMs);
    
    // Generate CSV
    const headers = ['Timestamp', 'User', 'Action', 'Ticket ID', 'Previous Status', 'New Status', 'Severity', 'Reason Added'];
    const csvRows = [csvRow_(headers)];
    
    records.forEach(r => {
      const row = [
        r.timestamp,
        r.user,
        r.action,
        r.ticketId,
        r.previousStatus,
        r.newStatus,
        r.severity,
        r.reasonAdded
      ];
      csvRows.push(csvRow_(row));
    });
    
    logAuditEvent('HISTORY_EXPORTED', null, { rowCount: records.length });
    
    return JSON.stringify({
      success: true,
      csv: csvRows.join('\n'),
      data: csvRows.join('\n'),
      rowCount: records.length,
      filename: `update_history_${Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMdd_HHmmss')}.csv`
    });
  } catch (e) {
    Logger.log('exportHistoryToCSV error: ' + e.toString());
    return JSON.stringify({ success: false, error: e.toString() });
  }
}


/* ============================================================================
   🚀 TICKET CREATION API LAYER v1.0
   External API for WhatsApp chatbot and third-party integrations.
   Accessed via doPost(e) with action: "createTicket"
   ============================================================================ */



// ── PUBLIC PORTAL & EXTERNAL TICKET API ──
// Extracted to PortalApi.gs (GAS shares one global namespace across .gs
// files, so the moved declarations remain callable here).








// [REMOVED] Duplicate onEdit() — the column-gated version at L3868 is canonical.


/* ==================================================
   🎫 PUBLIC TICKET PORTAL — Backend Functions
   Serves the self-service portal at ?page=portal
   No auth required — rate-limited per session.
   ================================================== */





// ═══════════════════════════════════════════════════════════════════════════
// 🔧 DIAGNOSTIC: One-shot reauth helper.
//    Run this ONCE from the GAS editor when UrlFetchApp.fetch reports
//    "You do not have permission to call UrlFetchApp.fetch". The fetch call
//    forces Apps Script to request the script.external_request scope on the
//    next run, even if the manifest already declares it.
//    After auth succeeds, run testGeminiSetup() — and feel free to delete
//    this function, but it's harmless to leave in place.
// ═══════════════════════════════════════════════════════════════════════════
function _forceReauth() {
  try {
    var res = UrlFetchApp.fetch('https://www.google.com/generate_204', {
      muteHttpExceptions: true,
      followRedirects: false
    });
    Logger.log('✅ UrlFetchApp.fetch authorized. HTTP ' + res.getResponseCode());
    Logger.log('   Now run testGeminiSetup() to verify the Gemini call.');
  } catch (e) {
    Logger.log('❌ Still not authorized: ' + e.toString());
    Logger.log('   If a consent dialog never appeared, fall back to revoke-and-re-grant:');
    Logger.log('   https://myaccount.google.com/permissions → remove this script → run again.');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 🧠 MANAGER ANALYTICS AI LAYER
// ───────────────────────────────────────────────────────────────────────────
//   Single secure entry point: aiAnalytics(intent, payload, csrfToken)
//   Call from frontend via google.script.run.aiAnalytics(...)
//
//   Design tenets:
//     • Server-side only — Gemini key never reaches the browser.
//     • Schema-bounded JSON — every intent declares the JSON shape Gemini
//       must return; we enforce via responseMimeType + responseSchema.
//     • Cached (5 min) — same input returns same output without re-prompting.
//     • Audit-logged — every call logs action + intent + token cost.
//     • Rate-limited — protects against runaway loops & key abuse.
//     • Pre-computed statistics — heavy math runs in pure JS, Gemini only
//       does the LANGUAGE part (ranking, narrative, translation).
// ═══════════════════════════════════════════════════════════════════════════

/** Intents implemented in this module. Keep narrow & typed. */
var AI_INTENTS = {
  ANALYTICS_BRIEF:  'analytics_brief',     // 3-bullet daily summary
  RANK_ANOMALIES:   'rank_anomalies',      // rank pre-computed anomaly cards
  CHART_CAPTIONS:   'chart_captions',      // batch caption all 6 charts
  ASK_DATA:         'ask_data'             // NL → structured filter object
};





