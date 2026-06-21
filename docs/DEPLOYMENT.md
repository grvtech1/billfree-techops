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
cp terraform.tfvars.example terraform.tfvars   # lock ssh_allowed_cidr / api_allowed_cidr to your IP
terraform init
terraform apply
terraform output fetch_kubeconfig              # prints the scp + kubectl steps
```

This stands up 1 control-plane + N workers on EC2, bootstrapped by cloud-init
(`containerd` + `kubeadm init/join`, Calico CNI). Fetch the kubeconfig from the
output, then:

```bash
export KUBECONFIG=$PWD/kubeconfig
kubectl get nodes        # all Ready once Calico is up (~2-3 min)
```

## 3. Bootstrap ArgoCD

```bash
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
kubectl -n argocd rollout status deploy/argocd-server
```

## 4. Create the bootstrap secret (out-of-band)

```bash
kubectl create namespace billfree
kubectl -n billfree create secret generic billfree-app-secrets \
  --from-literal=JWT_SECRET="$(openssl rand -hex 24)" \
  --from-literal=JWT_ISSUER="billfree-techops" \
  --from-literal=DATABASE_URL="postgres://billfree:REDACTED-DEV-PLACEHOLDER@postgres:5432/billfree" \
  --from-literal=INTAKE_API_KEY="$(openssl rand -hex 24)"
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
# user admin / pass REDACTED-DEV-PLACEHOLDER  → dashboards include the services' RED metrics
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
