# Code.gs test harness

Runs the **real, unmodified `.gs` source** under Node by loading it into a `vm`
context backed by in-memory mocks of the Google Apps Script services
(`SpreadsheetApp`, `PropertiesService`, `CacheService`, `LockService`,
`Session`, `Utilities`, …). No GAS account, no network, no deploy required.

The runner reads **every root-level `.gs` file** (`Code.gs`, `SchemaGuard.gs`, …)
and runs them as a single concatenated script — mirroring exactly how GAS shares
one global namespace across files. This is what lets the monolith be split into
modules while keeping cross-file calls working, and the suite green.

## Run

```bash
npm test          # or: node tests/run.js
```

Exits non-zero if any test fails (CI-friendly). Zero external dependencies.

## Layout

| File | Purpose |
|------|---------|
| `gas-mocks.js` | In-memory GAS service mocks + a `__mock` handle to arrange/assert state |
| `run.js` | Loads `Code.gs` into the mocked context, runs every `*.test.js` suite |
| `units.test.js` | Pure money-path helpers: status/phone normalization, SLA categories, CSV-injection safety, input validation |
| `schema-guard.test.js` | The Sheet Schema Guard (baseline capture, drift detection, observe vs. enforce) against the live functions |
| `contract.test.js` | API-contract envelopes (`okResult_`/`errResult_`/`parseResult_`) and observability metrics |

## Adding a test

Create `tests/<name>.test.js` exporting `(gas, t, mock) => { ... }`:

- `gas` — the loaded Code.gs context; call any top-level function as `gas.fnName(...)`.
- `t` — `t.test(name, fn)`, `t.eq`, `t.ok`, `t.throws`, `t.notThrows`.
- `mock` — `mock.addSheet(name, grid)`, `mock.MockSheet`, `mock.props`, `mock.cache`, `mock.setSessionEmail(email)`.

## Note on memoization

`assertTicketSheetSchema_` memoizes its verdict per request via a module-level
`let`. In a single long-lived Node context that does not auto-reset, so tests
call `blessTicketSheetSchema()` (which clears the memo) before asserting.
