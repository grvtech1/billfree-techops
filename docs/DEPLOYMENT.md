# Deployment runbook — cloud-native (self-managed Kubernetes)

End-to-end path: **local → images → self-managed cluster → GitOps**. Image repos
and ArgoCD `repoURL`s are already set to `grvtech1/billfree-techops`.

## 0. Topology

```
 GitHub Actions ──build/scan──▶ GHCR (ghcr.io/grvtech1/billfree-techops/*)
        │ bump deploy/ tags (commit)
        ▼
   Git repo (main) ◀──watch── ArgoCD ──sync──▶ self-managed kubeadm cluster (EC2)
                                                   namespace: billfree
                                                    web → api-gateway →
                                                      {auth,ticket,analytics,calllog,report}
                                                    postgres (StatefulSet) · redis
                                                  ingress-nginx (DaemonSet, hostPort 80/443)
                                                  monitoring (Prometheus + Grafana)
```

## 1. Run it all locally (no cloud)

```bash
docker compose up --build
# web        → http://localhost:3000
# gateway    → http://localhost:8080   (try: curl localhost:8080/healthz)
# get a token:
curl -s localhost:8080/auth/token -H 'content-type: application/json' \
  -d '{"email":"agent1@billfree.in"}'
# use it:
TOKEN=...; curl -s localhost:8080/api/tickets -H "authorization: Bearer $TOKEN"
```

`migrate` runs first (compose `depends_on: service_completed_successfully`),
applying `db/migrations/*` before the services start.

## 2. Provision the self-managed cluster (Terraform)

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
# IMPORTANT: lock ssh_allowed_cidr / api_allowed_cidr to your real egress IP — the
# validation rule in variables.tf will reject 0.0.0.0/0.
# Find your IP: curl -s https://checkip.amazonaws.com   → set as x.x.x.x/32
terraform init
terraform apply
```

This stands up 1 control-plane + N workers on EC2, bootstrapped by cloud-init
(`containerd` + `kubeadm init/join`, Calico CNI, `--apiserver-cert-extra-sans` for
the public IP). Fetch the kubeconfig — the script patches the server URL and verifies
TLS without skipping verification:

```bash
cd ../..
scripts/fetch-kubeconfig.sh
export KUBECONFIG=infra/terraform/kubeconfig
kubectl get nodes        # all Ready once Calico is up (~2-3 min after apply)
```

### 2a. Install a default StorageClass

A bare kubeadm cluster has no default StorageClass. Install Rancher's
`local-path-provisioner` before the apps land — otherwise the Postgres PVC hangs
`Pending` forever:

```bash
kubectl apply -f https://raw.githubusercontent.com/rancher/local-path-provisioner/v0.0.30/deploy/local-path-storage.yaml
kubectl patch storageclass local-path \
  -p '{"metadata":{"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'
```

> **One-command alternative**: `scripts/bootstrap-cluster.sh` combines steps 2a–5
> into a single idempotent script (storage → namespaces/secrets → ArgoCD →
> app-of-apps). Run it instead of steps 2a–5 if you want the full cluster up in one
> shot.

## 3. Bootstrap ArgoCD

ArgoCD CRDs are large — `kubectl apply` stores the full manifest as a `last-applied`
annotation, which hits the 256 KiB per-resource limit. Use `--server-side` (stores
ownership metadata only) and `--force-conflicts` to resolve any field-manager
conflicts:

```bash
kubectl create namespace argocd
kubectl apply -n argocd --server-side --force-conflicts \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
kubectl -n argocd rollout status deploy/argocd-server --timeout=300s
```

## 4. Create the bootstrap secrets (out-of-band)

The simplest path is `scripts/bootstrap-cluster.sh`, which generates a matching
`postgres-secret`, `billfree-app-secrets`, and `grafana-admin` with random
passwords. To do it manually, generate the DB password once and reuse it:

```bash
kubectl create namespace billfree
DB_PASSWORD="$(openssl rand -hex 24)"
kubectl -n billfree create secret generic postgres-secret \
  --from-literal=POSTGRES_USER="billfree" \
  --from-literal=POSTGRES_PASSWORD="$DB_PASSWORD" \
  --from-literal=POSTGRES_DB="billfree"
kubectl -n billfree create secret generic billfree-app-secrets \
  --from-literal=JWT_SECRET="$(openssl rand -hex 24)" \
  --from-literal=JWT_ISSUER="billfree-techops" \
  --from-literal=DATABASE_URL="postgres://billfree:${DB_PASSWORD}@postgres:5432/billfree" \
  --from-literal=INTAKE_API_KEY="$(openssl rand -hex 24)" \
  --from-literal=GOOGLE_CLIENT_IDS="<your-google-oauth-client-ids>"
```

> `INTAKE_API_KEY` enables the WhatsApp chatbot intake routes (ticket-service +
> gateway). Share it with the chatbot owner; rotate by updating the secret and
> restarting both deployments. See `docs/WHATSAPP_INTAKE.md`.

> For production, replace this with a **SealedSecret** or **External Secrets
> Operator** so nothing sensitive lives in Git. See `deploy/secrets/app-secret.example.yaml`.

## 5. Hand the cluster to GitOps

```bash
kubectl apply -n argocd -f deploy/argocd/root.yaml
```

The app-of-apps root then reconciles every child Application in
`deploy/argocd/apps/`: ingress-nginx, monitoring, platform (postgres/redis +
PreSync migrate Job), and the six service Applications (api-gateway, auth,
ticket, analytics, calllog, report). Watch it converge:

```bash
kubectl -n argocd get applications
kubectl -n billfree get pods,svc,hpa
```

## 6. Access

```bash
# Map the ingress hosts to a node's public IP (or set real DNS):
echo "<NODE_PUBLIC_IP> billfree.example api.billfree.example" | sudo tee -a /etc/hosts
# web:     http://billfree.example
# gateway: http://api.billfree.example/healthz

# Grafana (port-forward):
kubectl -n monitoring port-forward svc/kube-prometheus-stack-grafana 3000:80
# Login: admin / <the password printed by bootstrap-cluster.sh, or:>
#   kubectl -n monitoring get secret grafana-admin -o jsonpath='{.data.admin-password}' | base64 -d
```

## 7. The deploy loop (GitOps)

1. Push to `main`. **CI** (`ci.yml`) runs the full test matrix.
2. **Build & Deploy** (`build-deploy.yml`) builds + Trivy-scans + pushes each
   image to GHCR tagged with the commit SHA, then **bumps the tags in
   `deploy/apps/*` and commits** back to `main`.
3. **ArgoCD** detects the changed manifests and rolls out — no `kubectl` from CI.

Required GitHub settings: `GITHUB_TOKEN` has `packages: write` (set in the
workflow); make the GHCR packages public or grant the cluster a pull secret.

## Rollback

GitOps rollback = Git revert: `git revert <deploy-commit>` (or set the image tag
back) and push — ArgoCD syncs the previous version. Or `argocd app rollback <app>`.
