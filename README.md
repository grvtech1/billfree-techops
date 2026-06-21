# BillFree TechOps

Internal tech-support ticketing + analytics platform for BillFree's POS-integration
support team — delivered as a **cloud-native, microservices DevOps showcase**: a
React SPA and Node/TypeScript services, containerized and deployed to a
**self-managed Kubernetes cluster** via Terraform + Helm + GitHub Actions + ArgoCD.

> The platform began as a React SPA + modular Google Apps Script backend (still
> present under `apps/`), then was re-platformed onto microservices. Both stories
> live in one monorepo; the cloud-native path below is the showcase.

## Cloud-native architecture

```
 GitHub Actions ──build · Trivy scan · push──▶ GHCR
        │ bump deploy/ image tags (commit)
        ▼
   Git (main) ◀── watch ── ArgoCD ── sync ──▶  self-managed kubeadm cluster (EC2, Terraform)
                                                 ns billfree:
   web (nginx) ─▶ api-gateway ─▶ auth-service          ingress-nginx (DaemonSet, hostPort)
                      │       └▶ ticket-service ─┐      Prometheus + Grafana (ServiceMonitors)
                      └─────────▶ analytics-svc ─┴▶ postgres (StatefulSet) · redis
```

Every request: `web → api-gateway (CORS, rate-limit, JWT) → service (re-verifies JWT)
→ Postgres`. Auth issues JWTs; the SPA, gateway, and services agree on statuses /
error codes / actions via `packages/shared`.

## Monorepo layout

| Path | What | Stack |
| --- | --- | --- |
| `services/api-gateway` | Edge: CORS, rate-limit, JWT, reverse-proxy | Fastify, http-proxy |
| `services/auth-service` | JWT issuer + RBAC directory | Fastify, jose |
| `services/ticket-service` | Ticket CRUD | Fastify, zod, Postgres |
| `services/analytics-service` | Read-only analytics | Fastify, Postgres |
| `packages/service-common` | Shared service lib (config, logging, errors, db, JWT, metrics, health) | TypeScript |
| `packages/shared` | Cross-cutting contract (statuses, error codes, API actions) | TypeScript |
| `apps/web` | React SPA dashboard (Nginx container) | React 18, Vite, Zustand, Recharts |
| `db/` | Transactional, tracked SQL migrations + runner image | Node, pg |
| `infra/terraform` | Self-managed kubeadm cluster on EC2 (cloud-init, Calico) | Terraform |
| `deploy/charts/microservice` | Reusable Helm chart (Deployment/Service/HPA/PDB/ServiceMonitor/Ingress) | Helm |
| `deploy/apps`, `deploy/platform` | Per-service Helm values; in-cluster Postgres/Redis/migrate | YAML |
| `deploy/argocd` | App-of-apps GitOps root + Applications + addons | ArgoCD |
| `.github/workflows` | CI (test matrix) + Build/Deploy (GHCR + GitOps bump) | GitHub Actions |
| `apps/gas` | Original modular Google Apps Script backend (legacy/reference) | Apps Script |

## Quickstart (local, no cloud)

```bash
nvm use && npm install
npm test                      # 99 tests across all workspaces

docker compose up --build     # full stack: postgres + 4 services + web
# web → http://localhost:3000   gateway → http://localhost:8080
curl -s localhost:8080/auth/token -H 'content-type: application/json' \
  -d '{"email":"agent1@billfree.in"}'        # → { token }
```

## Deploy to the self-managed cluster

`terraform apply` → bootstrap ArgoCD → `kubectl apply deploy/argocd/root.yaml`.
Full runbook: **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

## Quality gates

- **CI** (`.github/workflows/ci.yml`): shared contract → GAS tests → service-common
  + 4 services type-check/test → web type-check/lint/test/build.
- **Build & Deploy** (`build-deploy.yml`): per-service Docker build + Trivy scan +
  push to GHCR, then commit the new image tags so **ArgoCD** rolls them out
  (pull-based GitOps — CI never touches the cluster).
- Containers: multi-stage, non-root, hardened `securityContext`, HPA + PDB + probes.

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system design (both architectures)
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — cloud-native deploy runbook
- [services/README.md](services/README.md) · [apps/web/README.md](apps/web/README.md) · [apps/gas/README.md](apps/gas/README.md) · [packages/shared/README.md](packages/shared/README.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)
