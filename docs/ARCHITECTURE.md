# Architecture

> This document covers **two** architectures in the repo:
> 1. **Cloud-native microservices** (the DevOps showcase) — see the section at the bottom.
> 2. The original **React SPA + Google Apps Script** design — everything in between.

## Overview

BillFree TechOps is a **decoupled SPA + API** system:

- **Frontend** (`apps/web`): a static React SPA on Cloudflare Pages. No server
  rendering; all data comes from the API via `fetch`.
- **Backend** (`apps/gas`): a Google Apps Script web app. `doGet` serves identity
  and version; `doPost` is a JSON action router. The data store is a Google Sheet.
- **Contract** (`packages/shared`): the statuses, error codes, and action names
  both halves must agree on — enforced by a drift test that reads the backend.

This keeps the lowest-risk path: the auth, locking, audit, and analytics logic
already battle-tested in Apps Script stays put, while the UI modernizes independently.

## Request model

| Direction | Mechanism |
| --- | --- |
| Reads/writes | `POST` to the GAS web-app URL, body = `text/plain` JSON `{ action, ...params }` (GAS parses `e.postData.contents`) |
| Identity / version | `GET ?action=identity` / `?action=version` |
| Responses | `{ success, data?, error?, meta? }` — normalized by `parseResult_` (Platform.gs) |
| Errors | message carries an `[E0NN]` code; client maps it via `@billfree/shared` |

## Auth & authorization

1. A Cloudflare Pages wrapper performs Google OAuth and `postMessage`s a signed
   identity (`BT_AUTH_SYNC`) into the SPA iframe (origin-allowlisted in `auth.ts`).
2. The SPA calls `?action=identity`; the backend verifies the Google token, then
   issues a short-lived HMAC **server token**.
3. Mutations carry the server token + a **CSRF token** + are **rate-limited** and
   **role-gated** (`requirePermission`), then run under a `LockService` lock.
4. External callers (WhatsApp bot) use API keys; the telephony webhook uses a
   shared secret with constant-time comparison.

## Data model (Google Sheet, cols A–O)

`TicketID, CreatedAt, AgentEmail, ITEmail, RequestedBy, MID, Business, POS,
SupportType, Concern, ConfigNotes, Remark, Status, Reason(append-only log), Phone`
plus `Audit Log` and `Call Log` tabs. Column positions are the single source of
truth in `CONFIG.COLS`; **`SchemaGuard.gs`** validates the live layout against a
blessed baseline before any positional read/write.

## Frontend data flow

`ticketStore` holds `rawData`; a pure filter cascade derives `dateData` →
`displayData` → `kpi`. Writes are **optimistic** (instant UI, rollback snapshot),
then re-fetch + `BroadcastChannel` notify other tabs; `useVersionPoll` catches
out-of-band changes via the version counter.

## Concurrency & limits (NFRs)

- Writes serialize through `LockService` — design for ≤ ~5 concurrent writers.
- Reads scale via `TicketCache` (chunked ScriptCache) + a request-scoped memo.
- Realistic targets: p95 cached read ≤ 1.2 s, p95 mutation ≤ 2.5 s, 99.5% effective
  uptime. The real availability risk is GAS daily quotas, not Google downtime.
- Frontend: WCAG 2.1 AA target; CSP + security headers via `public/_headers`.

## Frontend migration & cutover (Index.html → React SPA)

The React SPA (`apps/web`) **replaces** the legacy `apps/gas/src/Index.html`
monolith (all seven views reimplemented). During migration both run in parallel:

- **React SPA** — Cloudflare Pages, talks to the GAS JSON API. The primary frontend.
- **Legacy `Index.html`** — still served by GAS `doGet` at the bare exec URL, kept
  as the rollback target.

`doGet` has a **reversible cutover switch** (feature flag `FRONTEND_MODE`):

| `FRONTEND_MODE` | Behavior at the GAS root URL |
| --- | --- |
| `legacy` (default) | Serves the `Index.html` monolith (unchanged) |
| `spa` | Redirects to the React SPA (`SPA_URL` script property), forwarding identity |

**Cutover procedure** (no redeploy needed to flip or roll back):

1. Deploy the SPA to Cloudflare Pages; set the GAS `SPA_URL` script property to it.
2. Smoke-test the SPA against production data.
3. Set feature flag `FRONTEND_MODE = 'spa'` → legacy bookmarks now redirect to the SPA.
4. Monitor. Any problem → set `FRONTEND_MODE = 'legacy'` for instant rollback.
5. Once confident (a few weeks), delete `Index.html` and the monolith's `doGet`
   HTML-serving branch — this is the only step that removes the rollback path.

## Known constraints / roadmap

- **Datastore**: Google Sheets caps write concurrency and makes analytics scan-based.
  The repository seam (`TicketCache`, `SheetRepo`) is structured so the backend could
  later swap to a real database behind the same API without touching the SPA.
- **HistoryView** reconstructs entries from current ticket state; the real
  `getUpdateHistory` audit endpoint exists and powers the per-ticket drill-down.
- **gas-services draft** (`apps/web/_archive/`) was an alternate clean-backend
  sketch; the modular `Code.gs` is the backend of record and is not replaced by it.

---

# Cloud-native microservices (DevOps showcase)

The backend was re-platformed off Google Apps Script onto containerized Node/TS
services on a **self-managed Kubernetes** cluster — demonstrating the full DevOps
lifecycle (IaC → containers → orchestration → GitOps → observability).

## Services & boundaries

| Service | Responsibility | State |
| --- | --- | --- |
| `api-gateway` | Single entry: CORS, edge rate-limit, JWT auth, reverse-proxy | stateless |
| `auth-service` | Issue/verify JWTs, RBAC roles | directory |
| `ticket-service` | Ticket CRUD | Postgres (owner) |
| `analytics-service` | Status/POS/leaderboard analytics | Postgres (read) |

All share `@billfree/service-common` (config, pino logging, error model, pg pool,
JWT, Prometheus metrics, K8s probes) and the `@billfree/shared` contract. Each is
DI-built (`buildServer(deps)`) so the HTTP surface is unit-tested with no DB.

## Request & trust flow

`web (nginx) → api-gateway → service → Postgres`. The gateway authenticates at the
edge; **each service re-verifies the JWT** (defense in depth). Errors carry an
`[E0NN]` code the SPA already understands.

## Infrastructure (self-managed, not EKS)

- **Terraform** (`infra/terraform`) provisions a VPC + EC2 nodes and bootstraps a
  **kubeadm** cluster via cloud-init (`containerd` runtime, **Calico** CNI,
  shared bootstrap token). You own the control plane — no managed K8s.
- **Registry**: GitHub Container Registry (GHCR), not a managed cloud registry.
- **Data**: Postgres (StatefulSet + PVC) and Redis run **in-cluster**.
- **Ingress**: ingress-nginx as a DaemonSet binding hostPort 80/443 (no cloud LB).

## Delivery (GitOps)

- **CI** runs the test matrix on every push/PR.
- **Build & Deploy** builds + Trivy-scans + pushes each image to GHCR (tagged by
  commit SHA), then **commits the new tags into `deploy/`**.
- **ArgoCD** (app-of-apps) watches the repo and reconciles the cluster — CI never
  runs `kubectl`. Rollback = `git revert`.

## Reliability & observability

- Rolling updates (`maxUnavailable: 0`), HPA (CPU), PodDisruptionBudgets,
  liveness/readiness probes, graceful `SIGTERM` shutdown (drains + closes the pool).
- Prometheus (kube-prometheus-stack) scrapes each service's `/metrics`
  (RED histogram) via a ServiceMonitor; Grafana for dashboards.
- DB migrations run as an idempotent, transactional ArgoCD **PreSync Job**.

## What stays the same

The `packages/shared` contract is the seam: the React SPA, the legacy GAS backend,
and the new services all honor the same statuses/error-codes/actions — which is
what made re-platforming the backend possible without rewriting the frontend.
