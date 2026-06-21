'use strict';
/**
 * Tests the API-contract helpers (okResult_/errResult_/parseResult_) and the
 * observability metric helpers. parseResult_ is the boundary normalizer that
 * doPost now uses in place of the scattered
 * `typeof x === 'string' ? JSON.parse(x) : x`.
 */
module.exports = function (gas, t) {

  // ── Envelopes ────────────────────────────────────────────────────────────
  t.test('okResult_: wraps data with success:true', function () {
    t.eq(gas.okResult_({ a: 1 }), { success: true, data: { a: 1 } });
  });
  t.test('okResult_: undefined data → null', function () {
    t.eq(gas.okResult_(undefined), { success: true, data: null });
  });
  t.test('okResult_: merges extra meta', function () {
    t.eq(gas.okResult_([], { meta: { total: 0 } }), { success: true, data: [], meta: { total: 0 } });
  });
  t.test('errResult_: success:false with message + null data', function () {
    t.eq(gas.errResult_('boom'), { success: false, error: 'boom', data: null });
  });

  // ── Boundary normalizer ──────────────────────────────────────────────────
  t.test('parseResult_: object passes through unchanged', function () {
    const obj = { success: true, data: 42 };
    t.ok(gas.parseResult_(obj) === obj);
  });
  t.test('parseResult_: JSON string is parsed', function () {
    t.eq(gas.parseResult_('{"success":true,"data":7}'), { success: true, data: 7 });
  });
  t.test('parseResult_: malformed JSON → safe error envelope (no throw)', function () {
    const r = gas.parseResult_('{not json');
    t.ok(r.success === false && typeof r.error === 'string');
  });
  t.test('parseResult_: non-string/non-object → safe error envelope', function () {
    const r = gas.parseResult_(12345);
    t.ok(r.success === false);
  });
  t.test('parseResult_: behavior matches old inline pattern for valid inputs', function () {
    // old: typeof x === 'string' ? JSON.parse(x) : x
    const cases = ['{"success":true,"data":1}', { success: false, error: 'e', data: null }];
    cases.forEach(function (x) {
      const oldWay = (typeof x === 'string' ? JSON.parse(x) : x);
      t.eq(gas.parseResult_(x), oldWay);
    });
  });

  // ── Metrics ──────────────────────────────────────────────────────────────
  t.test('incrementMetric_: counts up and reads back', function () {
    const name = 'unit_test_counter';
    gas.incrementMetric_(name);
    gas.incrementMetric_(name, 4);
    t.eq(gas.getMetric_(name), 5);
  });
  t.test('getMetric_: unknown metric → 0', function () {
    t.eq(gas.getMetric_('never_set_metric'), 0);
  });
};
