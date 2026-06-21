/**
 * ════════════════════════════════════════════════════════════════════════
 *  Ticket Cache, Index & Versioning   (extracted module)
 * ════════════════════════════════════════════════════════════════════════
 * Extracted from Code.gs. In Google Apps Script all .gs files share ONE global
 * namespace, so these declarations remain callable everywhere unchanged.
 */

function getTicketIndex() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('TICKET_INDEX');
  
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {
      // Cache corrupted, rebuild
    }
  }
  
  return buildTicketIndex();
}

function buildTicketIndex() {
  const cache = CacheService.getScriptCache();
  // [OK] FIX: Syntax error -- stray newline between getSpreadsheet_() and .getSheetByName() removed
  const sheet = getSpreadsheet_().getSheetByName(CONFIG.SHEET_NAME);
  
  if (!sheet) return {};
  
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};
  
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  const index = {};
  
  ids.forEach((row, i) => {
    const id = String(row[0]).trim();
    if (id) {
      index[id] = i + 2; // Convert to row number (1-indexed + header)
    }
  });
  
  // Cache the index
  try {
    cache.put('TICKET_INDEX', JSON.stringify(index), CONFIG.TICKET_INDEX_TTL);
  } catch (e) {
    Logger.log('Index cache error: ' + e.toString());
  }
  
  return index;
}

function invalidateTicketIndex() {
  const cache = CacheService.getScriptCache();
  cache.remove('TICKET_INDEX');
}

/**
 *  CACHE CONFIGURATION
 */
const TICKET_CACHE_CONFIG = {
  CACHE_KEY_PREFIX: 'TICKETS_V2_',
  CHUNK_SIZE: 80000,        // ~80KB per chunk (GAS limit is 100KB)
  MAX_CHUNKS: 10,           // Max 10 chunks = ~800KB
  TTL_SECONDS: 300,         // 5 minutes
  METADATA_KEY: 'TICKET_CACHE_META'
};

/**
 * [CACHE] GET CACHED TICKETS
 * Returns tickets from cache or fetches fresh data
 * Uses chunked storage for large datasets (>100KB)
 * 
 * @param {boolean} forceRefresh - Skip cache and fetch fresh data
 * @returns {Array} Array of ticket objects
 */
// [PERF] Request-scoped memo. GAS resets module-level state between requests
// (so no cross-request staleness) but keeps it within a single request — which
// lets endpoints like getDashboardStats + analytics back-to-back share one
// chunks-join+parse pass (~20-80 ms saved per extra call).
let _ticketsReqMemo = { version: null, tickets: null };

function _invalidateRequestTicketMemo_() {
  _ticketsReqMemo = { version: null, tickets: null };
}

function getCachedTickets(forceRefresh = false) {
  const cache = CacheService.getScriptCache();
  const startTime = Date.now();

  try {
    // Check if force refresh requested
    if (forceRefresh) {
      Logger.log('[CACHE] Cache: Force refresh requested');
      _invalidateRequestTicketMemo_();
      return refreshTicketCache();
    }

    // Try to get cached metadata
    const metaRaw = cache.get(TICKET_CACHE_CONFIG.METADATA_KEY);

    if (!metaRaw) {
      Logger.log('[CACHE] Cache: No metadata found, refreshing');
      _invalidateRequestTicketMemo_();
      return refreshTicketCache();
    }

    const meta = JSON.parse(metaRaw);

    // Check data version - invalidate if stale
    const props = PropertiesService.getScriptProperties();
    const currentVersion = parseInt(props.getProperty('DATA_VERSION') || '0');

    if (meta.version !== currentVersion) {
      Logger.log(`[CACHE] Cache: Version mismatch (cached: ${meta.version}, current: ${currentVersion})`);
      _invalidateRequestTicketMemo_();
      return refreshTicketCache();
    }

    // [PERF] Fast path: reuse this request's memoized tickets if the version matches.
    if (_ticketsReqMemo.tickets && _ticketsReqMemo.version === currentVersion) {
      return _ticketsReqMemo.tickets;
    }

    // Reconstruct data from chunks
    const chunks = [];
    for (let i = 0; i < meta.chunkCount; i++) {
      const chunkKey = TICKET_CACHE_CONFIG.CACHE_KEY_PREFIX + i;
      const chunk = cache.get(chunkKey);

      if (!chunk) {
        Logger.log(`[CACHE] Cache: Missing chunk ${i}, refreshing`);
        _invalidateRequestTicketMemo_();
        return refreshTicketCache();
      }
      chunks.push(chunk);
    }

    const tickets = JSON.parse(chunks.join(''));
    const duration = Date.now() - startTime;
    Logger.log(`[CACHE] Cache: HIT - ${tickets.length} tickets in ${duration}ms`);

    // Memoize for this request only.
    _ticketsReqMemo = { version: currentVersion, tickets: tickets };

    return tickets;

  } catch (e) {
    Logger.log('[CACHE] Cache: Error reading cache - ' + e.toString());
    _invalidateRequestTicketMemo_();
    return refreshTicketCache();
  }
}

/**
 *  REFRESH TICKET CACHE
 * Fetches fresh data and stores in chunked cache
 * 
 * @returns {Array} Fresh ticket data
 */
function refreshTicketCache() {
  const cache = CacheService.getScriptCache();
  const startTime = Date.now();
  
  try {
    // Get fresh data
    const tickets = getDataObjects();

    // [P1-FIX] RISK-04: Data projection to reduce cache payload size.
    //
    // PROBLEM: Caching full ticket objects (with config, remark, reason,
    // validationWarnings) uses ~400-500 bytes/ticket. At 2,700 tickets that
    // is ~1.2MB — exceeding the 800KB CacheService cap and causing every
    // getTicketData() call to fall back to a full sheet read (~1-3s).
    //
    // SOLUTION: Cache only the fields needed for all dashboard views:
    //   - id, date, sortDate, agent, status, business, mid,
    //     concern, supportType, ageDays, ageCategory, phone, reasonQuality,
    //     rowIndex, hourIST, email, requestedBy, pos
    //
    // Fields EXCLUDED from cache (loaded on-demand in detail modal):
    //   - reason: average 200-500 chars per ticket (~40% of total payload)
    //   - remark: creation note, only shown in Master DB detail view
    //   - config: rarely used
    //   - validationWarnings, validationReason: computed client-side
    //   - invalidClosed: computed client-side
    //
    // This reduces payload from ~400B to ~220B per ticket (~45% smaller),
    // raising the effective ceiling from ~2,000 to ~3,600 tickets.
    //
    // NOTE: getTicketData() still returns full objects (incl. reason/remark)
    // because the full array is returned from getCachedTickets(), which must
    // return the projected shape. getFullTicketDetail() fetches the full row
    // on demand (see below).
    // [DEDUP] Canonicalise the agent field at the source so the dashboard
    // never receives a mix of friendly names and raw emails for the same
    // person. Prefer the directory record matched by email, then by agent
    // string itself (if it happens to be an email).
    const _canonAgent = (t) => {
      let resolved = null;
      if (t.email)  resolved = getAgentByEmail(t.email);
      if (!resolved && t.agent && String(t.agent).indexOf('@') !== -1) {
        resolved = getAgentByEmail(t.agent);
      }
      return resolved ? resolved.name : (t.agent || '');
    };

    const projected = tickets.map(t => ({
      id:           t.id,
      rowIndex:     t.rowIndex,
      date:         t.date,
      sortDate:     t.sortDate,
      hourIST:      t.hourIST,
      ageDays:      t.ageDays,
      ageCategory:  t.ageCategory,
      email:        t.email,
      agent:        _canonAgent(t),
      requestedBy:  t.requestedBy,
      mid:          t.mid,
      business:     t.business,
      pos:          t.pos,
      supportType:  t.supportType,
      concern:      t.concern,
      phone:        t.phone,
      phoneDisplay: t.phoneDisplay,
      status:       t.status,
      reasonQuality: t.reasonQuality,
      // Retain reason and remark — needed for date filter (lastUpdatedMs) and
      // follow-up display in table rows. Omit only heavy validation arrays.
      reason:       t.reason,
      remark:       t.remark
      // OMITTED: config, invalidClosed, validationReason, validationWarnings
    }));

    const json = JSON.stringify(projected);
    
    // Get current version
    const props = PropertiesService.getScriptProperties();
    const version = parseInt(props.getProperty('DATA_VERSION') || '0');
    
    // Calculate chunks needed
    const chunkCount = Math.ceil(json.length / TICKET_CACHE_CONFIG.CHUNK_SIZE);
    
    if (chunkCount > TICKET_CACHE_CONFIG.MAX_CHUNKS) {
      Logger.log(`[CACHE] Data too large for cache (${chunkCount} chunks needed, max ${TICKET_CACHE_CONFIG.MAX_CHUNKS}). Serving direct.`);
      return tickets; // Return full objects, not projected
    }
    
    // Clear old chunks first
    invalidateTicketCache();
    
    // Store chunks
    const cacheData = {};
    for (let i = 0; i < chunkCount; i++) {
      const start = i * TICKET_CACHE_CONFIG.CHUNK_SIZE;
      const end = start + TICKET_CACHE_CONFIG.CHUNK_SIZE;
      const chunkKey = TICKET_CACHE_CONFIG.CACHE_KEY_PREFIX + i;
      cacheData[chunkKey] = json.substring(start, end);
    }
    
    // Store metadata
    const meta = {
      version: version,
      chunkCount: chunkCount,
      ticketCount: projected.length,
      cachedAt: new Date().toISOString(),
      sizeBytes: json.length
    };
    cacheData[TICKET_CACHE_CONFIG.METADATA_KEY] = JSON.stringify(meta);
    
    // Batch put all chunks (more efficient)
    cache.putAll(cacheData, TICKET_CACHE_CONFIG.TTL_SECONDS);
    
    const duration = Date.now() - startTime;
    Logger.log(`[CACHE] REFRESHED — ${projected.length} tickets, ${chunkCount} chunks, ${json.length} bytes (${Math.round(json.length/1024)}KB) in ${duration}ms`);
    
    return tickets; // Return FULL objects to the immediate caller (getTicketData)
    
  } catch (e) {
    Logger.log('[CACHE] Error refreshing cache: ' + e.toString());
    return getDataObjects();
  }
}

/**
 *  INVALIDATE TICKET CACHE
 * Clears all cached ticket data
 */
function invalidateTicketCache() {
  const cache = CacheService.getScriptCache();

  // [PERF] Also drop the per-request memo so callers later in THIS request
  // see fresh data (e.g. createNewTicket writes → subsequent read in same
  // request should no longer return stale memoized tickets).
  _invalidateRequestTicketMemo_();

  try {
    // Remove metadata
    cache.remove(TICKET_CACHE_CONFIG.METADATA_KEY);

    // Remove all possible chunks
    const keysToRemove = [];
    for (let i = 0; i < TICKET_CACHE_CONFIG.MAX_CHUNKS; i++) {
      keysToRemove.push(TICKET_CACHE_CONFIG.CACHE_KEY_PREFIX + i);
    }
    cache.removeAll(keysToRemove);

    Logger.log('[CACHE] Cache: Invalidated');
  } catch (e) {
    Logger.log('[CACHE] Cache: Invalidation error - ' + e.toString());
  }
}

/**
 * [REPORT] GET CACHE STATISTICS
 * Returns current cache status and metrics
 */
function getTicketCacheStats() {
  const cache = CacheService.getScriptCache();
  
  try {
    const metaRaw = cache.get(TICKET_CACHE_CONFIG.METADATA_KEY);
    
    if (!metaRaw) {
      return {
        status: 'EMPTY',
        message: 'No cached data'
      };
    }
    
    const meta = JSON.parse(metaRaw);
    const props = PropertiesService.getScriptProperties();
    const currentVersion = parseInt(props.getProperty('DATA_VERSION') || '0');
    
    return {
      status: meta.version === currentVersion ? 'VALID' : 'STALE',
      ticketCount: meta.ticketCount,
      chunkCount: meta.chunkCount,
      sizeKB: Math.round(meta.sizeBytes / 1024),
      cachedAt: meta.cachedAt,
      cacheVersion: meta.version,
      currentVersion: currentVersion,
      isStale: meta.version !== currentVersion
    };
    
  } catch (e) {
    return {
      status: 'ERROR',
      error: e.toString()
    };
  }
}

function checkVersion() {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty('DATA_VERSION');
  const version = Number.isInteger(Number(raw)) ? Number(raw) : 0;

  return JSON.stringify({
    success: true,
    version: version,
    checkedAt: Date.now()  // lets frontend detect stale cached responses
  });
}

/**
 * [LOCK] INTERNAL: Increment version WITHOUT acquiring lock
 * Use this when caller already holds a lock to prevent deadlock
 * @private
 */
function _incrementDataVersionNoLock() {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty('DATA_VERSION');
  const current = Number.isInteger(Number(raw)) ? Number(raw) : 0;
  props.setProperty('DATA_VERSION', String(current + 1));
  
  // [CACHE] Invalidate the smart ticket cache
  invalidateTicketCache();
}

/**
 *  PUBLIC: Increment version with lock acquisition
 * Use this for standalone calls (not inside another locked function)
 */
function incrementDataVersion() {
  const lock = LockService.getScriptLock();
  try {
    // [OK] FIX: Use CONFIG.LOCK_TIMEOUT_MS instead of hardcoded 5000
    lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
    _incrementDataVersionNoLock();
  } catch (e) {
    Logger.log('Lock timeout in incrementVersion: ' + e);
  } finally {
    lock.releaseLock();
  }
}
