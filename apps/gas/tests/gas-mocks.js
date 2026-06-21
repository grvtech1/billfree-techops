'use strict';
/**
 * In-memory mocks of the Google Apps Script services that Code.gs touches.
 * Lets the real, unmodified Code.gs run under Node for unit testing.
 *
 * createGasMocks() returns an object used directly as a vm context: it carries
 * the GAS service globals, the standard JS globals Code.gs relies on, and a
 * `__mock` handle exposing the underlying state so tests can arrange + assert.
 */
function createGasMocks() {
  const props = {};      // ScriptProperties backing store
  const sheets = {};     // sheet name -> MockSheet
  const cache = {};       // ScriptCache backing store
  let sessionEmail = 'admin@billfree.in';
  let uuidCounter = 0;

  function MockSheet(name, grid) {
    this.name = name;
    this.grid = grid || [[]]; // row 0 = headers
  }
  MockSheet.prototype.getName = function () { return this.name; };
  MockSheet.prototype.getLastRow = function () { return this.grid.length; };
  MockSheet.prototype.getLastColumn = function () {
    return this.grid.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
  };
  MockSheet.prototype.getRange = function (row, col, numRows, numCols) {
    const r0 = row - 1, c0 = col - 1, nr = numRows || 1, nc = numCols || 1, grid = this.grid;
    return {
      getValue: function () { return (grid[r0] && grid[r0][c0] !== undefined) ? grid[r0][c0] : ''; },
      getValues: function () {
        const out = [];
        for (let i = 0; i < nr; i++) {
          const rowArr = [];
          for (let j = 0; j < nc; j++) {
            const rr = grid[r0 + i] || [];
            rowArr.push(rr[c0 + j] !== undefined ? rr[c0 + j] : '');
          }
          out.push(rowArr);
        }
        return out;
      },
      setValue: function (v) { if (!grid[r0]) grid[r0] = []; grid[r0][c0] = v; },
      setValues: function (vals) {
        for (let i = 0; i < vals.length; i++) {
          if (!grid[r0 + i]) grid[r0 + i] = [];
          for (let j = 0; j < vals[i].length; j++) grid[r0 + i][c0 + j] = vals[i][j];
        }
      },
      setFontWeight: function () { return this; },
      setBackground: function () { return this; },
      setFontColor: function () { return this; },
      setNumberFormat: function () { return this; },
      setValuesAndFlush: function () { return this; }
    };
  };

  const SpreadsheetApp = {
    getActiveSpreadsheet: function () {
      return {
        getSheetByName: function (n) { return sheets[n] || null; },
        insertSheet: function (n) { sheets[n] = new MockSheet(n, [[]]); return sheets[n]; },
        getId: function () { return 'mock-sheet-id'; }
      };
    },
    flush: function () {}
  };

  const PropertiesService = {
    getScriptProperties: function () {
      return {
        getProperty: function (k) { return (k in props) ? props[k] : null; },
        setProperty: function (k, v) { props[k] = String(v); },
        deleteProperty: function (k) { delete props[k]; },
        getProperties: function () { return Object.assign({}, props); }
      };
    },
    getUserProperties: function () { return this.getScriptProperties(); },
    getDocumentProperties: function () { return this.getScriptProperties(); }
  };

  const CacheService = {
    getScriptCache: function () {
      return {
        get: function (k) { return (k in cache) ? cache[k] : null; },
        put: function (k, v) { cache[k] = String(v); },
        remove: function (k) { delete cache[k]; },
        getAll: function (keys) { const o = {}; (keys || []).forEach(function (k) { if (k in cache) o[k] = cache[k]; }); return o; },
        putAll: function (obj) { Object.assign(cache, obj); }
      };
    },
    getUserCache: function () { return this.getScriptCache(); }
  };

  const LockService = {
    getScriptLock: function () {
      return { waitLock: function () { return true; }, tryLock: function () { return true; }, releaseLock: function () {}, hasLock: function () { return true; } };
    }
  };

  const Session = {
    getActiveUser: function () { return { getEmail: function () { return sessionEmail; } }; },
    getEffectiveUser: function () { return { getEmail: function () { return sessionEmail; } }; },
    getScriptTimeZone: function () { return 'Asia/Kolkata'; }
  };

  const Utilities = {
    getUuid: function () { return 'uuid-' + String(++uuidCounter).padStart(8, '0'); },
    formatDate: function () { return '20260101000000'; },
    computeHmacSha256Signature: function (msg) { return Array.from(String(msg)).map(function (c) { return c.charCodeAt(0) % 256; }); },
    base64Encode: function (bytes) { return Buffer.from(Array.isArray(bytes) ? bytes : String(bytes)).toString('base64'); },
    base64EncodeWebSafe: function (bytes) { return Buffer.from(Array.isArray(bytes) ? bytes : String(bytes)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'); },
    newBlob: function (data) { return { getDataAsString: function () { return String(data); } }; },
    sleep: function () {}
  };

  const ContentService = {
    MimeType: { JSON: 'application/json', TEXT: 'text/plain' },
    createTextOutput: function (s) { return { _c: s, setMimeType: function () { return this; }, getContent: function () { return this._c; } }; }
  };

  const HtmlService = {
    createHtmlOutput: function (h) { return { setTitle: function () { return this; }, addMetaTag: function () { return this; }, setXFrameOptionsMode: function () { return this; }, getContent: function () { return h; } }; },
    createTemplateFromFile: function () { return { evaluate: function () { return { setTitle: function () { return this; }, getContent: function () { return ''; } }; } }; },
    XFrameOptionsMode: { ALLOWALL: 'ALLOWALL', DEFAULT: 'DEFAULT' }
  };

  const UrlFetchApp = { fetch: function () { return { getResponseCode: function () { return 200; }, getContentText: function () { return '{}'; } }; } };
  const MailApp = { sendEmail: function () {} };
  const GmailApp = { sendEmail: function () {} };
  const Logger = { log: function () {} };
  const ScriptApp = {
    getProjectTriggers: function () { return []; },
    newTrigger: function () {
      const chain = { timeBased: function () { return chain; }, everyDays: function () { return chain; }, onMonthDay: function () { return chain; }, atHour: function () { return chain; }, create: function () {} };
      return chain;
    },
    deleteTrigger: function () {}
  };

  return {
    // GAS service globals
    SpreadsheetApp: SpreadsheetApp,
    PropertiesService: PropertiesService,
    CacheService: CacheService,
    LockService: LockService,
    Session: Session,
    Utilities: Utilities,
    ContentService: ContentService,
    HtmlService: HtmlService,
    UrlFetchApp: UrlFetchApp,
    MailApp: MailApp,
    GmailApp: GmailApp,
    Logger: Logger,
    ScriptApp: ScriptApp,
    // standard JS globals the vm context needs
    console: console, JSON: JSON, Math: Math, Date: Date, Object: Object, Array: Array,
    String: String, Number: Number, Boolean: Boolean, RegExp: RegExp, Error: Error,
    isNaN: isNaN, isFinite: isFinite, parseInt: parseInt, parseFloat: parseFloat,
    Set: Set, Map: Map, Symbol: Symbol, Buffer: Buffer, encodeURIComponent: encodeURIComponent,
    decodeURIComponent: decodeURIComponent,
    // test handles
    __mock: {
      props: props,
      sheets: sheets,
      cache: cache,
      MockSheet: MockSheet,
      addSheet: function (name, grid) { sheets[name] = new MockSheet(name, grid); return sheets[name]; },
      setSessionEmail: function (e) { sessionEmail = e; }
    }
  };
}

module.exports = { createGasMocks: createGasMocks };
