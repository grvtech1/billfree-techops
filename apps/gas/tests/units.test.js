'use strict';
/**
 * Unit tests for the pure, money-path helpers in Code.gs.
 * These functions carry real business logic (status canonicalization, phone
 * normalization, SLA categorization, CSV-injection safety, input validation)
 * and previously had zero automated coverage.
 */
module.exports = function (gas, t) {

  // ── Status canonicalization ──────────────────────────────────────────────
  t.test('normalizeStatusWithDefault: blank → Not Completed', function () {
    t.eq(gas.normalizeStatusWithDefault(''), 'Not Completed');
  });
  t.test('normalizeStatusWithDefault: smart-quote "can’t" → Can\'t Do', function () {
    t.eq(gas.normalizeStatusWithDefault('can’t do'), "Can't Do");
  });
  t.test('normalizeStatusWithDefault: case-insensitive Completed', function () {
    t.eq(gas.normalizeStatusWithDefault('COMPLETED'), 'Completed');
  });
  t.test('parseStatusOrNull: rejects unknown → null', function () {
    t.eq(gas.parseStatusOrNull('frobnicate'), null);
  });
  t.test('parseStatusOrNull: "IN PROGRESS" → In Progress', function () {
    t.eq(gas.parseStatusOrNull('IN PROGRESS'), 'In Progress');
  });
  t.test('parseStatusOrNull: null → null', function () {
    t.eq(gas.parseStatusOrNull(null), null);
  });

  // ── Phone normalization / display ────────────────────────────────────────
  t.test('normalizeCallPhone_: strips formatting, keeps +', function () {
    t.eq(gas.normalizeCallPhone_('+91 (98765) 43210'), '+919876543210');
  });
  t.test('normalizeCallPhone_: caps at 20 chars', function () {
    t.eq(gas.normalizeCallPhone_('1'.repeat(50)).length, 20);
  });
  t.test('formatPhoneDisplay_: 10-digit grouping', function () {
    t.eq(gas.formatPhoneDisplay_('9876543210'), '98765 43210');
  });
  t.test('formatPhoneDisplay_: 91-prefixed 12-digit', function () {
    t.eq(gas.formatPhoneDisplay_('919876543210'), '+91 98765 43210');
  });

  // ── SLA duration + category ──────────────────────────────────────────────
  t.test('formatDurationSla_: <4h → fast', function () {
    t.eq(gas.formatDurationSla_(60 * 60 * 1000).category, 'fast');
  });
  t.test('formatDurationSla_: 72h → critical', function () {
    t.eq(gas.formatDurationSla_(72 * 60 * 60 * 1000).category, 'critical');
  });
  t.test('formatDurationSla_: negative clamped to 0m', function () {
    t.eq(gas.formatDurationSla_(-5).formatted, '0m');
  });
  t.test('formatDurationSla_: 25h → "1d 1h"', function () {
    t.eq(gas.formatDurationSla_(25 * 60 * 60 * 1000).formatted, '1d 1h');
  });

  // ── Provider call-outcome mapping ────────────────────────────────────────
  t.test('normalizeProviderOutcome_: answered → CONNECTED', function () {
    t.eq(gas.normalizeProviderOutcome_('answered', ''), 'CONNECTED');
  });
  t.test('normalizeProviderOutcome_: no_answer variants → NO_ANSWER', function () {
    t.eq(gas.normalizeProviderOutcome_('no_answer', ''), 'NO_ANSWER');
  });
  t.test('normalizeProviderOutcome_: unknown → OTHER', function () {
    t.eq(gas.normalizeProviderOutcome_('zzz', ''), 'OTHER');
  });
  t.test('normalizeProviderOutcome_: empty → empty', function () {
    t.eq(gas.normalizeProviderOutcome_('', ''), '');
  });
  t.test('parseDurationSec_: non-numeric → 0', function () {
    t.eq(gas.parseDurationSec_('abc'), 0);
  });
  t.test('parseDurationSec_: positive int passes through', function () {
    t.eq(gas.parseDurationSec_('42'), 42);
  });

  // ── CSV-injection safety (security-critical export path) ─────────────────
  t.test('csvSafeCell_: neutralizes formula injection', function () {
    t.eq(gas.csvSafeCell_('=SUM(A1)'), "'=SUM(A1)");
  });
  t.test('csvSafeCell_: quotes embedded commas', function () {
    t.eq(gas.csvSafeCell_('a,b'), '"a,b"');
  });
  t.test('csvSafeCell_: escapes embedded quotes', function () {
    t.eq(gas.csvSafeCell_('a"b'), '"a""b"');
  });
  t.test('csvSafeCell_: plain value untouched', function () {
    t.eq(gas.csvSafeCell_('hello'), 'hello');
  });

  // ── Input sanitization ───────────────────────────────────────────────────
  t.test('sanitizeInput: strips angle brackets + backticks', function () {
    t.eq(gas.sanitizeInput('<b>`x`'), 'bx');
  });
  t.test('sanitizeInput: email lowercases + strips junk', function () {
    t.eq(gas.sanitizeInput('  Foo@Bar.COM ', { type: 'email' }), 'foo@bar.com');
  });
  t.test('sanitizeInput: enforces maxLength', function () {
    t.eq(gas.sanitizeInput('abcdef', { maxLength: 3 }), 'abc');
  });
  t.test('sanitizeInput: null → provided default', function () {
    t.eq(gas.sanitizeInput(null, { default: 'x' }), 'x');
  });

  // ── Schema-driven field validation ───────────────────────────────────────
  t.test('validateField: status rejects unknown value', function () {
    t.ok(!gas.validateField('Bogus', 'status').valid);
  });
  t.test('validateField: ticketId sanitizes then validates', function () {
    const r = gas.validateField('bf-202604-0001', 'ticketId');
    t.ok(r.valid);
    t.eq(r.value, 'BF-202604-0001');
  });
  t.test('validateField: unknown schema name is invalid', function () {
    t.ok(!gas.validateField('x', 'nope').valid);
  });
  t.test('validateField: status accepts a valid STATUS_ENUM value (lazy schema resolves)', function () {
    const r = gas.validateField('Completed', 'status');
    t.ok(r.valid, 'Completed should be an allowed status');
  });
  t.test('validateField: email rejects malformed address', function () {
    t.ok(!gas.validateField('not-an-email', 'email').valid);
  });
  t.test('validateField: reason below minLength is invalid', function () {
    const r = gas.validateField('ab', 'reason');
    t.ok(!r.valid);
  });

  // ── Email + admin identity ───────────────────────────────────────────────
  t.test('normalizeEmail_: trims + lowercases', function () {
    t.eq(gas.normalizeEmail_('  AD@B.IN '), 'ad@b.in');
  });
  t.test('isAdminEmail_: admin recognized', function () {
    t.ok(gas.isAdminEmail_('admin@billfree.in'));
  });
  t.test('isAdminEmail_: agent is not admin', function () {
    t.ok(!gas.isAdminEmail_('agent1@billfree.in'));
  });

  // ── Correlation id shape ─────────────────────────────────────────────────
  t.test('generateCorrelationId: matches TS-RND format', function () {
    t.ok(/^[0-9A-Z]+-[0-9A-Z]{1,8}$/.test(gas.generateCorrelationId()));
  });
};
