output "control_plane_public_ip" {
  description = "Public IP of the kubeadm control-plane node."
  value       = aws_instance.control_plane.public_ip
}

output "worker_public_ips" {
  description = "Public IPs of the worker nodes."
  value       = aws_instance.worker[*].public_ip
}

output "ssh_private_key_path" {
  description = "Path to the generated SSH private key."
  value       = local_sensitive_file.private_key.filename
}

output "ssh_control_plane" {
  description = "SSH into the control plane."
  value       = "ssh -i ${local_sensitive_file.private_key.filename} ubuntu@${aws_instance.control_plane.public_ip}"
}

output "fetch_kubeconfig" {
  description = "Copy the cluster kubeconfig to your machine, then point kubectl at the public IP."
  value       = <<-EOT
    scp -i ${local_sensitive_file.private_key.filename} ubuntu@${aws_instance.control_plane.public_ip}:~/.kube/config ./kubeconfig
    sed -i 's#https://.*:6443#https://${aws_instance.control_plane.public_ip}:6443#' ./kubeconfig
    export KUBECONFIG=$PWD/kubeconfig
    kubectl get nodes
  EOT
}
