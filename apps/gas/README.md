# @billfree/gas-backend  ·  _legacy origin (being strangled)_

> **Status: migration source, not the long-term target.** This is the original
> production system — a modular Google Apps Script app exposing a JSON API
> (`doGet`/`doPost`) over a Google Sheet ("IT Tracker 26"). It is being
> re-platformed onto the cloud-native microservices in [`../../services`](../../services)
> using the **strangler-fig pattern**: the new system grows around this one, the
> SPA switches between them with a single build flag (`VITE_BACKEND`), and GAS is
> retired only **after** the microservices are deployed and proven against real data.
>
> It stays in the repo for three reasons: (1) it is still the only backend that is
> actually deployed today; (2) it holds the live Google-Sheets data not yet migrated
> to Postgres; (3) it is the **"before"** in the migration story this project showcases.
> A frontend↔backend contract test ([`packages/shared`](../../packages/shared)) keeps
> the two from drifting while both exist.
>
> **Parity status** — ported to microservices: tickets · analytics · call log ·
> update-history (audit). Still GAS-only: monthly reports (in progress).
>
> Retirement = when `VITE_BACKEND=gateway` has zero stubs, data is migrated, and the
> cluster is live. At that point this directory becomes archived reference, not runtime.

## Modules (`src/`)

| File | Responsibility |
| --- | --- |
| `Code.gs` | Router (`doGet`/`doPost`), ticket CRUD core, dashboard, audit log, system health, enums |
| `Auth.gs` | Identity, server/CSRF tokens, roles, permissions, Google/API verification, rate limiting |
| `CallLog.gs` | Call logging, telephony CDR ingest, webhook validation, dedup |
| `Analytics.gs` | Top MIDs/POS, repeat-customer, concern trends, agent matrix |
| `Reports.gs` | Monthly reports, AI (Gemini) narrative, report emails/CSVs |
| `PortalApi.gs` | Public portal + external ticket API, auto-assign, dedup |
| `TicketCache.gs` | Ticket index, chunked Sheet cache, version counter |
| `Validation.gs` | Input sanitization + schema-driven field validation |
| `SchemaGuard.gs` | **Sheet column-layout integrity guard** (see below) |
| `Platform.gs` | Response envelopes (`okResult_`/`parseResult_`) + metrics |
| `Csv.gs` | CSV encoding + formula-injection guard |

> In Apps Script every `.gs` file shares ONE global namespace (files are
> concatenated at load), so cross-file calls work without imports. Top-level
> `const`s that read another file's value are made lazy to avoid load-order
> (temporal-dead-zone) errors — see `SchemaGuard.gs` / `Validation.gs`.

## Tests

A pure-Node harness loads all `.gs` files into a mocked GAS environment and runs
them — no Google account, no network, no deploy.

```bash
npm test            # → node tests/run.js
```

Covers money-path helpers (status/phone normalization, SLA, CSV-injection,
validation), the schema guard, and the API-contract helpers. See `tests/README.md`.

## Schema guard — one-time setup

The Sheet is hand-editable, so a moved/inserted column would silently corrupt
writes. After deploying, run in the Apps Script editor:

1. `auditTicketSheetHeaders()` — print live headers vs expected positions
2. `blessTicketSheetSchema()` — snapshot the correct layout as the baseline
3. Set feature flag `ENFORCE_SHEET_SCHEMA = true` to block writes on drift
   (default is observe/log-only, so it can never break a working deployment first)

## Deploy (clasp)

```bash
npm exec clasp login              # once
cp .clasp.json.example .clasp.json  # set scriptId
npm run push                      # clasp push (rootDir = src/)
npm run logs                      # tail execution logs
```

`src/appsscript.json` declares the V8 runtime, timezone (Asia/Kolkata), web-app
access, and OAuth scopes. After `push`, create/redeploy the web-app deployment in
the Apps Script UI to get the public URL (that URL → `VITE_GAS_URL`).

## Module extraction tool

`tools/extract-module.js` moves a named set of top-level declarations out of
`Code.gs` into a new module (brace-bounded, comment-safe, drift-checked). Used to
build the modules above; `npm test` is the safety net after any extraction.
