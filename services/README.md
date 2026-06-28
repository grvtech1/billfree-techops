# Microservices

Node 20 + TypeScript + Fastify services that re-platform the BillFree backend off
Google Apps Script onto containers. They share `@billfree/service-common`
(config, logging, error model, Postgres pool, JWT auth, Prometheus metrics, K8s
health probes) and the `@billfree/shared` contract.

| Service | Port | Responsibility | Data |
| --- | --- | --- | --- |
| `api-gateway` | 8080 | Edge: CORS, rate-limit, JWT enforcement (Bearer **or** httpOnly cookie), reverse-proxy to services | — |
| `auth-service` | 8080 | Issues + verifies JWTs (RBAC roles); delivers token as httpOnly `bt_token` cookie — never in response body | directory |
| `ticket-service` | 8080 | Ticket CRUD (list/get/create/update) | Postgres |
| `analytics-service` | 8080 | Read-only analytics (status, top-POS, leaderboard) | Postgres (read) |
| `calllog-service` | 8080 | Call/CDR event log (list + write, role-scoped) | Postgres |
| `report-service` | 8080 | Monthly operations report (computed from tickets) | Postgres (read) |

The ticket audit trail (per-ticket update history) lives **inside** `ticket-service`
(`audit_log` table) so a ticket write and its audit row stay together.

**External-channel intake** (WhatsApp chatbot) is exposed by `ticket-service` under
`/intake/*` and proxied publicly as `/api/intake/*`. It authenticates with an **API
key** (`x-api-key`), not a user JWT — see [../docs/WHATSAPP_INTAKE.md](../docs/WHATSAPP_INTAKE.md).
Tickets are created `Not Completed`, tagged `source = whatsapp`, and **auto-assigned**
to the least-loaded active agent (`agents` table). Customers poll status by ticket
reference **+ matching phone** (no existence leak).

Each service is independently:
- **built** to a single bundled `dist/index.js` (`tsup`, workspace deps inlined),
- **containerized** (multi-stage Dockerfile, distroless-ish `node:20-slim`, non-root),
- **tested** with `vitest` via Fastify's `app.inject()` against an in-memory fake
  repository — no DB needed (`npm run test --workspace services/<name>`),
- **observable** — `/healthz` (liveness), `/readyz` (readiness, checks the DB),
  `/metrics` (Prometheus RED histogram).

## Design notes

- **Dependency injection** — `buildServer(deps)` takes the repository + JWT config,
  so the HTTP surface is fully unit-testable and the storage engine is swappable.
- **Repository pattern** — handlers depend on a `TicketRepository` /
  `AnalyticsRepository` / `CallEventRepository` interface; `Pg*Repository` is the
  Postgres implementation.
- **Authorization scoping** — `calllog-service` pins non-manager roles to their own
  events (list + write), porting the legacy GAS row-level rule into SQL.
- **Shared error envelope** — every error leaves as `{ success, error: "[E0NN] …" }`,
  the same shape (and codes) the React SPA already parses via `@billfree/shared`.
- **Defense in depth** — the gateway authenticates at the edge AND each service
  re-verifies the JWT. `extractToken(req)` in `service-common` reads
  `Authorization: Bearer` first, then falls back to the raw `Cookie` header
  (`bt_token`) — so both browser (cookie) and API-client (Bearer) paths work.
- **Fastify 5 logger compat** — `buildServer(deps)` detects whether `deps.logger`
  is a pre-created pino instance (object) or a boolean/undefined, and routes to
  `loggerInstance:` or `logger:` accordingly. Fastify 5 changed the API: passing a
  pino instance to `logger:` throws `FST_ERR_LOG_INVALID_LOGGER_CONFIG`.

## Local

```bash
npm run dev --workspace services/ticket-service   # tsx watch
# or the whole stack:
docker compose up --build
```

Deploy: see [../docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md).
