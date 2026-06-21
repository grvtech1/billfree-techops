#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# One-command cluster bootstrap. Run AFTER `terraform apply` + `fetch-kubeconfig.sh`
# (i.e. KUBECONFIG points at a reachable cluster with all nodes Ready).
#
# Idempotent — safe to re-run. Turns a bare kubeadm cluster into the full running
# stack via GitOps: storage → secret → ArgoCD → app-of-apps.
#
#   export KUBECONFIG=infra/terraform/kubeconfig
#   scripts/bootstrap-cluster.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

NS=billfree
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_PATH_VER="v0.0.30"

echo "==> verifying cluster is reachable"
kubectl get nodes

echo "==> 1/4  default StorageClass (local-path) — a bare kubeadm cluster has none,"
echo "         so the Postgres PVC would otherwise hang Pending forever"
kubectl apply -f "https://raw.githubusercontent.com/rancher/local-path-provisioner/${LOCAL_PATH_VER}/deploy/local-path-storage.yaml"
kubectl patch storageclass local-path \
  -p '{"metadata":{"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'

echo "==> 2/4  namespace + application secret (generated, out-of-band — never in Git)"
kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f -
if kubectl -n "$NS" get secret billfree-app-secrets >/dev/null 2>&1; then
  echo "         billfree-app-secrets already exists — leaving it untouched"
else
  INTAKE_KEY="$(openssl rand -hex 24)"
  kubectl -n "$NS" create secret generic billfree-app-secrets \
    --from-literal=JWT_SECRET="$(openssl rand -hex 24)" \
    --from-literal=JWT_ISSUER="billfree-techops" \
    --from-literal=DATABASE_URL="postgres://billfree:billfree-change-me@postgres:5432/billfree" \
    --from-literal=INTAKE_API_KEY="$INTAKE_KEY"
  echo "         created. WhatsApp INTAKE_API_KEY = $INTAKE_KEY"
fi

echo "==> 3/4  ArgoCD (--server-side avoids the large-CRD annotation limit)"
kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -n argocd --server-side \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
kubectl -n argocd rollout status deploy/argocd-server --timeout=300s

echo "==> 4/4  app-of-apps root — ArgoCD now reconciles everything from Git"
kubectl apply -f "$ROOT/deploy/argocd/root.yaml"

cat <<EOF

────────────────────────────────────────────────────────────────────
Bootstrap complete. ArgoCD is syncing the stack from Git.

Watch it converge:
  kubectl -n argocd get applications -w     # all → Synced / Healthy
  kubectl -n billfree get pods -w           # all → Running 1/1

Reach the dashboard (any WORKER node's public IP, port 80):
  terraform -chdir=infra/terraform output worker_public_ips
  # open http://<worker-ip>  → log in as admin@billfree.in

Tear down when done (stops billing):
  terraform -chdir=infra/terraform destroy
────────────────────────────────────────────────────────────────────
EOF
