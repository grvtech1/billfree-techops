# @billfree/web

The BillFree TechOps dashboard — a React 18 + TypeScript SPA built with Vite,
hosted on Cloudflare Pages.

## Scripts

```bash
npm run dev          # vite dev server (http://localhost:5173)
npm run build        # tsc + vite build → dist/
npm run preview      # serve the production build
npm run typecheck    # tsc --noEmit
npm run lint         # eslint (flat config)
npm run test         # vitest run
npm run test:watch   # vitest watch
npm run test:coverage
```

## Structure (`src/`)

| Path | What |
| --- | --- |
| `views/` | One component per screen: Dashboard, MasterDb, Analytics, CallLog, History, MonthlyReport, TeamReport |
| `components/` | `common/` (KpiCard, Modal, Toast, ErrorBoundary…), `tickets/`, `filters/`, `layout/` |
| `store/` | Zustand stores — `ticketStore` (data + filters + KPIs), `uiStore` (view, theme, toasts, modals) |
| `hooks/` | `useTickets`, `useCSRF`, `useVersionPoll`, `useBroadcastSync` (cross-tab) |
| `lib/` | `api.ts` (typed client + mock mode), `auth.ts` (Google identity bridge), `utils.ts` (normalisation, scoring) |
| `types/` | App-local TypeScript interfaces |
| `index.css` | Single global stylesheet (design tokens + dark mode) |

Shared contract (statuses, error codes, API actions) comes from
[`@billfree/shared`](../../packages/shared).

## Data flow

```
GAS Sheets → api.getTicketData → useTickets → ticketStore.setRawData
  → normaliseTicket → applyFilters → dateData / displayData → views (read)
views (write) → useCSRF.withCSRF → api.updateFull/createTicket
  → optimisticUpdate → re-fetch → broadcast(version) → other tabs re-sync
polling: useVersionPoll (GET ?action=version) → if newer → re-fetch
```

## Backend selection (`VITE_BACKEND`)

The SPA targets either backend, chosen at build time — the hooks/store/views are
unaware of which is active (selected in `lib/api.ts`):

| `VITE_BACKEND` | Data source | Auth | Client |
| --- | --- | --- | --- |
| `gateway` (container default) | Microservices API gateway (REST/JWT) | `/auth/token` → JWT, demo `LoginScreen` | `lib/gateway.ts` |
| `gas` | Google Apps Script (or mock if `VITE_GAS_URL` empty) | Cloudflare postMessage bridge | `lib/api.ts` |

In **gateway** mode, `lib/gateway.ts` calls `/api/tickets`, `/api/analytics`,
`/api/calls`, `/api/tickets/:id/history` and `/api/reports/monthly` with a Bearer
JWT and adapts the responses into the store's shapes (`RawTicket`, `CallEvent`,
`AuditLogResponse`, `MonthlyReport`); CSRF is a no-op (JWT replaces it); version
polling is benign. Set `VITE_GATEWAY_URL` for `npm run dev`
(e.g. `http://localhost:8080`); in the container it stays empty and nginx proxies
`/api` + `/auth` to the gateway.

> **Full parity:** tickets, analytics, call log, per-ticket audit history and
> monthly reports are all served by microservices in gateway mode — no feature
> stubs remain. (Server-side CSV export stays client-side by design.)

## Mock mode

With `VITE_BACKEND=gas` and **no `VITE_GAS_URL`**, `api.ts` serves built-in demo
tickets and `auth.ts` grants a demo session — develop the whole UI offline.

## Auth

In production the SPA runs inside a Cloudflare Pages wrapper that performs Google
OAuth and `postMessage`s `BT_AUTH_SYNC` (origin-checked) into the app, which then
verifies identity against the GAS `?action=identity` endpoint. See `src/lib/auth.ts`.

## Deploy

Auto-deploys to Cloudflare Pages on push to `main` via `.github/workflows/deploy.yml`
(`apps/web/dist`). `public/_headers` sets CSP/security headers; `public/_redirects`
provides SPA fallback routing.
