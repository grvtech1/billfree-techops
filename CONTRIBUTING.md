# Contributing

## Setup

```bash
nvm use && npm install
npm test          # gas + shared + web must be green before you start
```

## Branch & commit

- Branch off `main`; open a PR. CI must pass (type-check, lint, tests, build).
- Conventional commit messages: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`.

## The golden rule: the contract is shared

Statuses, error codes, and API action names live in **`packages/shared`** and are
mirrored by the GAS backend. `packages/shared/src/contract.test.ts` reads
`apps/gas/src/Code.gs` and **fails CI if they drift**. Change one side → change both.

## How to add a new API action (end-to-end)

Example: a `getfoo` read endpoint.

1. **Contract** — add `'getfoo'` to `POST_ACTIONS` in `packages/shared/src/api.ts`.
2. **Backend** — in `apps/gas/src/Code.gs` `doPost`, add a route:
   ```js
   if (action === 'getfoo') {
     return spaJsonResponse_(parseResult_(getFoo(payload.token || '')));
   }
   ```
   Implement `getFoo` in the appropriate module (e.g. `Analytics.gs`). Return either
   an object or a JSON string — `parseResult_` normalizes both.
3. **Backend test** — add coverage in `apps/gas/tests/*.test.js` (the harness loads
   the whole bundle into mocked GAS). Run `npm run test --workspace apps/gas`.
4. **Client** — add a method to `api` in `apps/web/src/lib/api.ts`, plus a `resolveMock`
   case so dev/mock mode still works.
5. **Web test** — cover the new logic (`apps/web/src/**/*.test.ts`).

## Backend conventions (Apps Script)

- One concern per `.gs` module; keep `Code.gs` to routing + ticket core.
- Never hardcode a Sheet column number — use `CONFIG.COLS`.
- A top-level `const` that reads another file's value MUST be lazy (build it inside
  a memoized function) to avoid load-order errors. See `SchemaGuard.gs`.
- After moving code between modules, run `npm run test --workspace apps/gas` — a
  bad split fails the bundle load loudly.

## Frontend conventions

- Prefer pure functions in `lib/utils.ts` (they're unit-tested) over logic in
  components. The agent-scoring algorithm is covered by `utils.test.ts` — keep it so.
- Immutable state updates only (Zustand). No `console.log` in committed code.
- Run `npm run lint` and `npm run typecheck` before pushing.

## Secrets

Never commit `.env*` or `.clasp.json` (git-ignored). Real values go in local env
files and GitHub Actions secrets — see the README.
