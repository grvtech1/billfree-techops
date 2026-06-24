# DevOps Practice Playbook

This repo is a working playground for **real production DevOps**: branch hygiene,
protected `main`, a gated CI/CD pipeline, and multi-environment GitOps. Anyone can
clone it and practice the full loop — feature → PR → CI gate → merge → deploy → promote.

This doc is the map. The mechanics live next to the code:
- Pipeline: [`.github/workflows/`](../.github/workflows/)
- Multi-env model: [`deploy/envs/README.md`](../deploy/envs/README.md)
- Deploy architecture: [`DEPLOYMENT_ARCHITECTURE.md`](DEPLOYMENT_ARCHITECTURE.md)

---

## 1. Branching model — GitHub Flow

One long-lived branch (`main`, always deployable). Everything else is a **short-lived**
branch off `main`: branch → commit → PR → merge → delete.

| Prefix | For | Example |
|--------|-----|---------|
| `feature/` | new capability | `feature/calllog-csv-export` |
| `fix/` | bug fix | `fix/dashboard-kpi-count` |
| `chore/` | CI / deps / tooling | `chore/ci-devops-hardening` |
| `hotfix/` | prod emergency (branch off `main`, fast) | `hotfix/login-token-expiry` |
| `promote/` | move a tested image tag up an env | `promote/staging-ab12cd` |

**Rules**
- Always branch from an up-to-date `main` (`git checkout main && git pull`). Never branch
  off another feature branch.
- One PR = one concern (small, reviewable, revertable).
- Add a new workspace/package → run `npm install` and commit `package-lock.json` (or CI's
  `npm ci` fails).

---

## 2. Protected `main`

`main` is protected (GitHub branch protection). Enforced:

- ✅ **PR required** — no direct push to `main`.
- ✅ **Status check must pass**: `Type-check, lint, test, build` (the CI `quality` job).
  Add `Compose, Terraform, Helm validation` once it lands on `main` (see §6).
- ✅ **Branch up to date** before merge (strict) — click *Update branch* if behind.
- ✅ **Linear history** — squash/rebase merges; no merge bubbles.
- ✅ **No force-push, no deletion**.
- Required approvals: **0** (solo repo — flip to 1 when you add a collaborator).

> The real guardrail for a solo dev is the **status check**, not approvals: red CI can't
> reach `main`.

---

## 3. CI/CD pipeline — what gates what

```
push/PR ──► CI (.github/workflows/ci.yml)
              ├─ quality:           typecheck (all workspaces) · lint · test · build
              └─ devops-validation: docker compose config · terraform fmt+validate · helm lint+template
                          │ success on main
                          ▼
          Build & Deploy (.github/workflows/build-deploy.yml)   ← runs only after CI passes
              ├─ build + Trivy scan (HIGH/CRITICAL blocks) + push image :SHA to GHCR
              └─ bump image tag in deploy/ and commit  ──►  ArgoCD syncs the cluster
```

Key properties:
- **Deploy is gated on CI** (`workflow_run`) — a red commit never deploys.
- **Trivy `exit-code: 1`** — a fixable HIGH/CRITICAL CVE blocks the release.
- **Pull-based GitOps** — CI never touches the cluster; it writes desired state to git and
  ArgoCD pulls. The only path to any environment is a merged commit.

---

## 4. Multi-environment — dev / staging / prod

Environment-per-**folder** from one `main` (see [`deploy/envs/README.md`](../deploy/envs/README.md)).
Each env is an ArgoCD ApplicationSet rendering the shared chart with `base + env overlay`,
into namespace `billfree-<env>`.

**Promotion is a git change** (the image tag is the unit):
```bash
# dev auto-updates from CI. Promote a tested SHA up:
git checkout main && git pull
git checkout -b promote/staging-<sha>
#   edit deploy/envs/staging/values.yaml → image.tag: "<sha>"
git commit -am "promote: staging → <sha>"   # PR → review → merge → ArgoCD syncs staging
```

**New machine or git?** Both, on different axes: **git** owns config/promotion (folders);
**infra** owns runtime isolation (namespace → cluster). Free-tier: one cluster, three
namespaces + a `ResourceQuota` each. Real prod: give prod its **own cluster** (change one
line — the ApplicationSet `destination.server`).

---

## 5. Practice exercises

Do these in order — each teaches one production muscle.

1. **Feature → PR → gate.** Branch `feature/x`, make a trivial change, push, open a PR.
   Watch CI run; see merge blocked until green. Merge, then `git branch -d`.
2. **Break the gate on purpose.** In a branch, introduce a type error. Open a PR. Confirm
   CI fails and merge is blocked. Fix, watch it go green.
3. **Conflict drill.** Change the same line on two branches; rebase one onto `main`
   (`git rebase origin/main`), resolve, `--continue`.
4. **Promotion.** Change `deploy/envs/staging/values.yaml` image.tag via a `promote/` PR;
   observe it's a pure config diff (no app code).
5. **Trigger an alert (with a cluster).** Scale a service to 0 or load it past the HPA max;
   watch `TargetDown` / `HpaMaxedOut` fire (see [`deploy/charts/microservice/templates/prometheusrule.yaml`](../deploy/charts/microservice/templates/prometheusrule.yaml)).
6. **Dependency PR.** Let Dependabot open a grouped update PR; review the diff, let CI vet
   it, merge.

---

## 6. Known follow-ups

- **✅ GitOps writeback vs protected `main` (resolved).** The `build-deploy.yml` tag-bump
  pushes **directly to `main`**, which protection blocks for the default `GITHUB_TOKEN`.
  Fixed: the bump now pushes with **`GITOPS_TOKEN`** — a fine-grained admin PAT
  (`contents: write`) — which bypasses the PR/check requirement (`enforce_admins=false`)
  for the one `[skip ci]` rollout commit. **One manual step before live GitOps:** create a
  fine-grained PAT (Contents: read+write on this repo) and add it as the Actions secret
  `GITOPS_TOKEN`. Without it the push falls back to `GITHUB_TOKEN` and fails on protected
  `main` — a clear signal. *(No-PAT alternative: point ArgoCD at a separate unprotected
  `deploy` branch; `main` stays pure source.)*
- **✅ Second required check (done).** Both `Type-check, lint, test, build` and
  `Compose, Terraform, Helm validation` are required status checks on `main`.
- **Trivy → Security tab.** Emit SARIF and `upload-sarif` so findings show in GitHub Security.
- **Grafana secret.** `deploy/argocd/apps/monitoring.yaml` has a plaintext admin password —
  move it to a Secret / sealed-secret before any public exposure.
