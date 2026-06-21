/**
 * ════════════════════════════════════════════════════════════════════════
 *  Call Log & Telephony CDR   (extracted module)
 * ════════════════════════════════════════════════════════════════════════
 * Extracted from Code.gs. In Google Apps Script all .gs files share ONE global
 * namespace, so these declarations remain callable everywhere unchanged.
 */

const CALL_EVENT_TYPES = Object.freeze([
  'CALL_INITIATED',
  'CALL_DISPOSITION',
  'CALL_CONNECTED',
  'CALL_COMPLETED',
  'CALL_NO_ANSWER',
  'CALL_FAILED',
  'PROVIDER_CDR'
]);

const CALL_OUTCOME_TYPES = Object.freeze([
  '',
  'CONNECTED',
  'NO_ANSWER',
  'BUSY',
  'SWITCHED_OFF',
  'WRONG_NUMBER',
  'CALLBACK_REQUESTED',
  'FAILED',
  'OTHER'
]);

const CALL_LOG_HEADERS = Object.freeze([
  'Timestamp',
  'Event ID',
  'Ticket ID',
  'MID',
  'Business',
  'Customer Phone',
  'Agent Email',
  'Agent Name',
  'Agent Role',
  'Event Type',
  'Outcome',
  'Duration Sec',
  'Channel',
  'Provider',
  'Provider Call ID',
  'Source',
  'Notes',
  'Session Key',
  'Verified'
]);

function normalizeCallPhone_(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const cleaned = raw.replace(/[^\d+]/g, '');
  return cleaned.substring(0, 20);
}

function formatPhoneDisplay_(value) {
  const phone = normalizeCallPhone_(value).replace(/^\+/, '');
  if (!phone) return '';
  if (phone.length === 10) return `${phone.slice(0, 5)} ${phone.slice(5)}`;
  if (phone.length === 12 && phone.startsWith('91')) {
    return `+91 ${phone.slice(2, 7)} ${phone.slice(7)}`;
  }
  return value ? String(value) : '';
}

// [CACHE] Module-level flag -- avoids re-reading the sheet header on every ticket create.
// GAS resets module state between requests, so no staleness risk.
let _phoneColumnEnsured = false;

function ensureTicketPhoneColumn_(sheet) {
  if (_phoneColumnEnsured) return;
  if (!sheet) return;
  const phoneCol = 15;
  const headerValue = String(sheet.getRange(1, phoneCol).getValue() || '').trim();
  if (!headerValue) {
    sheet.getRange(1, phoneCol).setValue('Phone');
  }
  _phoneColumnEnsured = true;
}

function generateCallEventId_(timestamp = new Date()) {
  return `CALL-${Utilities.formatDate(timestamp, 'Asia/Kolkata', 'yyyyMMddHHmmss')}-${Utilities.getUuid().substring(0, 8)}`;
}

function parseDurationSec_(value) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function getAgentNameByEmail_(email) {
  const agent = getAgentByEmail(email);
  return agent ? agent.name : String(email || 'Unknown');
}

function ensureCallLogSheet_() {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(CONFIG.CALL_LOG_SHEET_NAME);
  if (sheet) return sheet;

  sheet = ss.insertSheet(CONFIG.CALL_LOG_SHEET_NAME);
  sheet.getRange(1, 1, 1, CALL_LOG_HEADERS.length).setValues([CALL_LOG_HEADERS]);
  sheet.getRange(1, 1, 1, CALL_LOG_HEADERS.length).setFontWeight('bold').setBackground('#E2E8F0');
  sheet.setFrozenRows(1);
  return sheet;
}

function appendCallLogRow_(entry) {
  const eventType = String(entry.eventType || '').toUpperCase();
  const outcome = String(entry.outcome || '').toUpperCase();
  if (!CALL_EVENT_TYPES.includes(eventType)) {
    throw new Error(`[${ERROR_CODES.VALIDATION_FAILED}] Invalid eventType: ${eventType}`);
  }
  if (!CALL_OUTCOME_TYPES.includes(outcome)) {
    throw new Error(`[${ERROR_CODES.VALIDATION_FAILED}] Invalid outcome: ${outcome}`);
  }

  const timestamp = entry.timestamp || new Date();
  const eventId = entry.eventId || generateCallEventId_(timestamp);
  const verified = String(entry.verified || '').toUpperCase() === 'YES' ? 'YES' : 'NO';

  ensureCallLogSheet_().appendRow([
    timestamp,
    eventId,
    entry.ticketId || '-',
    entry.mid || '-',
    entry.business || '-',
    normalizeCallPhone_(entry.customerPhone),
    entry.agentEmail || 'unknown',
    entry.agentName || 'Unknown',
    entry.role || ROLES.AGENT,
    eventType,
    outcome,
    parseDurationSec_(entry.durationSec),
    entry.channel || 'WEBAPP',
    entry.provider || '',
    entry.providerCallId || '',
    entry.source || 'WEBAPP',
    entry.notes || '',
    entry.sessionKey || '',
    verified
  ]);

  return eventId;
}

function normalizeProviderOutcome_(rawOutcome, rawStatus) {
  const value = String(rawOutcome || rawStatus || '').trim().toLowerCase();
  if (!value) return '';

  if (/connected|answered|completed|success|human/.test(value)) return 'CONNECTED';
  if (/no[\s_-]?answer|unanswered|ring[\s_-]?timeout/.test(value)) return 'NO_ANSWER';
  if (/busy/.test(value)) return 'BUSY';
  if (/switched[\s_-]?off|not[\s_-]?reachable|unreachable|power[\s_-]?off/.test(value)) return 'SWITCHED_OFF';
  if (/wrong[\s_-]?number|invalid[\s_-]?number/.test(value)) return 'WRONG_NUMBER';
  if (/callback/.test(value)) return 'CALLBACK_REQUESTED';
  if (/fail|error|cancel|rejected|blocked|missed/.test(value)) return 'FAILED';
  return 'OTHER';
}

// [W2-3] O(1) CDR DEDUP — ScriptProperties HMAC fingerprint
//
// PROBLEM: Previous implementation scanned up to 2,000 sheet rows on every
// provider webhook call (O(n) sheet.getRange().getValues()). At ~200+ CDR
// events/day this adds ~500ms per ingest and grows linearly with log size.
//
// SOLUTION: Compute a 20-character HMAC-SHA256 fingerprint of the 4 fields
// that uniquely identify a CDR event:
//   fingerprint = base64(HMAC-SHA256("callId|eventType|outcome|durationSec"))[0..19]
//
// Store as ScriptProperty with key = 'CDR_' + fingerprint.
// Lookup and write cost ~1ms each (Properties API, no sheet access).
//
// ScriptProperty limits (500KB total, 9KB per key): fingerprints are 4 bytes
// each ('CDR_' prefix + 20-char value) so we can store ~100,000 events before
// hitting the space limit. A quarterly cleanup is sufficient.
//
// Falls back to false (allow-in) on any error to prevent write-blocking.
//
function isDuplicateProviderCdrEvent_(providerCallId, eventType, outcome, durationSec) {
  const callId = String(providerCallId || '').trim();
  if (!callId) return false;  // No call ID = can't dedup, allow through

  try {
    const secret = getServerTokenSecret_(); // HMAC secret, already used for server tokens
    const payload = [callId, String(eventType || ''), String(outcome || ''), String(durationSec || 0)].join('|');

    const hmacBytes = Utilities.computeHmacSha256Signature(payload, secret);
    const fingerprint = Utilities.base64Encode(hmacBytes).substring(0, 20);
    const propKey = 'CDR_' + fingerprint;

    const props = PropertiesService.getScriptProperties();
    if (props.getProperty(propKey) !== null) {
      Logger.log('[CDR-Dedup] Duplicate fingerprint ' + fingerprint + ' for callId=' + callId);
      return true;  // Already seen
    }

    // Mark as seen (value irrelevant, presence is the signal)
    props.setProperty(propKey, '1');
    return false;
  } catch (e) {
    // Fail open: log the error but allow the event through
    // (better to ingest a duplicate than to drop a real event)
    Logger.log('[CDR-Dedup] Fingerprint error (allow-in): ' + e.toString());
    return false;
  }
}

/**
 * Admin utility: clear all CDR dedup fingerprints from ScriptProperties.
 * Run manually in Apps Script editor when ScriptProperties is getting full.
 * Usage: clearCdrDedupeIndex_()
 */
function clearCdrDedupeIndex_() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  const cdrKeys = Object.keys(all).filter(k => k.startsWith('CDR_'));
  cdrKeys.forEach(k => props.deleteProperty(k));
  Logger.log('[CDR-Dedup] Cleared ' + cdrKeys.length + ' dedup fingerprints from ScriptProperties.');
  return { cleared: cdrKeys.length };
}

function ingestProviderCdrEvent_(payload = {}) {
  const now = new Date();
  const provider = sanitizeInput(payload.provider || payload.vendor || payload.gateway || 'UNKNOWN', { maxLength: 50 }).toUpperCase();
  const providerCallId = sanitizeInput(
    payload.providerCallId || payload.callId || payload.call_id || payload.sid || payload.uuid,
    { maxLength: 100 }
  );
  if (!providerCallId) {
    return { success: false, error: '[E004] Missing provider call ID in webhook payload' };
  }

  const requestedEvent = sanitizeInput(payload.eventType || payload.event || 'PROVIDER_CDR', { maxLength: 50 }).toUpperCase();
  const eventType = CALL_EVENT_TYPES.includes(requestedEvent) ? requestedEvent : 'PROVIDER_CDR';
  const outcome = normalizeProviderOutcome_(payload.outcome, payload.status || payload.callStatus || payload.disposition);
  const durationSec = parseDurationSec_(
    payload.durationSec || payload.duration || payload.billsec || payload.talkTime || payload.talk_time
  );

  if (isDuplicateProviderCdrEvent_(providerCallId, eventType, outcome, durationSec)) {
    return {
      success: true,
      duplicate: true,
      providerCallId,
      message: 'Duplicate provider CDR event ignored'
    };
  }

  const ticketId = sanitizeInput(payload.ticketId || payload.ticket_id || payload.referenceId, { type: 'id', maxLength: 100 }) || '-';
  const mid = sanitizeInput(payload.mid || payload.merchantId || payload.merchant_id, { maxLength: 50 }) || '-';
  const business = sanitizeInput(payload.business || payload.businessName || payload.customerName, { maxLength: 200 }) || '-';
  const customerPhone = normalizeCallPhone_(payload.customerPhone || payload.phone || payload.to || payload.customer_number);
  const statusText = sanitizeInput(payload.status || payload.callStatus || payload.disposition, { maxLength: 100 });
  const agentEmail = sanitizeInput(
    payload.agentEmail || payload.agent_email || payload.userEmail || 'provider.webhook@system.local',
    { type: 'email', maxLength: 255 }
  ) || 'provider.webhook@system.local';
  const agentName = sanitizeInput(payload.agentName || payload.agent || 'Provider Webhook', { maxLength: 100 }) || 'Provider Webhook';
  const notes = sanitizeInput(payload.notes || payload.note || (statusText ? `provider_status=${statusText}` : ''), { maxLength: 1000 });

  const eventId = appendCallLogRow_({
    timestamp: now,
    ticketId,
    mid,
    business,
    customerPhone,
    agentEmail,
    agentName,
    role: ROLES.SYSTEM,
    eventType,
    outcome,
    durationSec,
    channel: (sanitizeInput(payload.channel || 'PROVIDER_CDR', { maxLength: 50 }) || 'PROVIDER_CDR').toUpperCase(),
    provider,
    providerCallId,
    source: 'PROVIDER_WEBHOOK',
    notes,
    sessionKey: 'WEBHOOK',
    verified: 'YES'
  });

  logAuditEvent('PROVIDER_CDR_RECEIVED', ticketId, {
    eventId,
    provider,
    providerCallId,
    eventType,
    outcome,
    durationSec
  }, 'INFO');

  return {
    success: true,
    duplicate: false,
    eventId,
    provider,
    providerCallId,
    outcome
  };
}

function logCallEvent(callData = {}, csrfToken = '', idToken = '') {
  const lock = LockService.getScriptLock();
  const now = new Date();
  const identity = resolveIdentityContext_({
    idToken: idToken,
    allowSessionFallback: true
  });
  const userEmail = identity.email || 'unknown';
  let lockAcquired = false;
  try {
    // Authentication guard: userEmail defaults to 'unknown' when session is unavailable.
    requireCSRFToken(csrfToken);
    requirePermission('CALL_LOG_EVENT');
    lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
    lockAcquired = true;

    if (!callData || typeof callData !== 'object') {
      return JSON.stringify({ success: false, error: `[${ERROR_CODES.VALIDATION_FAILED}] Missing call payload` });
    }

    const ticketId = sanitizeInput(callData.ticketId, { type: 'id', maxLength: 100 }) || '-';
    const mid = sanitizeInput(callData.mid, { maxLength: 50 }) || '-';
    const business = sanitizeInput(callData.business, { maxLength: 200 }) || '-';
    const customerPhone = normalizeCallPhone_(callData.customerPhone);
    const requestedEventType = sanitizeInput(callData.eventType, { maxLength: 50 }) || 'CALL_INITIATED';
    const eventType = requestedEventType.toUpperCase();
    const outcomeRaw = sanitizeInput(callData.outcome, { maxLength: 50 }) || '';
    const outcome = outcomeRaw.toUpperCase();
    const durationSec = parseDurationSec_(callData.durationSec);
    const channel = (sanitizeInput(callData.channel, { maxLength: 50 }) || 'WEBAPP').toUpperCase();
    const provider = sanitizeInput(callData.provider, { maxLength: 50 }) || '';
    const providerCallId = sanitizeInput(callData.providerCallId, { maxLength: 100 }) || '';
    const source = (sanitizeInput(callData.source, { maxLength: 50 }) || 'WEBAPP_UI').toUpperCase();
    const notes = sanitizeInput(callData.notes, { maxLength: 1000 }) || '';

    if (!CALL_EVENT_TYPES.includes(eventType)) {
      return JSON.stringify({ success: false, error: `[${ERROR_CODES.VALIDATION_FAILED}] Invalid eventType: ${eventType}` });
    }
    if (!CALL_OUTCOME_TYPES.includes(outcome)) {
      return JSON.stringify({ success: false, error: `[${ERROR_CODES.VALIDATION_FAILED}] Invalid outcome: ${outcome}` });
    }

    const eventId = appendCallLogRow_({
      timestamp: now,
      ticketId,
      mid,
      business,
      customerPhone,
      agentEmail: userEmail,
      agentName: getAgentNameByEmail_(userEmail),
      role: getUserRole(userEmail),
      eventType,
      outcome,
      durationSec,
      channel,
      provider,
      providerCallId,
      source,
      notes,
      sessionKey: Session.getTemporaryActiveUserKey() || '',
      verified: 'NO'
    });

    logAuditEvent('CALL_EVENT_LOGGED', ticketId, {
      eventId,
      eventType,
      outcome,
      channel,
      durationSec,
      source
    }, 'INFO');

    return JSON.stringify({ success: true, eventId, timestamp: now.toISOString() });
  } catch (e) {
    Logger.log('logCallEvent error: ' + e.toString());
    return JSON.stringify({ success: false, error: e.message || e.toString() });
  } finally {
    if (lockAcquired) lock.releaseLock();
  }
}

function getCallHistory(config = {}) {
  try {
    const safeConfig = config || {};
    requirePermission('CALL_LOG_EVENT', safeConfig.idToken || '');
    const page = Math.max(1, parseInt(safeConfig.page, 10) || 1);
    const pageSize = Math.min(Math.max(1, parseInt(safeConfig.pageSize, 10) || 50), 200);
    const filters = safeConfig.filters || {};
    const currentUserEmail = normalizeEmail_(getSessionEmail_()) || '';

    const role = getUserRole(currentUserEmail);
    const canViewAll = isAdminEmail_(currentUserEmail) || role === ROLES.ADMIN || role === ROLES.MANAGER;

    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName(CONFIG.CALL_LOG_SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) {
      return JSON.stringify({
        success: true,
        data: [],
        pagination: { page: 1, pageSize, totalRows: 0, totalPages: 0 },
        message: 'No call records found.'
      });
    }

    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, CALL_LOG_HEADERS.length).getValues();
    let records = rows.map(row => {
      const ts = row[0];
      const timestampMs = ts instanceof Date ? ts.getTime() : (new Date(ts).getTime() || 0);
      return {
        timestamp: ts instanceof Date ? Utilities.formatDate(ts, 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm:ss') : String(ts || ''),
        timestampMs: timestampMs,
        eventId: String(row[1] || ''),
        ticketId: String(row[2] || ''),
        mid: String(row[3] || ''),
        business: String(row[4] || ''),
        customerPhone: String(row[5] || ''),
        customerPhoneDisplay: formatPhoneDisplay_(row[5]),
        agentEmail: String(row[6] || ''),
        agentName: String(row[7] || ''),
        role: String(row[8] || ''),
        eventType: String(row[9] || ''),
        outcome: String(row[10] || ''),
        durationSec: parseDurationSec_(row[11]),
        channel: String(row[12] || ''),
        provider: String(row[13] || ''),
        providerCallId: String(row[14] || ''),
        source: String(row[15] || ''),
        notes: String(row[16] || ''),
        sessionKey: String(row[17] || ''),
        verified: String(row[18] || '')
      };
    });

    if (!canViewAll) {
      records = records.filter(r => r.agentEmail.toLowerCase() === currentUserEmail);
    }

    if (filters.ticketId && String(filters.ticketId).trim() !== '') {
      const q = String(filters.ticketId).toLowerCase().trim();
      records = records.filter(r => r.ticketId.toLowerCase().includes(q));
    }
    if (filters.mid && String(filters.mid).trim() !== '') {
      const q = String(filters.mid).toLowerCase().trim();
      records = records.filter(r => r.mid.toLowerCase().includes(q));
    }
    if (filters.agentEmail && String(filters.agentEmail).trim() !== '') {
      const q = String(filters.agentEmail).toLowerCase().trim();
      records = records.filter(r => r.agentEmail.toLowerCase().includes(q));
    }
    if (filters.eventType && String(filters.eventType).trim() !== '' && filters.eventType !== 'all') {
      records = records.filter(r => r.eventType === String(filters.eventType));
    }
    if (filters.outcome && String(filters.outcome).trim() !== '' && filters.outcome !== 'all') {
      records = records.filter(r => r.outcome === String(filters.outcome));
    }
    if (filters.verified && String(filters.verified).trim() !== '' && filters.verified !== 'all') {
      records = records.filter(r => String(r.verified || '').toUpperCase() === String(filters.verified || '').toUpperCase());
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

    const totalRows = records.length;
    const totalPages = Math.ceil(totalRows / pageSize) || 1;
    const validPage = Math.min(Math.max(1, page), totalPages);
    const startIdx = (validPage - 1) * pageSize;
    const pageData = records.slice(startIdx, startIdx + pageSize);

    return JSON.stringify({
      success: true,
      data: pageData,
      pagination: {
        page: totalRows === 0 ? 1 : validPage,
        pageSize: pageSize,
        totalRows: totalRows,
        totalPages: totalRows === 0 ? 0 : totalPages
      }
    });
  } catch (e) {
    Logger.log('getCallHistory error: ' + e.toString());
    return JSON.stringify({
      success: false,
      error: e.toString(),
      data: [],
      pagination: { page: 1, pageSize: 50, totalRows: 0, totalPages: 0 }
    });
  }
}

function exportCallHistoryCSV(config = {}) {
  try {
    const safeConfig = config || {};
    requirePermission('EXPORT_HISTORY', safeConfig.idToken || '');
    requireCSRFToken(safeConfig.csrfToken || '');
    const filters = safeConfig.filters || {};
    const historyResult = JSON.parse(getCallHistory({
      page: 1,
      pageSize: 10000,
      filters: filters,
      idToken: safeConfig.idToken || ''
    }));

    if (!historyResult.success) {
      return JSON.stringify({ success: false, error: historyResult.error || 'Unable to export call history' });
    }

    const records = historyResult.data || [];
    const headers = [
      'Timestamp',
      'Event ID',
      'Ticket ID',
      'MID',
      'Business',
      'Customer Phone',
      'Agent Email',
      'Agent Name',
      'Role',
      'Event Type',
      'Outcome',
      'Duration Sec',
      'Channel',
      'Provider',
      'Provider Call ID',
      'Source',
      'Notes',
      'Session Key',
      'Verified'
    ];

    const csvRows = [csvRow_(headers)];
    records.forEach(record => {
      const values = [
        record.timestamp,
        record.eventId,
        record.ticketId,
        record.mid,
        record.business,
        record.customerPhone,
        record.agentEmail,
        record.agentName,
        record.role,
        record.eventType,
        record.outcome,
        record.durationSec,
        record.channel,
        record.provider,
        record.providerCallId,
        record.source,
        record.notes,
        record.sessionKey,
        record.verified
      ];
      csvRows.push(csvRow_(values));
    });

    return JSON.stringify({
      success: true,
      csv: csvRows.join('\n'),
      rowCount: records.length,
      filename: `call_history_${Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMdd_HHmmss')}.csv`
    });
  } catch (e) {
    Logger.log('exportCallHistoryCSV error: ' + e.toString());
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

function parseWebhookPayload_(e) {
  const payload = {};
  if (e && e.parameter) {
    Object.keys(e.parameter).forEach(key => {
      payload[key] = e.parameter[key];
    });
  }

  if (e && e.postData && e.postData.contents) {
    const contentType = String(e.postData.type || '').toLowerCase();
    const raw = e.postData.contents;
    if (contentType.includes('application/json')) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          Object.assign(payload, parsed);
        }
      } catch (parseError) {
        throw new Error(`[${ERROR_CODES.VALIDATION_FAILED}] Invalid JSON payload`);
      }
    } else if (raw && raw.trim()) {
      payload.rawBody = raw;
    }
  }

  return payload;
}

function getCallWebhookSecret_() {
  return PropertiesService.getScriptProperties().getProperty('CALL_WEBHOOK_SECRET') || '';
}

function validateWebhookSecret_(payload = {}, e) {
  const configuredSecret = getCallWebhookSecret_();
  if (!configuredSecret) {
    return {
      success: false,
      error: '[E002] CALL_WEBHOOK_SECRET is not configured in Script Properties'
    };
  }

  const requestSecret = String(
    payload.secret ||
    payload.webhookSecret ||
    payload.token ||
    (e && e.parameter && e.parameter.secret) ||
    ''
  );

  if (!requestSecret || !secureEquals_(requestSecret, configuredSecret)) {
    return { success: false, error: '[E002] Invalid webhook secret' };
  }

  return { success: true };
}
