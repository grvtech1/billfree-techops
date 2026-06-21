/**
 * ════════════════════════════════════════════════════════════════════════
 *  Authentication, Authorization & Identity   (extracted module)
 * ════════════════════════════════════════════════════════════════════════
 * Extracted from Code.gs. In Google Apps Script all .gs files share ONE global
 * namespace, so these declarations remain callable everywhere unchanged.
 */

/**
 * [CACHE] P1-FIX6: SESSION EMAIL SINGLETON
 * Session.getActiveUser().getEmail() costs ~50-100ms per call.
 * This caches it for the request lifecycle (GAS resets module state between requests).
 *
 * Fallback chain:
 *   1. Session.getActiveUser().getEmail()  -- works when user has authorized
 *   2. Session.getEffectiveUser().getEmail() -- returns script owner for "Execute as: Me"
 *
 * GAS web apps deployed as "Execute as: Me" may return empty from getActiveUser()
 * in google.script.run calls, but getEffectiveUser() always returns the owner email.
 *
 * SECURITY NOTE:
 * This resolver now fails closed when Session.getActiveUser() is empty.
 * We do not trust Session.getEffectiveUser() for viewer identity because it
 * resolves to the deployer and can mask identity propagation failures.
 */
let _requestUser = null;

function setRequestUser_(email) {
  _requestUser = normalizeEmail_(email);
}

function getSessionEmail_() {
  if (_requestUser) return _requestUser;

  try {
    // Only trust the visiting user's actual session identity.
    var email = Session.getActiveUser().getEmail() || '';
    if (email) return email;
  } catch (_) {}

  try {
    // Fallback: getEffectiveUser — returns script owner for 'Execute as me' deployments.
    // Safe because GAS deployment already controls access (Google sign-in required).
    // Intentionally no effective-user fallback here.
  } catch (_) {}

  return '';
}

/**
 * [SECURE] ADMIN CONFIGURATION -- declared early so initializeAgentPhones can use it
 * (Duplicate const below is removed; this is now the single definition)
 */
const ADMIN_EMAILS = Object.freeze([
  "admin@billfree.in"
]);

// Pre-normalized admin list for consistent case-insensitive checks.
const ADMIN_EMAILS_NORMALIZED = Object.freeze(
  ADMIN_EMAILS
    .map(email => String(email || '').toLowerCase().trim())
    .filter(Boolean)
);

const AUTH_CONFIG = Object.freeze({
  GOOGLE_CLIENT_IDS: Object.freeze([
    '694517401702-4oidkp8p8h9fcpkst0d76o7tn10r1vqq.apps.googleusercontent.com'
  ]),
  GOOGLE_TOKEN_ISSUERS: Object.freeze([
    'accounts.google.com',
    'https://accounts.google.com'
  ]),
  ALLOWED_EMAIL_DOMAINS: Object.freeze([
    'billfree.in',
    'gmail.com'
  ]),
  DEFAULT_TRUSTED_PARENT_ORIGINS: Object.freeze([
    'https://billfreetech.pages.dev'
  ])
});

function normalizeEmail_(email) {
  return String(email || '').toLowerCase().trim();
}

function isAdminEmail_(email) {
  return ADMIN_EMAILS_NORMALIZED.includes(normalizeEmail_(email));
}

/**
 *  AGENT DIRECTORY
 * Contact info (PII) now stored in PropertiesService for security
 * Use getAgentPhone() to retrieve phone numbers securely
 */
const AGENT_DIRECTORY = Object.freeze({
  "Agent 1":        { email: "agent1@billfree.in",      role: "agent" },
  "Agent 2": { email: "agent2@billfree.in",      role: "agent" },
  "Agent 3": { email: "agent3@billfree.in",      role: "agent" },
  "Agent 4":      { email: "agent4@billfree.in",      role: "agent", active: false }, // resigned
  "Admin":        { email: "admin@billfree.in",       role: "admin" }
});

const AUTHORIZED_EMAILS_NORMALIZED_ = Object.freeze(
  Array.from(new Set(
    ADMIN_EMAILS
      .concat(Object.values(AGENT_DIRECTORY).map(info => info.email || ''))
      .map(normalizeEmail_)
      .filter(Boolean)
  ))
);

function sanitizeOrigin_(origin) {
  const match = String(origin || '').trim().match(/^https?:\/\/[^\/?#]+/i);
  return match ? match[0].replace(/\/$/, '') : '';
}

function getTrustedParentOrigins_() {
  const configured = String(
    PropertiesService.getScriptProperties().getProperty('TRUSTED_PARENT_ORIGINS') || ''
  )
    .split(',')
    .map(sanitizeOrigin_)
    .filter(Boolean);

  const fallback = AUTH_CONFIG.DEFAULT_TRUSTED_PARENT_ORIGINS
    .map(sanitizeOrigin_)
    .filter(Boolean);

  return Array.from(new Set(configured.length > 0 ? configured : fallback));
}

function isAuthorizedUserEmail_(email) {
  const normalized = normalizeEmail_(email);
  if (!normalized) return false;

  const domain = normalized.split('@')[1] || '';
  if (!AUTH_CONFIG.ALLOWED_EMAIL_DOMAINS.includes(domain)) {
    return false;
  }

  return AUTHORIZED_EMAILS_NORMALIZED_.includes(normalized);
}

function isKnownAgentName_(agentName) {
  return Object.prototype.hasOwnProperty.call(AGENT_DIRECTORY, String(agentName || '').trim());
}

/**
 *  LOOK UP AN AGENT BY EMAIL
 * Returns the agent object { name, email, role } or null.
 * Called by getCurrentUserEmail() and doGet() to resolve agentName.
 * @param {string} email
 * @returns {{ name: string, email: string, role: string }|null}
 */
function getAgentByEmail(email) {
  if (!email) return null;
  const normalized = email.toLowerCase().trim();
  for (const [name, info] of Object.entries(AGENT_DIRECTORY)) {
    if (info.email && info.email.toLowerCase() === normalized) {
      return { name, email: info.email, role: info.role || 'agent' };
    }
  }
  return null;
}

function resolveIdentityContext_(options = {}) {
  const idToken = String(options.idToken || '');
  const allowSessionFallback = options.allowSessionFallback !== false;

  // 1. Try cheap HMAC server token first (no HTTP calls, instant)
  let email = '';
  let authSource = 'none';
  const serverVerified = idToken ? verifyServerToken_(idToken) : null;
  if (serverVerified && serverVerified.email) {
    email = serverVerified.email;
    authSource = 'server_token';
    setRequestUser_(email);
  }

  // 2. Fall back to Google OAuth token (requires HTTP calls to Google)
  const verifiedToken = (!email && idToken.length > 32) ? verifyGoogleToken_(idToken) : null;
  if (!email && verifiedToken && verifiedToken.email) {
    email = normalizeEmail_(verifiedToken.email);
    authSource = 'id_token';
  }

  // 3. Session fallback (works for 'Anyone with Google account' + google.script.run context)
  if (!email && allowSessionFallback) {
    email = normalizeEmail_(getSessionEmail_());
    if (email) authSource = 'session';
  }

  if (!email || !isAuthorizedUserEmail_(email)) {
    return {
      success: false,
      email: '',
      name: '',
      agent: null,
      role: ROLES.VIEWER,
      isAdmin: false,
      source: email ? 'unauthorized' : 'none'
    };
  }

  setRequestUser_(email);

  const agent = getAgentByEmail(email);
  const verifiedName = String((verifiedToken && verifiedToken.name) || '').trim().substring(0, 120);

  return {
    success: true,
    email: email,
    name: verifiedName || (agent ? agent.name : email.split('@')[0]),
    agent: agent,
    role: agent ? (agent.role || ROLES.AGENT) : (isAdminEmail_(email) ? ROLES.ADMIN : ROLES.AGENT),
    isAdmin: isAdminEmail_(email),
    source: authSource
  };
}

/**
 * [AUTH] SERVER TOKEN — cheap HMAC-based auth for Cloudflare iframe path.
 * Avoids external HTTP calls. Valid for 24 hours.
 * Secret is auto-generated and stored in Script Properties on first use.
 */
function getServerTokenSecret_() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('SERVER_TOKEN_SECRET');
  if (!secret) {
    // Utilities.getUuid() is a valid GAS API (generateKey does NOT exist)
    secret = Utilities.getUuid() + '-' + Utilities.getUuid();
    props.setProperty('SERVER_TOKEN_SECRET', secret);
  }
  return secret;
}

function generateServerToken_(email) {
  if (!email) return '';
  try {
    const secret = getServerTokenSecret_();
    const ts = Math.floor(Date.now() / 1000); // epoch seconds
    const payload = email + '|' + ts;
    const mac = Utilities.base64Encode(
      Utilities.computeHmacSha256Signature(payload, secret)
    );
    return payload + '|' + mac;
  } catch (e) {
    Logger.log('generateServerToken_ error: ' + e.toString());
    return '';
  }
}

function verifyServerToken_(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const parts = token.split('|');
    if (parts.length !== 3) return null;
    const email = parts[0];
    const ts    = parseInt(parts[1], 10);
    const mac   = parts[2];

    // Check expiry: 24 hours
    const nowSecs = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(ts) || (nowSecs - ts) > 86400) {
      Logger.log('[ServerToken] Expired or invalid timestamp');
      return null;
    }

    // Recompute HMAC
    const secret = getServerTokenSecret_();
    const payload = email + '|' + parts[1];
    const expected = Utilities.base64Encode(
      Utilities.computeHmacSha256Signature(payload, secret)
    );

    if (expected !== mac) {
      Logger.log('[ServerToken] HMAC mismatch — token tampered');
      return null;
    }

    const normalizedEmail = normalizeEmail_(email);
    if (!isAuthorizedUserEmail_(normalizedEmail)) {
      Logger.log('[ServerToken] Unauthorized email: ' + normalizedEmail);
      return null;
    }

    return { email: normalizedEmail };
  } catch (e) {
    Logger.log('verifyServerToken_ error: ' + e.toString());
    return null;
  }
}

/**
 * [TICKETS] GET AGENT LIST (JSON)
 * Returns all agents from AGENT_DIRECTORY as a structured JSON response.
 * Called by:
 *   - frontend google.script.run.getAgentList()
 *   - doGet() to inject agents into the HTML template at render time
 */
function getAgentList() {
  try {
    const agents = Object.entries(AGENT_DIRECTORY).map(([name, info]) => ({
      name:  name,
      email: info.email || '',
      role:  info.role  || 'agent'
    }));
    return JSON.stringify({
      success: true,
      agents:  agents,
      count:   agents.length
    });
  } catch (e) {
    Logger.log('getAgentList error: ' + e.toString());
    return JSON.stringify({ success: false, agents: [], error: e.toString() });
  }
}

/**
 * [SECURE] SECURE PII RETRIEVAL
 * Phone numbers stored in PropertiesService, not in source code
 * Run initializeAgentPhones() once to set up phone numbers
 */
function getAgentPhone(agentName) {
  try {
    const props = PropertiesService.getScriptProperties();
    const key = `AGENT_PHONE_${agentName.replace(/\s/g, '_').toUpperCase()}`;
    return props.getProperty(key) || null;
  } catch (e) {
    Logger.log('Error retrieving agent phone: ' + e.toString());
    return null;
  }
}

/**
 *  SECURE PHONE NUMBER INITIALIZATION (Phase 1 Security Fix)
 * 
 * [WARN] IMPORTANT: Phone numbers are NO LONGER stored in source code.
 * Run this function from the Apps Script editor with the phoneNumbers parameter.
 * 
 * Usage:
 *   initializeAgentPhones({
 *     'AGENT_4': '91XXXXXXXXXX',
 *     'AGENT_1': '91XXXXXXXXXX',
 *     'AGENT_2': '91XXXXXXXXXX'
 *   });
 * 
 * @param {Object} phoneNumbers - Map of agent name (uppercase, underscore for spaces) to phone number
 * @returns {string} Status message
 */
function initializeAgentPhones(phoneNumbers) {
  // Security check - only allow from Apps Script editor, not web app
  const userEmail = Session.getActiveUser().getEmail();
  if (!isAdminEmail_(userEmail)) {
    return 'Error: Only administrators can initialize phone numbers';
  }
  
  if (!phoneNumbers || typeof phoneNumbers !== 'object') {
    return `
+===============================================================+
|  [SECURE] SECURE PHONE NUMBER INITIALIZATION                        |
+===============================================================+
|                                                               |
|  Phone numbers are NOT stored in source code for security.    |
|                                                               |
|  To initialize, run from Apps Script editor:                  |
|                                                               |
|    initializeAgentPhones({                                    |
|      'AGENT_4': '91XXXXXXXXXX',                               |
|      'AGENT_1': '91XXXXXXXXXX',                               |
|      'AGENT_2': '91XXXXXXXXXX'                           |
|    });                                                        |
|                                                               |
|  Replace X with actual phone digits.                          |
|                                                               |
+===============================================================+
    `;
  }
  
  const props = PropertiesService.getScriptProperties();
  const results = [];
  
  for (const [agentKey, phone] of Object.entries(phoneNumbers)) {
    const sanitizedKey = agentKey.toUpperCase().replace(/\s/g, '_');
    const propKey = `AGENT_PHONE_${sanitizedKey}`;
    
    // Validate phone format (basic check)
    if (!/^\d{10,15}$/.test(phone.replace(/\D/g, ''))) {
      results.push(`[WARN] ${agentKey}: Invalid phone format (skipped)`);
      continue;
    }
    
    props.setProperty(propKey, phone.replace(/\D/g, ''));
    results.push(`[OK] ${agentKey}: Phone stored securely`);
  }
  
  // Log this security-sensitive action
  logAuditEvent('PHONE_NUMBERS_INITIALIZED', null, {
    agentCount: Object.keys(phoneNumbers).length,
    initializedBy: userEmail
  }, 'INFO');
  
  return '[SECURE] Phone Initialization Complete:\n' + results.join('\n');
}

/**
 * [LOCK] ROLE-BASED ACCESS CONTROL
 */
const ROLES = Object.freeze({
  ADMIN: 'admin',
  MANAGER: 'manager',
  AGENT: 'agent',
  VIEWER: 'viewer',
  SYSTEM: 'system'
});

const PERMISSIONS = Object.freeze({
  CLOSE_TICKET: [ROLES.ADMIN, ROLES.MANAGER],
  DELETE_TICKET: [ROLES.ADMIN],
  VIEW_AUDIT: [ROLES.ADMIN, ROLES.MANAGER],
  MANAGE_USERS: [ROLES.ADMIN],
  UPDATE_TICKET: [ROLES.ADMIN, ROLES.MANAGER, ROLES.AGENT],
  VIEW_ANALYTICS: [ROLES.ADMIN, ROLES.MANAGER, ROLES.AGENT],
  CREATE_TICKET: [ROLES.ADMIN, ROLES.MANAGER, ROLES.AGENT],
  CALL_LOG_EVENT: [ROLES.ADMIN, ROLES.MANAGER, ROLES.AGENT],
  EXPORT_TICKETS: [ROLES.ADMIN, ROLES.MANAGER],
  EXPORT_REPORT: [ROLES.ADMIN, ROLES.MANAGER],
  EXPORT_HISTORY: [ROLES.ADMIN, ROLES.MANAGER]
});

/**
 *  RATE LIMITING
 * Prevents abuse and ensures fair usage
 */
function rateLimitCheck(action) {
  const userEmail = getSessionEmail_() || 'anonymous';
  const cache = CacheService.getUserCache();
  const key = `rate_${action}_${userEmail.replace(/[@.]/g, '_')}`;
  
  const currentCount = parseInt(cache.get(key) || '0');
  
  if (currentCount >= CONFIG.RATE_LIMIT_MAX_REQUESTS) {
    throw new Error(`[${ERROR_CODES.RATE_LIMITED}] Rate limit exceeded. Please wait ${CONFIG.RATE_LIMIT_WINDOW_SECONDS} seconds.`);
  }
  
  cache.put(key, String(currentCount + 1), CONFIG.RATE_LIMIT_WINDOW_SECONDS);
  return true;
}

/**
 * [SECURE] CSRF PROTECTION
 * Prevents cross-site request forgery attacks
 */
function generateCSRFToken() {
  const token = Utilities.getUuid();
  const cache = CacheService.getUserCache();
  const timestamp = String(Date.now());
  cache.put('CSRF_TOKEN', token, 3600); // 1 hour TTL
  cache.put('CSRF_TOKEN_TS', timestamp, 3600);
  return token;
}

/**
 * Get (or lazily create) the current user's CSRF token.
 * Called by the frontend on boot and after cache eviction.
 * @returns {string} JSON { success, token } | { success:false, error }
 */
function getCSRFToken() {
  try {
    const cache = CacheService.getUserCache();
    let token = cache.get('CSRF_TOKEN');
    if (!token) {
      token = generateCSRFToken();
    } else if (!cache.get('CSRF_TOKEN_TS')) {
      cache.put('CSRF_TOKEN_TS', String(Date.now()), 3600);
    }
    return JSON.stringify({ success: true, token: token });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 *  CSRF TOKEN ENFORCEMENT (Phase 1 Security Fix)
 * Validates CSRF token for all mutating operations
 * @param {string} token - CSRF token from client
 * @throws {Error} If token is missing or invalid
 */
function requireCSRFToken(token) {
  if (!token) {
    logAuditEvent('CSRF_MISSING', null, { 
      message: 'CSRF token not provided' 
    }, 'WARNING');
    throw new Error(`[${ERROR_CODES.UNAUTHORIZED}] CSRF token required for this operation`);
  }
  
  const result = validateCSRFTokenEnhanced(token);
  if (!result.valid) {
    logAuditEvent('CSRF_INVALID', null, { 
      message: 'Invalid or expired CSRF token',
      reason: result.reason,
      providedToken: token.substring(0, 8) + '...' // Log partial for debugging
    }, 'WARNING');
    throw new Error(`[${ERROR_CODES.UNAUTHORIZED}] Invalid or expired CSRF token. Please refresh the page.`);
  }
  
  return true;
}

/**
 * [P1-FIX] RISK-07: validateCSRFTokenEnhanced is the single source of truth for
 * CSRF validation. It is invoked by requireCSRFToken() on every write operation.
 *
 * This implementation:
 * 1. Validates the token against the UserCache-stored token (set by generateCSRFToken).
 * 2. Enforces a 2-hour max age to reduce replay window (stricter than 1h TTL alone).
 * 3. Handles cache eviction gracefully:
 *    - On UserCache miss (GAS deploy, cache purge), re-generates the token so the
 *      NEXT request gets a valid token — rather than hard-failing every in-flight request.
 *    - Returns { valid: false, reason: 'cache_miss' } for the CURRENT call so the
 *      client can re-fetch a token and retry (standard CSRF flow).
 *
 * @param {string} suppliedToken - CSRF token sent by the frontend
 * @returns {{ valid: boolean, reason: string }}
 */
function validateCSRFTokenEnhanced(suppliedToken) {
  const CSRF_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours max replay window

  if (!suppliedToken || typeof suppliedToken !== 'string' || suppliedToken.length < 10) {
    return { valid: false, reason: 'token_format_invalid' };
  }

  try {
    const cache = CacheService.getUserCache();
    const storedToken = cache.get('CSRF_TOKEN');
    const storedTs    = cache.get('CSRF_TOKEN_TS');

    // [P1-FIX] RISK-07: Cache eviction handling.
    // If GAS was redeployed or cache was purged, storedToken is null.
    // Regenerate silently so the NEXT request gets a valid token.
    // Return cache_miss so the CURRENT caller triggers a token re-fetch.
    if (!storedToken) {
      Logger.log('[CSRF] Cache miss — token evicted (deploy or purge). Regenerating.');
      generateCSRFToken(); // seed fresh token for next call
      return { valid: false, reason: 'cache_miss' };
    }

    // Constant-time string comparison to prevent timing attacks
    if (suppliedToken !== storedToken) {
      return { valid: false, reason: 'token_mismatch' };
    }

    // Age check — reject tokens older than 2 hours even if still in cache
    if (storedTs) {
      const issuedAt = parseInt(storedTs, 10);
      if (!isNaN(issuedAt) && (Date.now() - issuedAt) > CSRF_MAX_AGE_MS) {
        Logger.log('[CSRF] Token expired by age check (' + Math.round((Date.now()-issuedAt)/60000) + ' min old)');
        generateCSRFToken(); // rotate immediately for next call
        return { valid: false, reason: 'token_expired' };
      }
    }

    return { valid: true, reason: 'ok' };

  } catch (e) {
    Logger.log('[CSRF] validateCSRFTokenEnhanced error: ' + e.toString());
    // Fail closed on unexpected errors — never grant access on exception
    return { valid: false, reason: 'internal_error' };
  }
}

/**
 * [LOCK] PERMISSION ENFORCEMENT (Critical Fix)
 * Checks if current user has required permission based on their role
 * @param {string} action - Permission key from PERMISSIONS constant
 * @throws {Error} If user lacks the required permission
 */
function requirePermission(action, idToken) {
  // Always resolve identity — token path (Cloudflare) or session fallback (direct GAS)
  const identity = resolveIdentityContext_({
    idToken: idToken || '',
    allowSessionFallback: true
  });

  const userEmail = identity.email;
  if (!userEmail) {
    throw new Error(`[${ERROR_CODES.UNAUTHORIZED}] Authentication required`);
  }

  // Admins always have all permissions (case-insensitive)
  if (identity.isAdmin) {
    return true;
  }

  // Determine user's role from identity context
  const userRole = identity.role || getUserRole(userEmail);

  // Get allowed roles for this action -- FAIL CLOSED for unknown keys
  const allowedRoles = PERMISSIONS[action];
  if (!allowedRoles) {
    logAuditEvent('PERMISSION_CONFIG_ERROR', null, {
      user: userEmail,
      action: action,
      message: 'Unknown permission key requested'
    }, 'ERROR');
    throw new Error(`[${ERROR_CODES.INSUFFICIENT_PERMISSIONS}] Unknown permission: ${action}`);
  }

  // Check if user's role is in the allowed list
  if (!allowedRoles.includes(userRole)) {
    logAuditEvent('PERMISSION_DENIED', null, {
      user: userEmail,
      action: action,
      userRole: userRole,
      allowedRoles: allowedRoles.join(', ')
    }, 'WARNING');

    throw new Error(`[${ERROR_CODES.INSUFFICIENT_PERMISSIONS}] You don't have permission: ${action}`);
  }

  return true;
}

/**
 *  GET USER ROLE
 * Determines the role for a given user email
 * @param {string} email - User's email address (optional, defaults to current user)
 * @returns {string} User's role from ROLES constant
 */
function getUserRole(email) {
  const userEmail = normalizeEmail_(email || getSessionEmail_());
  if (!userEmail) return ROLES.VIEWER;
  
  // Check if admin (case-insensitive)
  if (isAdminEmail_(userEmail)) {
    return ROLES.ADMIN;
  }
  
  // Check agent directory for specific role assignments (e.g., manager)
  for (const [name, info] of Object.entries(AGENT_DIRECTORY)) {
    if (info.email && info.email.toLowerCase() === userEmail) {
      return info.role || ROLES.AGENT;
    }
  }
  
  // Fail closed: unknown users are VIEWER until explicitly mapped.
  return ROLES.VIEWER;
}

/**
 *  GET CURRENT USER IDENTITY
 * Returns current user identity for frontend initialization and forms.
 * [CACHE] SECURE IDENTITY SYNC: Now accepts an optional ID token from Cloudflare/GSI.
 * If no token is provided, falls back to standard GAS Session (often restricted in iframes).
 * 
 * @param {string} [idToken] - Google ID Token from Cloudflare/GSI
 * @returns {string} JSON response with success, email, role, and isAdmin status
 */
function getCurrentUserEmail(idToken) {
  try {
    const identity = resolveIdentityContext_({
      idToken: idToken,
      allowSessionFallback: true
    });

    // 1. Verify ID Token
    if (!identity.success) {
      return JSON.stringify({
        success: false,
        error: idToken ? 'Unauthorized account or invalid Google token' : 'User not authenticated'
      });
    }


    return JSON.stringify({
      success: true,
      email: identity.email,
      role: identity.role,
      isAdmin: identity.isAdmin,
      agentName: identity.agent ? identity.agent.name : identity.name,
      source: identity.source
    });

  } catch (e) {
    Logger.log('getCurrentUserEmail error: ' + e.toString());

    return JSON.stringify({
      success: false,
      error: e.toString()
    });
  }
}

/**
 * [SECURE] VERIFY GOOGLE ID TOKEN
 * Validates the token against Google's tokeninfo endpoint.
 * Ensures the token was issued to our Client ID and is not expired.
 * 
 * @param {string} token
 * @returns {Object|null} Payload if valid, null otherwise
 */
function verifyGoogleToken_(token) {
  const safeToken = String(token || '').trim();
  if (!safeToken) return null;

  const looksLikeIdToken = safeToken.split('.').length === 3;
  return looksLikeIdToken
    ? verifyGoogleIdToken_(safeToken)
    : verifyGoogleAccessToken_(safeToken);
}

function verifyGoogleIdToken_(token) {
  if (!token) return null;
  try {
    // [CACHE] Performance: Tokeninfo endpoint call (costs ~200-400ms)
    const response = UrlFetchApp.fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`,
      { muteHttpExceptions: true }
    );

    if (response.getResponseCode() !== 200) {
      Logger.log('Token verification failed: ' + response.getContentText());
      return null;
    }

    const payload = JSON.parse(response.getContentText());

    // Security Checks:
    // 1. Check expiration (handled by Google endpoint response)
    // 2. Check audience (aud) matches our Client ID
    const audience = String(payload.aud || '');
    if (!AUTH_CONFIG.GOOGLE_CLIENT_IDS.includes(audience)) {
      Logger.log('[Security] Token Audience mismatch!');
      return null;
    }

    // 3. Check issuer
    const issuer = String(payload.iss || '');
    if (!AUTH_CONFIG.GOOGLE_TOKEN_ISSUERS.includes(issuer)) {
      Logger.log('[Security] Token issuer mismatch!');
      return null;
    }

    // 4. Check email_verified
    if (String(payload.email_verified).toLowerCase() !== 'true') {
      Logger.log('[Security] Email not verified by Google!');
      return null;
    }

    // 5. Authorize email against known agent/admin list
    const email = normalizeEmail_(payload.email);
    if (!isAuthorizedUserEmail_(email)) {
      Logger.log('[Security] Unauthorized token email: ' + email);
      return null;
    }

    // 6. Belt-and-suspenders expiry check
    const exp = Number(payload.exp || 0);
    if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) {
      Logger.log('[Security] Expired Google token rejected');
      return null;
    }

    payload.email = email;
    payload.provider = 'id_token';

    return payload;
  } catch (e) {
    Logger.log('verifyGoogleIdToken_ error: ' + e.toString());
    return null;
  }
}

function verifyGoogleAccessToken_(token) {
  if (!token) return null;

  try {
    const tokenInfoResponse = UrlFetchApp.fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`,
      { muteHttpExceptions: true }
    );

    if (tokenInfoResponse.getResponseCode() !== 200) {
      Logger.log('Access token verification failed: ' + tokenInfoResponse.getContentText());
      return null;
    }

    const tokenInfo = JSON.parse(tokenInfoResponse.getContentText());
    const audience = String(tokenInfo.aud || tokenInfo.azp || '');
    if (!AUTH_CONFIG.GOOGLE_CLIENT_IDS.includes(audience)) {
      Logger.log('[Security] Access token audience mismatch!');
      return null;
    }

    const expiresIn = Number(tokenInfo.expires_in || 0);
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
      Logger.log('[Security] Expired Google access token rejected');
      return null;
    }

    const userInfoResponse = UrlFetchApp.fetch(
      'https://www.googleapis.com/oauth2/v3/userinfo',
      {
        headers: { Authorization: 'Bearer ' + token },
        muteHttpExceptions: true
      }
    );

    if (userInfoResponse.getResponseCode() !== 200) {
      Logger.log('Google userinfo lookup failed: ' + userInfoResponse.getContentText());
      return null;
    }

    const payload = JSON.parse(userInfoResponse.getContentText());
    const email = normalizeEmail_(payload.email || tokenInfo.email || '');
    if (!email) {
      Logger.log('[Security] Access token email missing');
      return null;
    }

    if (tokenInfo.email && normalizeEmail_(tokenInfo.email) !== email) {
      Logger.log('[Security] Access token email mismatch!');
      return null;
    }

    if (String(payload.email_verified).toLowerCase() !== 'true') {
      Logger.log('[Security] Access token email not verified by Google!');
      return null;
    }

    if (!isAuthorizedUserEmail_(email)) {
      Logger.log('[Security] Unauthorized access token email: ' + email);
      return null;
    }

    payload.email = email;
    payload.exp = Math.floor(Date.now() / 1000) + expiresIn;
    payload.provider = 'access_token';

    return payload;
  } catch (e) {
    Logger.log('verifyGoogleAccessToken_ error: ' + e.toString());
    return null;
  }
}

// Pre-computed normalized agent email list for quick whitelist checks.
const AGENT_EMAILS_NORMALIZED_ = (function() {
  return Object.values(AGENT_DIRECTORY).map(i => normalizeEmail_(i.email)).filter(Boolean);
})();

/**
 * 🔐 API KEY VERIFICATION
 * Validates API key against server-side store (Script Properties).
 * Uses constant-time comparison to prevent timing attacks.
 *
 * Storage format in Script Properties → TICKET_API_KEYS:
 * {
 *   "whatsapp_bot_v1": { "name": "WhatsApp Bot", "active": true, "rateLimit": 60 },
 *   "internal_test":   { "name": "Test Key",     "active": true, "rateLimit": 10 }
 * }
 *
 * @param {string} apiKey - The API key from the request
 * @returns {{ success: boolean, keyInfo?: object, error?: string }}
 */
function verifyApiKey_(apiKey) {
  if (!apiKey || typeof apiKey !== 'string' || apiKey.length < 8) {
    return { success: false, error: 'Missing or invalid API key' };
  }

  try {
    var raw = PropertiesService.getScriptProperties().getProperty('TICKET_API_KEYS');
    if (!raw) {
      Logger.log('[API] TICKET_API_KEYS not configured in Script Properties');
      return { success: false, error: 'API authentication not configured' };
    }

    var keys = JSON.parse(raw);
    if (!keys || typeof keys !== 'object') {
      return { success: false, error: 'API key store corrupted' };
    }

    // Constant-time key lookup: iterate ALL keys, compare with secureEquals_
    var matchedEntry = null;
    var keyNames = Object.keys(keys);
    for (var i = 0; i < keyNames.length; i++) {
      if (secureEquals_(apiKey, keyNames[i])) {
        matchedEntry = keys[keyNames[i]];
      }
    }

    if (!matchedEntry) {
      Logger.log('[API] Invalid API key attempted');
      return { success: false, error: 'Invalid API key' };
    }

    if (matchedEntry.active === false) {
      Logger.log('[API] Deactivated API key used: ' + (matchedEntry.name || 'unknown'));
      return { success: false, error: 'API key is deactivated' };
    }

    return {
      success: true,
      keyInfo: {
        name: matchedEntry.name || 'Unknown',
        rateLimit: Number(matchedEntry.rateLimit) || 60
      }
    };
  } catch (e) {
    Logger.log('[API] verifyApiKey_ error: ' + e.toString());
    return { success: false, error: 'API key verification failed' };
  }
}

function apiRateLimitCheck_(apiKey, maxRequests) {
  var limit = maxRequests || 60;
  var cache = CacheService.getScriptCache();
  var cacheKey = 'API_RL_' + apiKey;

  var current = parseInt(cache.get(cacheKey) || '0', 10);

  if (current >= limit) {
    return { allowed: false, remaining: 0 };
  }

  cache.put(cacheKey, String(current + 1), 60); // 60-second window
  return { allowed: true, remaining: limit - current - 1 };
}
