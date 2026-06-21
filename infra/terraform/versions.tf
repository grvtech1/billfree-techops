terraform {
  required_version = ">= 1.6"

  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.60" }
    tls    = { source = "hashicorp/tls", version = "~> 4.0" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
    local  = { source = "hashicorp/local", version = "~> 2.5" }
  }

  # State is local by default (simple/self-contained). For team use, switch to an
  # S3 backend with DynamoDB locking by uncommenting and running `terraform init
  # -backend-config=...`. (S3 is object storage, not a managed control plane —
  # the cluster itself is fully self-managed via kubeadm; see cloud-init/.)
  # backend "s3" {}
}

provider "aws" {
  region = var.region
  default_tags {
    tags = local.tags
  }
}
