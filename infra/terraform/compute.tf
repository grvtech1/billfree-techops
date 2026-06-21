# Control-plane node — runs `kubeadm init`, installs the Calico CNI, and seeds a
# fixed bootstrap token so workers can join unattended.
resource "aws_instance" "control_plane" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.control_plane_instance_type
  subnet_id                   = aws_subnet.public.id
  key_name                    = aws_key_pair.node.key_name
  vpc_security_group_ids      = [aws_security_group.cluster.id]
  associate_public_ip_address = true

  user_data = templatefile("${path.module}/cloud-init/control-plane.sh.tftpl", {
    k8s_version = var.kubernetes_version
    pod_cidr    = var.pod_cidr
    token       = local.bootstrap_token
  })

  root_block_device {
    volume_size = 30
    volume_type = "gp3"
  }

  tags = { Name = "${local.name}-control-plane", Role = "control-plane" }
}

# Worker nodes — `kubeadm join` the control plane using the shared token.
resource "aws_instance" "worker" {
  count                       = var.worker_count
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.worker_instance_type
  subnet_id                   = aws_subnet.public.id
  key_name                    = aws_key_pair.node.key_name
  vpc_security_group_ids      = [aws_security_group.cluster.id]
  associate_public_ip_address = true

  user_data = templatefile("${path.module}/cloud-init/worker.sh.tftpl", {
    k8s_version          = var.kubernetes_version
    token                = local.bootstrap_token
    control_plane_ip     = aws_instance.control_plane.private_ip
  })

  root_block_device {
    volume_size = 40
    volume_type = "gp3"
  }

  tags = { Name = "${local.name}-worker-${count.index}", Role = "worker" }

  # Workers must come up after the control plane has its private IP.
  depends_on = [aws_instance.control_plane]
}
