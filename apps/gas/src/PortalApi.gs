/**
 * ════════════════════════════════════════════════════════════════════════
 *  Public Portal & External Ticket API   (extracted module)
 * ════════════════════════════════════════════════════════════════════════
 * Extracted from Code.gs. In Google Apps Script all .gs files share ONE global
 * namespace, so these declarations remain callable everywhere unchanged.
 */

/**
 * 🔢 CONCURRENCY-SAFE TICKET ID GENERATION
 * Format: BF-TKT-YYYY-MM-XXXX (zero-padded, monthly reset)
 *
 * Uses PropertiesService as an atomic counter store under LockService.
 * Each month gets its own property key (e.g. TICKET_SEQ_2026_03).
 * If counter is missing or zero, recovers by scanning the last row.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - The ticket sheet
 * @returns {string} Generated ticket ID
 */
function generateTicketId_(sheet) {
  var now = new Date();
  var year = Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy');
  var month = Utilities.formatDate(now, 'Asia/Kolkata', 'MM');

  // ── GLOBAL counter — sequence NEVER resets on month/year change ───────────
  // Format: BF-TKT-YYYY-MM-XXXX  (label changes, number continues globally)
  // e.g.  BF-TKT-2026-03-2526
  //        BF-TKT-2026-04-2527  ← same counter, new month label
  //        BF-TKT-2027-01-6027  ← same counter, new year label
  var propKey = 'TICKET_SEQ_GLOBAL';

  var props = PropertiesService.getScriptProperties();
  var storedSeq = parseInt(props.getProperty(propKey) || '0', 10);

  // ── SYNC WITH SHEET: find highest numeric suffix across ALL BF-TKT- IDs ───
  // Scans last 200 rows for speed. Strips YYYY-MM label and reads the number
  // after the last dash — works regardless of which month/year the row belongs to.
  var sheetMax = 0;
  try {
    var lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      var scanStart = Math.max(2, lastRow - 199);
      var ids = sheet.getRange(scanStart, 1, lastRow - scanStart + 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        var id = String(ids[i][0] || '');
        if (id.indexOf('BF-TKT-') === 0) {
          // Sequence is always the value after the last dash
          var lastDash = id.lastIndexOf('-');
          if (lastDash > 0) {
            var seq = parseInt(id.substring(lastDash + 1), 10);
            if (!isNaN(seq) && seq > sheetMax) sheetMax = seq;
          }
        }
      }
    }
  } catch (_) { /* non-fatal — fall back to stored counter */ }

  // Use the higher of stored counter vs actual sheet maximum
  var currentSeq = Math.max(storedSeq, sheetMax);

  // Increment and persist globally
  var nextSeq = currentSeq + 1;
  props.setProperty(propKey, String(nextSeq));

  return 'BF-TKT-' + year + '-' + month + '-' + String(nextSeq).padStart(4, '0');
}

/**
 * 🤖 INTELLIGENT AGENT AUTO-ASSIGNMENT
 *
 * Strategy:
 *   1. Count active tickets (status != Completed/Closed) per non-admin agent
 *   2. Pick agent with fewest active tickets
 *   3. Tie-break: round-robin counter via CacheService
 *   4. Fallback: first non-admin agent from directory
 *
 * Efficiency: reads only columns C (Agent) and M (Status) in a batch.
 *
 * @returns {string} Agent name to assign
 */
function autoAssignAgent_(sheetRef) {
  var agentNames = [];
  var dirEntries = Object.entries(AGENT_DIRECTORY);
  for (var i = 0; i < dirEntries.length; i++) {
    var agName = dirEntries[i][0];
    var agInfo = dirEntries[i][1];
    if (agInfo.role !== "admin" && agName !== "Admin" && agInfo.active !== false) {
      agentNames.push(agName);
    }
  }

  if (agentNames.length === 0) {
    Logger.log("[API] No active agents");
    return Object.keys(AGENT_DIRECTORY)[0] || "Unassigned";
  }
  if (agentNames.length === 1) return agentNames[0];

  // Count active (non-completed/closed) tickets per agent.
  // PRIMARY: Use in-memory ticket cache (~5ms) — avoids a full sheet scan (~800ms+)
  // that was previously blocking every ticket-creation request.
  // FALLBACK: If cache is cold/unavailable, fall back to the direct sheet read.
  var activeCounts = {};
  for (var j = 0; j < agentNames.length; j++) activeCounts[agentNames[j]] = 0;

  var countedViaCache = false;
  try {
    var cached = getCachedTickets(false);
    if (cached && cached.length > 0) {
      for (var ci = 0; ci < cached.length; ci++) {
        var t = cached[ci];
        var tAgent = String(t.agent || '').trim();
        if (tAgent && activeCounts.hasOwnProperty(tAgent) &&
            t.status !== STATUS_ENUM.COMPLETED &&
            t.status !== STATUS_ENUM.CLOSED) {
          activeCounts[tAgent]++;
        }
      }
      countedViaCache = true;
      Logger.log('[API] autoAssignAgent_: active counts from cache (' + cached.length + ' tickets)');
    }
  } catch (cacheErr) {
    Logger.log('[API] autoAssignAgent_: cache unavailable, falling back to sheet scan: ' + cacheErr);
  }

  // Sheet-scan fallback — only runs when cache is cold or errored
  if (!countedViaCache) {
    try {
      var sheet = sheetRef;
      if (!sheet) {
        var ss = getSpreadsheet_();
        sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
      }
      if (sheet) {
        var lastRow = sheet.getLastRow();
        if (lastRow >= 2) {
          var block = sheet.getRange(2, 3, lastRow - 1, 11).getValues();
          for (var k = 0; k < block.length; k++) {
            var agentInRow  = String(block[k][0]  || '').trim();
            var statusInRow = String(block[k][10] || '').trim();
            if (agentInRow && activeCounts.hasOwnProperty(agentInRow) &&
                statusInRow !== STATUS_ENUM.COMPLETED &&
                statusInRow !== STATUS_ENUM.CLOSED) {
              activeCounts[agentInRow]++;
            }
          }
        }
      }
    } catch (e) {
      Logger.log('[API] autoAssignAgent_ sheet scan error: ' + e.toString());
    }
  }

  // PRIMARY: Strict round-robin via PropertiesService (permanent storage).
  // CacheService was silently capped at 6h by GAS despite setting 24h TTL,
  // causing counter to reset to 0 every 6h and always pick the first agent.
  // PropertiesService has no expiry — counter persists indefinitely.
  var props = PropertiesService.getScriptProperties();
  var rrRaw = props.getProperty("AGENT_RR_INDEX");
  var rrIndex = (rrRaw === null) ? 0 : parseInt(rrRaw, 10);
  if (isNaN(rrIndex) || rrIndex < 0) rrIndex = 0;
  var picked = agentNames[rrIndex % agentNames.length];
  props.setProperty("AGENT_RR_INDEX", String((rrIndex + 1) % agentNames.length));

  // OVERRIDE: Only skip if this agent is genuinely overloaded (5+ more than min).
  // With 2500+ historical tickets, agents differ by just 1-2 active tickets,
  // so a threshold of 1 always pointed to the same person. 5 is the sweet spot.
  var minCount = Math.min.apply(null, agentNames.map(function(n) { return activeCounts[n] || 0; }));
  if ((activeCounts[picked] || 0) >= minCount + 5) {
    var lighter = agentNames.filter(function(n) { return (activeCounts[n] || 0) < minCount + 5; });
    if (lighter.length > 0) {
      var fbRaw = props.getProperty("AGENT_RR_FB");
      var fbIdx = (fbRaw === null) ? 0 : parseInt(fbRaw, 10);
      if (isNaN(fbIdx) || fbIdx < 0) fbIdx = 0;
      var fallback = lighter[fbIdx % lighter.length];
      props.setProperty("AGENT_RR_FB", String((fbIdx + 1) % lighter.length));
      Logger.log("[API] Overload skip: " + picked + " -> " + fallback);
      return fallback;
    }
  }

  Logger.log("[API] Round-robin: " + picked + " (active=" + (activeCounts[picked]||0) + ")");
  return picked;
}

/**
 * 🛡️ DUPLICATE/SPAM CHECK
 * Prevents same phone+concern from creating tickets within 5-minute window.
 * Uses SHA-256 fingerprint as cache key for privacy.
 *
 * @param {string} phone - Phone number
 * @param {string} concern - Concern text
 * @returns {{ isDuplicate: boolean }}
 */
function apiDuplicateCheck_(phone, concern) {
  if (!phone && !concern) return { isDuplicate: false };

  var fingerprint = (phone || '') + '|' + (concern || '').substring(0, 50).toLowerCase();
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    fingerprint,
    Utilities.Charset.UTF_8
  );
  // Convert to hex string for cache key
  var hexKey = 'API_DEDUP_' + digest.map(function(b) {
    return ('0' + ((b + 256) % 256).toString(16)).slice(-2);
  }).join('');

  var cache = CacheService.getScriptCache();
  if (cache.get(hexKey)) {
    return { isDuplicate: true };
  }

  // Mark as seen for 5 minutes
  cache.put(hexKey, '1', 300);
  return { isDuplicate: false };
}

/**
 * 🎫 API TICKET CREATION ORCHESTRATOR
 *
 * Flow:
 *   1. Generate requestId for tracing
 *   2. Authenticate API key
 *   3. Rate-limit check
 *   4. Input validation & sanitization
 *   5. Duplicate/spam check
 *   6. Acquire lock
 *   7. Generate ticket ID (concurrency-safe)
 *   8. Auto-assign agent
 *   9. Write to sheet
 *  10. Audit log
 *  11. Return response
 *
 * ❌ NEVER accepts from client: email, agent, status, ticketId
 *
 * @param {Object} payload - Parsed request payload
 * @returns {Object} API response
 */
function api_createTicket_(payload) {
  var requestId = 'req_' + Utilities.getUuid().substring(0, 12);
  var lock = LockService.getScriptLock();
  var lockAcquired = false;

  // ── GUARD: null/undefined payload throws before any logging otherwise
  if (!payload || typeof payload !== 'object') {
    return {
      success: false,
      error: 'Invalid or missing request body',
      code: ERROR_CODES.VALIDATION_FAILED,
      requestId: requestId
    };
  }

  try {
    Logger.log('[API][' + requestId + '] createTicket request received');

    // ── 1. AUTHENTICATION ───────────────────────────────────────────
    var auth = verifyApiKey_(payload.apiKey);
    if (!auth.success) {
      Logger.log('[API][' + requestId + '] Auth failed: ' + auth.error);
      return {
        success: false,
        error: auth.error,
        code: ERROR_CODES.UNAUTHORIZED,
        requestId: requestId
      };
    }
    Logger.log('[API][' + requestId + '] Authenticated: ' + auth.keyInfo.name);

    // ── 2. RATE LIMITING ────────────────────────────────────────────
    var rl = apiRateLimitCheck_(String(payload.apiKey), auth.keyInfo.rateLimit);
    if (!rl.allowed) {
      Logger.log('[API][' + requestId + '] Rate limited');
      return {
        success: false,
        error: 'Rate limit exceeded. Try again in 60 seconds.',
        code: ERROR_CODES.RATE_LIMITED,
        requestId: requestId
      };
    }

    // ── 3. INPUT VALIDATION & SANITIZATION ──────────────────────────
    var concern = sanitizeInput(payload.concern, { maxLength: 500 });
    if (!concern) {
      return {
        success: false,
        error: 'Concern is required',
        code: ERROR_CODES.VALIDATION_FAILED,
        requestId: requestId
      };
    }

    var rawMid = sanitizeInput(payload.mid, { maxLength: 20 });
    var mid = rawMid ? rawMid.replace(/[^0-9]/g, '') : '';
    if (!mid) {
      return {
        success: false,
        error: 'MID is required and must be a numerical value',
        code: ERROR_CODES.VALIDATION_FAILED,
        requestId: requestId
      };
    }
    var phone = normalizeCallPhone_(payload.phone || '');
    var requestedBy = sanitizeInput(payload.requestedBy, { maxLength: 100 }) || 'WhatsApp User';
    var business = sanitizeInput(payload.business, { maxLength: 200 });
    if (!business) {
      return {
        success: false,
        error: 'Business name is required',
        code: ERROR_CODES.VALIDATION_FAILED,
        requestId: requestId
      };
    }
    var pos = sanitizeInput(payload.pos, { maxLength: 50 }) || '-';

    // ── 4. DUPLICATE/SPAM CHECK ─────────────────────────────────────
    var dupCheck = apiDuplicateCheck_(phone, concern);
    if (dupCheck.isDuplicate) {
      Logger.log('[API][' + requestId + '] Duplicate request blocked: ' + phone);
      return {
        success: false,
        error: 'Duplicate request. A ticket with this phone and concern was recently created.',
        code: ERROR_CODES.RATE_LIMITED,
        requestId: requestId
      };
    }

    // ── 5. ACQUIRE LOCK ─────────────────────────────────────────────
    lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
    lockAcquired = true;

    // ── 6. OPEN SHEET ───────────────────────────────────────────────
    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
    if (!sheet) {
      return {
        success: false,
        error: 'Ticket database unavailable',
        code: ERROR_CODES.SHEET_ERROR,
        requestId: requestId
      };
    }
    ensureTicketPhoneColumn_(sheet);

    // ── 7. GENERATE TICKET ID (under lock) ──────────────────────────
    var ticketId = generateTicketId_(sheet);

    // ── 8. AUTO-ASSIGN AGENT ────────────────────────────────────────
    // Pass sheet reference to reuse the already-open handle (avoids redundant getSheetByName)
    var assignedAgent = autoAssignAgent_(sheet);
    var agentInfo = AGENT_DIRECTORY[assignedAgent];
    var agentEmail = agentInfo ? agentInfo.email : '';

    Logger.log('[API][' + requestId + '] Assigned: ' + assignedAgent + ' (' + agentEmail + ')');

    // ── 9. BUILD ROW (exact same column order as createNewTicket) ───
    var now = new Date();
    var newRow = [
      ticketId,                    // Col A: Ticket ID
      now,                         // Col B: Date
      assignedAgent,               // Col C: Agent
      agentEmail,                  // Col D: Email (agent's email)
      requestedBy,                 // Col E: Requested By
      mid,                         // Col F: MID
      business,                    // Col G: Business
      pos,                         // Col H: POS
      'Customer Support',          // Col I: Support Type
      concern,                     // Col J: Concern
      '',                          // Col K: Config
      'Created via API (' + auth.keyInfo.name + ')',  // Col L: Remark
      STATUS_ENUM.NOT_COMPLETED,   // Col M: Status — ALWAYS server-controlled
      '',                          // Col N: Reason
      phone                        // Col O: Phone
    ];

    // ── 10. WRITE TO SHEET ──────────────────────────────────────────
    sheet.appendRow(newRow);

    // ── 11. UPDATE VERSION & CACHE ──────────────────────────────────
    _incrementDataVersionNoLock();
    invalidateTicketIndex();

    // ── 12. AUDIT LOG ───────────────────────────────────────────────
    try {
      logAuditEvent('API_TICKET_CREATED', ticketId, {
        agent: assignedAgent,
        concern: concern,
        phone: phone,
        requestedBy: requestedBy,
        apiKeyName: auth.keyInfo.name,
        requestId: requestId
      });
    } catch (_auditErr) {
      Logger.log('[API] Audit log failed (non-critical): ' + _auditErr);
    }

    Logger.log('[API][' + requestId + '] ✅ Ticket created: ' + ticketId);

    // ── 13. SUCCESS RESPONSE ────────────────────────────────────────
    return {
      success: true,
      data: {
        ticketId: ticketId,
        assignedAgent: assignedAgent,
        status: STATUS_ENUM.NOT_COMPLETED,
        requestId: requestId
      }
    };

  } catch (e) {
    Logger.log('[API][' + requestId + '] ERROR: ' + e.toString());

    try {
      logAuditEvent('API_CREATE_ERROR', null, {
        error: e.toString(),
        requestId: requestId,
        apiKey: payload.apiKey ? '***' : 'missing'
      }, 'ERROR');
    } catch (_) {}

    // LockService timeout → specific error
    if (e.toString().indexOf('lock') !== -1 || e.toString().indexOf('Lock') !== -1) {
      return {
        success: false,
        error: 'System busy. Please retry in a few seconds.',
        code: ERROR_CODES.LOCK_TIMEOUT,
        requestId: requestId
      };
    }

    return {
      success: false,
      error: e.message || 'Internal server error',
      code: ERROR_CODES.UNKNOWN_ERROR,
      requestId: requestId
    };
  } finally {
    if (lockAcquired) {
      try { lock.releaseLock(); } catch (_) {}
    }
  }
}

/**
 * PORTAL: Create a support ticket (public-facing)
 *
 * Called by TicketPortal.html via google.script.run.
 * No CSRF / auth token required (public form). Instead:
 *   - Rate-limited: 5 tickets per minute per session
 *   - Duplicate detection: same phone+concern within 5 min
 *   - Auto-assigns agent via existing round-robin logic
 *   - Support type hardcoded to "Customer Support"
 *
 * @param {Object} data - Ticket data from the portal form
 * @returns {string} JSON response with success, ticketId
 */
function portalCreateTicket(data) {
  var lock = LockService.getScriptLock();
  var lockAcquired = false;

  try {
    // ── 1. INPUT GUARD ──────────────────────────────────────────────
    if (!data || typeof data !== 'object') {
      return JSON.stringify({ success: false, error: 'Invalid request data' });
    }

    // ── 2. RATE LIMITING (5 per minute per session) ─────────────────
    var sessionKey = Session.getTemporaryActiveUserKey() || 'anon';
    var rlCache = CacheService.getScriptCache();
    var rlKey = 'PORTAL_RL_' + sessionKey;
    var rlCount = parseInt(rlCache.get(rlKey) || '0', 10);
    if (rlCount >= 5) {
      return JSON.stringify({
        success: false,
        error: 'Too many requests. Please wait a minute before submitting again.'
      });
    }
    rlCache.put(rlKey, String(rlCount + 1), 60);

    // ── 3. VALIDATE & SANITIZE ──────────────────────────────────────
    var business = sanitizeInput(data.business, { maxLength: 200 });
    var phone    = normalizeCallPhone_(data.phone || '');
    var concern  = sanitizeInput(data.concern, { maxLength: 500 });
    var mid      = sanitizeInput(data.mid, { maxLength: 20 }) || '-';
    var pos      = sanitizeInput(data.pos, { maxLength: 50 }) || '-';
    var remark   = sanitizeInput(data.remark, { maxLength: 1000 }) || '';
    var requestedBy = sanitizeInput(data.requestedBy, { maxLength: 100 }) || business || 'Portal User';

    // Strip non-digits from MID (if provided)
    if (mid && mid !== '-') {
      mid = mid.replace(/[^0-9]/g, '') || '-';
    }

    if (!business) {
      return JSON.stringify({ success: false, error: 'Business name is required' });
    }
    if (!phone || phone.length < 10) {
      return JSON.stringify({ success: false, error: 'Valid phone number is required' });
    }
    if (!concern) {
      return JSON.stringify({ success: false, error: 'Concern / Issue description is required' });
    }

    // ── 4. DUPLICATE CHECK ──────────────────────────────────────────
    var dupCheck = apiDuplicateCheck_(phone, concern);
    if (dupCheck.isDuplicate) {
      return JSON.stringify({
        success: false,
        error: 'A ticket with this phone and concern was recently created. Please wait a few minutes.'
      });
    }

    // ── 5. OPEN SHEET (before lock — read is safe) ──────────────────
    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
    if (!sheet) {
      return JSON.stringify({ success: false, error: 'System unavailable. Please try again later.' });
    }
    ensureTicketPhoneColumn_(sheet);

    // ── 6. LOCK → WRITE ─────────────────────────────────────────────
    lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
    lockAcquired = true;

    var now = new Date();
    var ticketId = generateTicketId_(sheet);
    var assignedAgent = autoAssignAgent_(sheet);
    var agentInfo = AGENT_DIRECTORY[assignedAgent];
    var agentEmail = agentInfo ? agentInfo.email : '';

    var newRow = [
      ticketId,              // A: Ticket ID
      now,                   // B: Date
      assignedAgent,         // C: Agent Name
      agentEmail,            // D: Agent Email
      requestedBy,           // E: Requested By
      mid,                   // F: MID
      business,              // G: Business
      pos,                   // H: POS
      'Customer Support',    // I: Support Type (always)
      concern,               // J: Concern
      '',                    // K: Config
      remark ? 'QuickFix: ' + remark : 'Created via BillFree QuickFix',  // L: Remark
      STATUS_ENUM.NOT_COMPLETED,  // M: Status
      '',                    // N: Reason
      phone                  // O: Phone
    ];

    sheet.appendRow(newRow);
    _incrementDataVersionNoLock();
    invalidateTicketIndex();

    lock.releaseLock();
    lockAcquired = false;

    // ── 7. AUDIT (non-critical, outside lock) ───────────────────────
    try {
      logAuditEvent('PORTAL_TICKET_CREATED', ticketId, {
        agent: assignedAgent,
        concern: concern,
        business: business,
        mid: mid,
        phone: phone,
        source: 'SUPPORT_PORTAL'
      });
    } catch (_) {}

    Logger.log('[PORTAL] Ticket created: ' + ticketId + ' → ' + assignedAgent);

    return JSON.stringify({
      success: true,
      ticketId: ticketId,
      message: 'Ticket created successfully'
    });

  } catch (e) {
    Logger.log('[PORTAL] createTicket error: ' + e.toString());

    if (e.toString().indexOf('Lock') !== -1 || e.toString().indexOf('lock') !== -1) {
      return JSON.stringify({
        success: false,
        error: 'System is busy. Please try again in a few seconds.'
      });
    }

    return JSON.stringify({
      success: false,
      error: 'An error occurred. Please try again.'
    });
  } finally {
    if (lockAcquired) {
      try { lock.releaseLock(); } catch (_) {}
    }
  }
}

/**
 * PORTAL: Look up ticket status (public-facing)
 *
 * Searches by Ticket ID, MID, or Business Name.
 * Returns limited fields only — no agent email, no internal notes.
 * Rate-limited: 10 lookups per minute per session.
 * Max 20 results.
 *
 * @param {string} query - Search term (ticket ID, MID, or business name)
 * @returns {string} JSON response with success, tickets[]
 */
function portalLookupTicket(query) {
  try {
    // ── 1. INPUT GUARD ──────────────────────────────────────────────
    var searchTerm = sanitizeInput(query, { maxLength: 200 });
    if (!searchTerm || searchTerm.length < 2) {
      return JSON.stringify({ success: false, error: 'Search term must be at least 2 characters' });
    }

    // ── 2. RATE LIMITING (10 per minute per session) ────────────────
    var sessionKey = Session.getTemporaryActiveUserKey() || 'anon';
    var rlCache = CacheService.getScriptCache();
    var rlKey = 'PORTAL_SEARCH_RL_' + sessionKey;
    var rlCount = parseInt(rlCache.get(rlKey) || '0', 10);
    if (rlCount >= 10) {
      return JSON.stringify({
        success: false,
        error: 'Too many searches. Please wait a minute.'
      });
    }
    rlCache.put(rlKey, String(rlCount + 1), 60);

    // ── 3. DETERMINE SEARCH TYPE ────────────────────────────────────
    var termLower = searchTerm.toLowerCase().trim();

    // Ticket ID: starts with BF- or BF-TKT (must check FIRST, before MID check)
    var isTicketId = termLower.indexOf('bf-') === 0;

    // MID: purely numeric AND not a ticket ID
    var isMidSearch = !isTicketId && /^\d{4,20}$/.test(searchTerm.trim());

    // ── 4. READ SHEET DATA ──────────────────────────────────────────
    var tickets = [];
    var cached = null;
    try {
      cached = getCachedTickets(false);
    } catch (_) {}

    if (cached && cached.length > 0) {
      // ── FAST PATH: search from cache ──
      // NOTE: cache projected object uses  .id  (not .ticketId), .agent, .reason
      for (var i = 0; i < cached.length; i++) {
        var t = cached[i];
        var cachedId       = String(t.id || '').toLowerCase();
        var cachedMid      = String(t.mid || '');
        var cachedBusiness = String(t.business || '').toLowerCase();
        var match = false;

        if (isTicketId) {
          match = cachedId.indexOf(termLower) !== -1;
        } else if (isMidSearch) {
          match = cachedMid === searchTerm.trim();
        } else {
          match = cachedBusiness.indexOf(termLower) !== -1 ||
                  cachedMid.indexOf(searchTerm) !== -1;
        }

        if (match) {
          // Format date from sortDate (ms) or date string
          var dateStr = '';
          try {
            if (t.sortDate) {
              dateStr = Utilities.formatDate(
                new Date(t.sortDate), 'Asia/Kolkata', 'dd MMM yyyy, hh:mm a');
            } else {
              dateStr = String(t.date || '');
            }
          } catch(_) { dateStr = String(t.date || ''); }

          tickets.push({
            ticketId: t.id || '',
            date:     dateStr,
            mid:      t.mid || '-',
            business: t.business || '-',
            status:   normalizeStatusWithDefault(String(t.status || '')),
            concern:  t.concern || '-',
            agent:    t.agent || '-',
            followup: t.reason || ''
          });
          if (tickets.length >= 20) break;
        }
      }
    } else {
      // ── SLOW FALLBACK: direct sheet read ──
      var ss = getSpreadsheet_();
      var sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
      if (!sheet) {
        return JSON.stringify({ success: false, error: 'System unavailable' });
      }
      var lastRow = sheet.getLastRow();
      if (lastRow < 2) {
        return JSON.stringify({ success: true, tickets: [], count: 0 });
      }

      var data = sheet.getRange(2, 1, lastRow - 1, CONFIG.DATA_COLUMNS_MAX).getValues();
      for (var j = 0; j < data.length; j++) {
        var row = data[j];
        var rowTicketId = String(row[CONFIG.COLS.TICKET_ID - 1] || '');
        var rowMid      = String(row[CONFIG.COLS.MID - 1] || '');
        var rowBusiness = String(row[CONFIG.COLS.BUSINESS - 1] || '');
        var rowStatus   = String(row[CONFIG.COLS.STATUS - 1] || '');
        var rowConcern  = String(row[CONFIG.COLS.CONCERN - 1] || '');
        var rowDate     = row[CONFIG.COLS.CREATED_AT - 1];
        var rowItEmail  = String(row[CONFIG.COLS.IT_EMAIL - 1] || '');
        var rowReason   = String(row[CONFIG.COLS.REASON - 1] || '');

        var match2 = false;
        if (isTicketId) {
          match2 = rowTicketId.toLowerCase().indexOf(termLower) !== -1;
        } else if (isMidSearch) {
          match2 = rowMid === searchTerm.trim();
        } else {
          match2 = rowBusiness.toLowerCase().indexOf(termLower) !== -1 ||
                   rowMid.indexOf(searchTerm) !== -1;
        }

        if (match2) {
          var dateStr2 = '';
          try {
            if (rowDate instanceof Date) {
              dateStr2 = Utilities.formatDate(rowDate, 'Asia/Kolkata', 'dd MMM yyyy, hh:mm a');
            } else {
              dateStr2 = String(rowDate || '');
            }
          } catch (_) { dateStr2 = String(rowDate || ''); }

          // Resolve agent display name from email
          var agentDisplay = getAgentNameByEmail_(rowItEmail) || rowItEmail || '-';

          tickets.push({
            ticketId: rowTicketId,
            date:     dateStr2,
            mid:      rowMid || '-',
            business: rowBusiness || '-',
            status:   normalizeStatusWithDefault(rowStatus),
            concern:  rowConcern || '-',
            agent:    agentDisplay,
            followup: rowReason
          });
          if (tickets.length >= 20) break;
        }
      }
    }

    // Sort newest first
    tickets.sort(function(a, b) {
      return String(b.ticketId).localeCompare(String(a.ticketId));
    });

    Logger.log('[PORTAL] lookupTicket: query="' + searchTerm + '" type=' +
      (isTicketId ? 'TICKET_ID' : isMidSearch ? 'MID' : 'BUSINESS') +
      ' results=' + tickets.length);

    return JSON.stringify({
      success: true,
      tickets: tickets,
      count: tickets.length
    });

  } catch (e) {
    Logger.log('[PORTAL] lookupTicket error: ' + e.toString());
    return JSON.stringify({
      success: false,
      error: 'Search failed. Please try again.'
    });
  }
}
