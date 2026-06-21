'use strict';
/**
 * Test runner: loads the real, unmodified Code.gs into a vm context backed by
 * GAS mocks, then executes every *.test.js suite in this directory.
 *
 *   node tests/run.js
 *
 * Exits non-zero if any test fails (CI-friendly). No external dependencies.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createGasMocks } = require('./gas-mocks');

// GAS shares ONE global namespace across every .gs file (they are effectively
// concatenated at load). We mirror that exactly: read all .gs files from the
// backend source dir and run them as a single script in one context, so
// cross-file calls and shared top-level consts resolve just like in production.
// Code.gs is loaded first (it defines CONFIG, ERROR_CODES, …); rest alphabetical.
const rootDir = path.join(__dirname, '..', 'src');
const gsFiles = fs.readdirSync(rootDir)
  .filter(function (f) { return /\.gs$/.test(f) && !/\.backup/i.test(f); })
  .sort(function (a, b) {
    if (a === 'Code.gs') return -1;
    if (b === 'Code.gs') return 1;
    return a.localeCompare(b);
  });

const source = gsFiles
  .map(function (f) { return '/* ===== ' + f + ' ===== */\n' + fs.readFileSync(path.join(rootDir, f), 'utf8'); })
  .join('\n\n');

const context = createGasMocks();
vm.createContext(context);
try {
  vm.runInContext(source, context, { filename: 'gas-bundle.js' });
} catch (e) {
  console.error('✗ Failed to load .gs bundle into the test context:\n', e && e.stack || e);
  process.exit(1);
}
console.log('Loaded GAS bundle: ' + gsFiles.join(', '));

let passed = 0, failed = 0;
const failures = [];

function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

const t = {
  test: function (name, fn) {
    try { fn(); passed++; console.log('  ✓ ' + name); }
    catch (e) { failed++; failures.push(name); console.log('  ✗ ' + name + ' — ' + e.message); }
  },
  eq: function (actual, expected, msg) {
    if (!deepEq(actual, expected)) {
      throw new Error((msg ? msg + ': ' : '') + 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
    }
  },
  ok: function (v, msg) { if (!v) throw new Error(msg || ('expected truthy, got ' + JSON.stringify(v))); },
  throws: function (fn, msg) { try { fn(); } catch (e) { return; } throw new Error(msg || 'expected an exception, none thrown'); },
  notThrows: function (fn, msg) { try { fn(); } catch (e) { throw new Error((msg || 'expected no exception') + ' but threw: ' + e.message); } }
};

const suites = fs.readdirSync(__dirname).filter(function (f) { return /\.test\.js$/.test(f); }).sort();
for (const file of suites) {
  console.log('\n' + file);
  require(path.join(__dirname, file))(context, t, context.__mock);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('Failed: ' + failures.join(', ')); process.exit(1); }
