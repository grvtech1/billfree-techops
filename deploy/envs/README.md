# Multi-environment GitOps (`deploy/envs/`)

Three environments — **dev · staging · prod** — from **one `main` branch**, using
**environment-per-folder** (the modern GitOps pattern), **not** environment-per-branch.

```
deploy/
├── charts/microservice/      one reusable chart (all services share it)
├── apps/<service>/values.yaml  per-service BASE values (identity: name, image repo, env)
└── envs/
    ├── dev/      values.yaml + applicationset.yaml  → namespace billfree-dev
    ├── staging/  values.yaml + applicationset.yaml  → namespace billfree-staging
    └── prod/     values.yaml + applicationset.yaml  → namespace billfree-prod
```

Each env is an **ApplicationSet** that generates one ArgoCD `Application` per service.
Every generated app renders the shared chart with **two value files, last wins**:

```
deploy/apps/<service>/values.yaml   ← base: who the service IS (name, image repo, env vars)
deploy/envs/<env>/values.yaml       ← overlay: how this ENV runs it (scale, resources, tag)
```

## Why folders, not branches

A long-lived `develop`/`staging`/`prod` branch per env is an anti-pattern: config
drifts between branches, you can't see all envs side-by-side, and "promotion" becomes
a merge that tangles app code with env config. With folders, **all three envs live in
`main`**, fully diffable, and promotion is a one-line value change in a reviewed PR.

## What differs per environment

| | dev | staging | prod |
|---|---|---|---|
| namespace | `billfree-dev` | `billfree-staging` | `billfree-prod` |
| replicas | 1 | 2 | 3 |
| autoscaling (HPA) | off | 2–4 | 3–8 |
| PodDisruptionBudget | off | on | on (minAvailable 2) |
| alert rules | off | on | on |
| image tag source | CI (newest) | promoted from dev | promoted from staging |

Per-service identity (name, image **repository**, env vars, ingress host) never changes
between envs — that stays in the base file. Only env-wide knobs live in the overlay.

## The image tag is the promotion unit

One tag per environment moves the **whole release together**. Promotion is a git change:

```bash
# 1. dev auto-updates from CI (newest build).
# 2. Promote a tested build dev → staging:
#    edit deploy/envs/staging/values.yaml → image.tag: "<the SHA you tested in dev>"
git checkout -b promote/staging-<sha>
git commit -am "promote: staging → <sha>"   # open PR, review, merge
# 3. After staging soak, promote staging → prod the same way:
git checkout -b promote/prod-<sha>
git commit -am "promote: prod → <sha>"        # open PR, review, merge
```

ArgoCD watches `main`, sees the changed desired state, and syncs that env. No `kubectl`
to a cluster — **the only path to any environment is a merged commit**.

## Bootstrap an environment (once per env)

```bash
kubectl apply -f deploy/envs/dev/applicationset.yaml       # → billfree-dev
kubectl apply -f deploy/envs/staging/applicationset.yaml   # → billfree-staging
kubectl apply -f deploy/envs/prod/applicationset.yaml      # → billfree-prod
```

The platform layer (Postgres/Redis, secrets) is per-namespace — apply
`deploy/platform/` and your `billfree-app-secrets` into each `billfree-<env>` namespace
before the apps sync. Use a **ResourceQuota** per namespace to keep dev/staging from
starving prod on a shared cluster.

## One cluster or many?

- **Free-tier / learning:** one cluster, three **namespaces** (this scaffold). Add a
  `ResourceQuota` per namespace for isolation. Teaches the full multi-env GitOps story
  without paying for three clusters.
- **Real production:** give **prod its own cluster** (blast radius, RBAC, noisy-neighbor,
  independent scaling). Then prod's ApplicationSet `destination.server` points at that
  cluster instead of `https://kubernetes.default.svc` — the only line that changes.

## Relationship to `deploy/argocd/`

`deploy/argocd/` is the original **single-environment** app-of-apps (namespace
`billfree`). This `envs/` folder is the **graduated multi-env model**. Adopt it by
bootstrapping the ApplicationSets above; retire the flat `deploy/argocd/apps/` once the
per-env apps are healthy.

> ⚠️ **Before re-enabling live GitOps with a protected `main`:** the CI image-tag
> writeback in `build-deploy.yml` pushes **directly to `main`**, which branch protection
> blocks. Switch that writeback to a **PR-based** flow (open + auto-merge) or have it
> bump only the **dev** overlay via PR. See `docs/DEVOPS_PRACTICE.md`.
