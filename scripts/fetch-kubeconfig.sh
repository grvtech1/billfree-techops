#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Fetch the kubeconfig from the Terraform-provisioned control plane, point it at
# the node's public IP, and disable cert verification.
#
# Why insecure-skip-tls-verify: kubeadm's apiserver serving cert is issued for the
# cluster service IP + the node's PRIVATE IP, not the public IP we connect through.
# Traffic is still TLS-encrypted; we only skip CA hostname verification (fine for a
# short-lived demo reached over the internet). The production-correct alternative is
# `kubeadm init --apiserver-cert-extra-sans <public-ip>`.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../infra/terraform"

IP="$(terraform output -raw control_plane_public_ip)"
KEY="$(terraform output -raw ssh_private_key_path)"
chmod 600 "$KEY" 2>/dev/null || true

echo "==> fetching kubeconfig from control plane ($IP)"
scp -i "$KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  ubuntu@"$IP":/home/ubuntu/.kube/config ./kubeconfig

# Point at the public IP and drop CA verification (see header).
sed -i "s#https://[0-9.]*:6443#https://$IP:6443#" ./kubeconfig
sed -i 's#certificate-authority-data:.*#insecure-skip-tls-verify: true#' ./kubeconfig

echo "==> kubeconfig saved to $(pwd)/kubeconfig"
echo
echo "Next:"
echo "  export KUBECONFIG=$(pwd)/kubeconfig"
echo "  kubectl get nodes        # wait until all 3 are Ready (~2-3 min after apply)"
echo "  ../../scripts/bootstrap-cluster.sh"
