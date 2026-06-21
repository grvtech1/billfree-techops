locals {
  name = "${var.project}-${var.environment}"
  tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "terraform"
    Cluster     = "self-managed-kubeadm"
  }
}

data "aws_availability_zones" "available" {
  state = "available"
}

# Ubuntu 22.04 LTS (Canonical) — base image for the kubeadm nodes.
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]
  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# A kubeadm bootstrap token (format: [a-z0-9]{6}.[a-z0-9]{16}) shared by the
# control-plane (init) and workers (join). Generated once, kept in state.
resource "random_string" "token_id" {
  length  = 6
  upper   = false
  special = false
}
resource "random_string" "token_secret" {
  length  = 16
  upper   = false
  special = false
}

locals {
  bootstrap_token = "${random_string.token_id.result}.${random_string.token_secret.result}"
}

# SSH keypair for node access (private key written locally; lock it down).
resource "tls_private_key" "node" {
  algorithm = "RSA"
  rsa_bits  = 4096
}
resource "aws_key_pair" "node" {
  key_name   = "${local.name}-key"
  public_key = tls_private_key.node.public_key_openssh
}
resource "local_sensitive_file" "private_key" {
  content         = tls_private_key.node.private_key_pem
  filename        = "${path.module}/.ssh/${local.name}.pem"
  file_permission = "0600"
}
