# Deployment Architecture & Flow

How BillFree TechOps goes from a developer's commit to running pods on a
**self-managed Kubernetes cluster on AWS** — and how it was actually deployed
(including the real failures hit along the way, across two full cluster
provision-and-teardown cycles).

The system is delivered across **three planes connected only by Git**. No human
and no CI job ever runs `kubectl` against the cluster — the single path into
production is a commit to `main`. This is pull-based GitOps.

---

## 0. At a glance — three planes

```mermaid
flowchart LR
  subgraph DEV["DEVELOP"]
    D1["npm workspaces<br/>web · 6 services · shared libs"]
  end
  subgraph DEL["DELIVER · GitOps"]
    G1["GitHub main"]
    G2["Actions<br/>test → build → scan"]
    G3["GHCR images"]
    G4["tag-bump commit<br/>deploy/apps/*"]
  end
  subgraph RUN["RUN"]
    R1["ArgoCD"]
    R2["kubeadm cluster · EC2"]
  end
  D1 -->|git push| G1 --> G2 --> G3
  G2 --> G4 --> G1
  G1 -. watch .-> R1 -->|sync| R2
  G3 -. imagePull .-> R2
```

| Plane | Owns | Tooling |
| --- | --- | --- |
| **Develop** | source, tests, contracts | npm workspaces, Vitest, tsup, Vite |
| **Deliver** | images + desired-state in Git | GitHub Actions, Trivy, GHCR |
| **Run** | reconcile Git → cluster | ArgoCD, Helm, Kubernetes |

The planes never call each other directly. Delivery writes images to a registry
and a desired image-tag to Git; Run watches Git. That seam is what makes rollbacks
a `git revert` and keeps CI credentials out of the cluster.

---

## 1. Delivery pipeline — commit to image to desired-state

```mermaid
flowchart TD
  push["git push → main"] --> ci["ci.yml<br/>156 tests · typecheck · lint · build"]
  push --> bd["build-deploy.yml"]
  bd --> matrix["matrix build: 8 images<br/>web · 6 services · db-migrate"]
  matrix --> trivy["Trivy scan (CRITICAL/HIGH)"]
  trivy --> ghcr[("GHCR<br/>ghcr.io/grvtech1/billfree-techops/*<br/>:SHA + :latest")]
  matrix --> bump["bump-gitops job<br/>sed image tags in deploy/apps/*<br/>commit 'ci: roll out SHA [skip ci]'"]
  bump --> main[("Git main")]
  main -. ArgoCD watch .-> argo["ArgoCD app-of-apps"]
```

- **Every push to `main`** triggers both workflows. `ci.yml` gates correctness;
  `build-deploy.yml` builds, scans, pushes, then **commits the new image tags back
  to `main`** (`deploy/apps/<svc>/values.yaml`).
- The bump commit carries **`[skip ci]`** so it never re-triggers itself (no loop).
- Images are tagged with the **commit SHA** (immutable) — so a given Git state maps
  to exactly one set of images. Rollback = revert the bump commit.

---

## 2. Infrastructure — self-managed Kubernetes (kubeadm, **not** EKS)

```mermaid
flowchart LR
  tf["terraform apply"] --> net["VPC · public subnet · IGW<br/>Security Group (locked to your IP)"]
  tf --> ec2["3× EC2 (free-tier-eligible)<br/>1 control-plane + 2 workers"]
  ec2 --> cinit["cloud-init"]
  cinit --> cp["control-plane:<br/>containerd · kubeadm init<br/>· Calico CNI · join token"]
  cinit --> wk["workers:<br/>containerd · kubeadm join"]
  cp --> rdy["nodes Ready"]
  wk --> rdy
```

Terraform stands up the raw cloud (VPC, EC2, firewall, SSH key) and hands each node
a **cloud-init** script that bootstraps the Kubernetes control plane / workers with
`kubeadm` + Calico. The result is a vanilla, fully self-managed cluster — you own
etcd, the API server, the upgrade path, everything. 14 resources total.

---

## 3. Runtime topology & request flow

```mermaid
flowchart TD
  user(["Browser"]) -->|http :80| ing["ingress-nginx<br/>DaemonSet on workers"]
  ing -->|"Host: billfree.example"| web["web · React SPA (nginx)"]
  web -->|"proxy /api /auth"| gw["api-gateway :8080<br/>CORS · rate-limit · JWT edge-auth"]
  gw --> auth["auth-service"]
  gw --> tk["ticket-service<br/>+ audit + WhatsApp intake"]
  gw --> an["analytics-service"]
  gw --> cl["calllog-service"]
  gw --> rp["report-service"]
  tk --> pg[("Postgres<br/>StatefulSet + PVC")]
  an --> pg
  cl --> pg
  rp --> pg
  bot(["WhatsApp bot"]) -->|"x-api-key"| ing -->|"/api/intake"| gw
  prom["Prometheus"] -. "scrape /metrics" .-> gw
  prom -.-> graf["Grafana"]
```

- **One ingress, host-routed.** The SPA's own nginx proxies `/api` + `/auth` to the
  gateway in-cluster, so the browser only needs the web host.
- **Defense in depth:** the gateway authenticates the JWT at the edge **and** each
  service re-verifies it. The public WhatsApp intake path uses an **API key** (not a
  user JWT) on a separate route.
- **Stateful core:** a single Postgres StatefulSet backs all data services; a
  `local-path` provisioner satisfies its PVC (a bare kubeadm cluster has no default
  StorageClass — see field notes).

---

## 4. First-deploy bootstrap sequence

```mermaid
sequenceDiagram
  participant Op as Operator
  participant TF as Terraform
  participant K8s as Cluster
  participant Argo as ArgoCD
  participant Git as Git + GHCR

  Op->>TF: terraform apply
  TF->>K8s: 3 EC2 + kubeadm + Calico
  Op->>K8s: fetch kubeconfig, verify nodes Ready
  Op->>K8s: install local-path StorageClass
  Op->>K8s: create billfree-app-secrets (out-of-band)
  Op->>K8s: install ArgoCD
  Op->>Argo: kubectl apply root.yaml (app-of-apps)
  Argo->>Git: read deploy/ (manifests + image tags)
  Argo->>K8s: sync platform → Postgres + Redis
  K8s-->>Argo: Postgres healthy
  Argo->>K8s: PostSync hook → db-migrate → schema + seed
  Git-->>K8s: pull service images from GHCR
  Argo->>K8s: sync 6 services + web + ingress + monitoring
  K8s-->>Op: all 11 ArgoCD apps Synced/Healthy
```

The only manual steps are the **bootstrap** ones (provision, kubeconfig, the
out-of-band secret, install ArgoCD, apply the root app). Everything after
`root.yaml` is reconciled by ArgoCD from Git — including ordering: the **PostSync
migrate hook** runs only after Postgres is healthy, so the schema is always applied
before the services that depend on it.

---

## 5. Field notes — what actually broke (and the fix)

Real issues hit across two full provision-and-teardown cycles. These are the
difference between a diagram and a running system.

### Deploy 1 — initial cluster build

| # | Symptom | Root cause | Fix |
| --- | --- | --- | --- |
| 1 | CI "startup failure", `(Unnamed workflow)` | `aquasecurity/trivy-action@0.24.0` — version doesn't exist; GitHub resolves all `uses:` at startup | pin to `@master` |
| 2 | `RunInstances … not eligible for Free Tier` | account restricted to free-tier instance types | switch to free-tier-eligible `c7i-flex.large` / `m7i-flex.large` |
| 3 | SSH to nodes times out | `checkip` reported a different IP than the real egress (CGNAT) | open SG to real IP / widen temporarily |
| 4 | `kubectl` TLS error: cert valid for `10.x`, not public IP | kubeadm apiserver cert SAN excludes the public IP | pass `--apiserver-cert-extra-sans=<public-ip>` to `kubeadm init` in cloud-init |
| 5 | Postgres PVC `Pending` forever | bare kubeadm has **no default StorageClass** | install Rancher `local-path-provisioner` v0.0.30, mark default |
| 6 | All pg-using services `CrashLoopBackOff`: `Dynamic require of "events" not supported` | tsup bundled CommonJS `pg` into ESM; its `require()` fails at runtime (tests never run the bundled artifact) | add `createRequire` banner to tsup configs |
| 7 | `web` crash: `mkdir /var/cache/nginx … denied` | chart's non-root securityContext merged `runAsUser:1000`; stock nginx can't write cache | `runAsUser: 0` for web |
| 8 | `platform` stuck, Postgres never deploys | migrate was a **PreSync** hook needing Postgres from the same app → deadlock | change hook to **PostSync** |
| 9 | Dashboard login hangs at "Signing in…" | web nginx proxies `api-gateway:8080`, but the K8s Service exposed `:80` | set gateway Service port to `8080` |

Bugs 6–9 were fixed in code and rolled out **through the same GitOps pipeline**
(commit → CI → ArgoCD), proving the loop end-to-end rather than hand-patching pods.

### Deploy 2 — cluster rebuild after teardown

| # | Symptom | Root cause | Fix |
| --- | --- | --- | --- |
| 10 | `terraform apply` fails: `ssh_allowed_cidr` "must not be world-open" | `variables.tf` has a custom `validation` block that rejects `0.0.0.0/0` on security grounds | Fetch real egress IP (`curl -s https://checkip.amazonaws.com`) and set it as `/32` in `terraform.tfvars` |
| 11 | `kubectl apply -n argocd -f install.yaml` fails: "Too long: must have at most 262144 bytes" on `ApplicationSet` CRD | ArgoCD CRDs carry large schemas; client-side apply stores the full manifest as a `last-applied` annotation, which has a hard 256 KiB limit per resource | `kubectl apply -n argocd --server-side --force-conflicts -f install.yaml` — server-side apply stores ownership metadata only, not the full manifest |
| 12 | All 6 service pods `CrashLoopBackOff`: `FST_ERR_LOG_INVALID_LOGGER_CONFIG` | **Fastify 5** changed the server-options API: pre-created pino `Logger` instances must go to `loggerInstance:`, not `logger:` (which now accepts only `boolean` or a pino options object). Tests passed because they pass `false`; production passes a real logger instance | Detect at runtime in every `buildServer()`: `typeof deps.logger === 'object'` → `{ loggerInstance: deps.logger }`, else → `{ logger: deps.logger ?? false }` |
| 13 | `kubectl patch storageclass local-path -p '{...}'` fails in PowerShell: `invalid character 'm' looking for beginning of value` | PowerShell parses `'{}'` single-quoted strings; the JSON payload is mangled before it reaches kubectl on Windows | Write the JSON patch to a temp file with `[System.IO.File]::WriteAllText()` and use `kubectl patch --patch-file <tmp>` |

The `bootstrap-cluster.sh` script in `scripts/` encodes all lessons from both deploys:
it installs the storage provisioner before ArgoCD, uses `--server-side` for the
ArgoCD CRD install, and is idempotent so it is safe to re-run after any partial failure.

---

## 6. Teardown

```bash
cd infra/terraform
terraform destroy -auto-approve   # removes all 14 resources, stops billing
```

GitOps state (Git, GHCR images) survives teardown — a fresh `terraform apply` +
the bootstrap sequence reproduces the identical running system from `main`.

---

## See also
- [DEPLOYMENT.md](DEPLOYMENT.md) — the step-by-step runbook
- [ARCHITECTURE.md](ARCHITECTURE.md) — application/system architecture
- [../services/README.md](../services/README.md) — the microservices
- [WHATSAPP_INTAKE.md](WHATSAPP_INTAKE.md) — the external chatbot API
