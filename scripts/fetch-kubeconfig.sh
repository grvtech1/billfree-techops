#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Fetch the kubeconfig from the Terraform-provisioned control plane and point it
# at the node's public IP.
#
# TLS verification is KEPT: control-plane.sh.tftpl passes
# --apiserver-cert-extra-sans=<public-ip> to `kubeadm init`, so the apiserver
# serving cert is valid for the public IP we connect through. No
# insecure-skip-tls-verify needed.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../infra/terraform"

IP="$(terraform output -raw control_plane_public_ip)"
KEY="$(terraform output -raw ssh_private_key_path)"
chmod 600 "$KEY" 2>/dev/null || true

echo "==> fetching kubeconfig from control plane ($IP)"
# accept-new: trust the host key on first connect and pin it (vs. -o
# StrictHostKeyChecking=no which disables verification entirely). For maximum
# assurance, pre-seed known_hosts from the instance's console output fingerprint.
scp -i "$KEY" -o StrictHostKeyChecking=accept-new \
  ubuntu@"$IP":/home/ubuntu/.kube/config ./kubeconfig

# Point the client at the public IP (the cert now includes it as a SAN).
sed -i "s#https://[0-9.]*:6443#https://$IP:6443#" ./kubeconfig

echo "==> kubeconfig saved to $(pwd)/kubeconfig"
echo
echo "Next:"
echo "  export KUBECONFIG=$(pwd)/kubeconfig"
echo "  kubectl get nodes        # wait until all 3 are Ready (~2-3 min after apply)"
echo "  ../../scripts/bootstrap-cluster.sh"
