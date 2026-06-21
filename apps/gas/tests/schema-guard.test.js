'use strict';
/**
 * Tests the Sheet Schema Guard against the REAL functions loaded from Code.gs
 * (not a re-implementation). Exercises: no-baseline (zero behavior change),
 * blessed match, drift detection, observe-vs-enforce blocking, and the
 * legacy short-sheet tolerance.
 */
module.exports = function (gas, t, mock) {
  const GOOD = ['Ticket ID', 'Created At', 'Agent Email', 'IT Email', 'Requested By', 'MID',
    'Business', 'POS', 'Support Type', 'Concern', 'Config Notes', 'Remark', 'Status', 'Reason', 'Phone'];
  const Sheet = mock.MockSheet;
  const SHEET_NAME = 'IT Tracker 26';

  // Make the active sheet = `headers`, and clear baseline + enforce flag.
  function arrange(headers) {
    mock.sheets[SHEET_NAME] = new Sheet(SHEET_NAME, [headers.slice()]);
    delete mock.props['TICKET_SHEET_SCHEMA_BASELINE'];
    delete mock.props['FF_ENFORCE_SHEET_SCHEMA'];
  }
  function driftHeaders() {
    const d = GOOD.slice();
    d.splice(12, 0, 'NEW COL'); // insert before Status → shifts Status/Reason/Phone
    d.length = 15;
    return d;
  }

  t.test('no baseline: verdict ok, behavior unchanged', function () {
    arrange(GOOD);
    const v = JSON.parse(gas.auditTicketSheetHeaders()).verdict;
    t.ok(v.ok && !v.hasBaseline, 'should be ok with no baseline');
  });

  t.test('bless captures baseline; matching layout stays ok', function () {
    arrange(GOOD);
    gas.blessTicketSheetSchema();
    const v = JSON.parse(gas.auditTicketSheetHeaders()).verdict;
    t.ok(v.ok && v.hasBaseline, 'blessed + matching should be ok');
  });

  t.test('bless refuses a short (sub-15-column) sheet', function () {
    arrange(GOOD.slice(0, 14));
    t.throws(function () { gas.blessTicketSheetSchema(); }, 'should refuse to bless a short sheet');
  });

  t.test('drift detected against blessed baseline', function () {
    arrange(GOOD);
    gas.blessTicketSheetSchema();                       // baseline = GOOD
    mock.sheets[SHEET_NAME] = new Sheet(SHEET_NAME, [driftHeaders()]);
    const v = JSON.parse(gas.auditTicketSheetHeaders()).verdict;
    t.ok(!v.ok && v.drift.length >= 1, 'should detect drift');
  });

  t.test('assert observe-mode: drift logs but does NOT throw', function () {
    arrange(GOOD);
    gas.blessTicketSheetSchema();                       // baseline = GOOD, resets per-request memo
    delete mock.props['FF_ENFORCE_SHEET_SCHEMA'];       // observe (default)
    const driftSheet = new Sheet('x', [driftHeaders()]);
    t.notThrows(function () { gas.assertTicketSheetSchema_(driftSheet); });
    t.ok(gas.getMetric_('schema_drift_detected') >= 1, 'drift metric should increment');
  });

  t.test('assert enforce-mode: drift throws', function () {
    arrange(GOOD);
    gas.blessTicketSheetSchema();                       // resets memo, baseline = GOOD
    mock.props['FF_ENFORCE_SHEET_SCHEMA'] = 'true';
    const driftSheet = new Sheet('x', [driftHeaders()]);
    t.throws(function () { gas.assertTicketSheetSchema_(driftSheet); }, 'enforce + drift should block');
  });

  t.test('assert enforce-mode: short sheet blocked (structural)', function () {
    arrange(GOOD);
    gas.blessTicketSheetSchema();                       // resets memo
    mock.props['FF_ENFORCE_SHEET_SCHEMA'] = 'true';
    const shortSheet = new Sheet('x', [GOOD.slice(0, 14)]);
    t.throws(function () { gas.assertTicketSheetSchema_(shortSheet); }, 'enforce + short should block');
  });

  t.test('assert observe-mode: legacy short sheet tolerated', function () {
    arrange(GOOD);
    gas.blessTicketSheetSchema();                       // resets memo
    delete mock.props['FF_ENFORCE_SHEET_SCHEMA'];
    const shortSheet = new Sheet('x', [GOOD.slice(0, 14)]);
    t.notThrows(function () { gas.assertTicketSheetSchema_(shortSheet); }, 'observe should tolerate legacy sheet');
  });

  t.test('case/whitespace differences are NOT drift', function () {
    arrange(GOOD);
    gas.blessTicketSheetSchema();
    const noisy = GOOD.slice();
    noisy[12] = '  STATUS ';
    noisy[5] = 'mid';
    mock.sheets[SHEET_NAME] = new Sheet(SHEET_NAME, [noisy]);
    const v = JSON.parse(gas.auditTicketSheetHeaders()).verdict;
    t.ok(v.ok, 'normalized headers should match');
  });
};
