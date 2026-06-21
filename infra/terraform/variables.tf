variable "region" {
  description = "AWS region to host the self-managed cluster VMs."
  type        = string
  default     = "ap-south-1"
}

variable "project" {
  description = "Name prefix for all resources."
  type        = string
  default     = "billfree-techops"
}

variable "environment" {
  description = "Environment (dev/staging/prod)."
  type        = string
  default     = "dev"
}

variable "vpc_cidr" {
  description = "CIDR for the cluster VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "control_plane_instance_type" {
  description = "EC2 type for the kubeadm control-plane node."
  type        = string
  default     = "t3.medium"
}

variable "worker_instance_type" {
  description = "EC2 type for worker nodes."
  type        = string
  default     = "t3.large"
}

variable "worker_count" {
  description = "Number of worker nodes."
  type        = number
  default     = 2
}

variable "kubernetes_version" {
  description = "Kubernetes minor version to install (kubeadm/kubelet/kubectl)."
  type        = string
  default     = "1.30"
}

variable "pod_cidr" {
  description = "Pod network CIDR for the CNI (Calico)."
  type        = string
  default     = "192.168.0.0/16"
}

variable "ssh_allowed_cidr" {
  description = "CIDR allowed to SSH to the nodes (lock this to your IP)."
  type        = string
  default     = "0.0.0.0/0"
}

variable "api_allowed_cidr" {
  description = "CIDR allowed to reach the Kubernetes API (6443)."
  type        = string
  default     = "0.0.0.0/0"
}
