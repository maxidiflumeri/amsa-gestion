# Reusamos la VPC default (igual que amsa-sender) — sin VPC custom ni NAT.
data "aws_vpc" "default" {
  default = true
}

# Subnets en AZs "maduras" (evita us-east-1e/1f por capacidad limitada de instancias nuevas).
data "aws_subnets" "selected" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
  filter {
    name   = "availability-zone"
    values = ["us-east-1a", "us-east-1b", "us-east-1c", "us-east-1d"]
  }
}

# AMI Amazon Linux 2023 (arch según var) vía SSM público.
data "aws_ssm_parameter" "al2023_ami" {
  name = var.instance_arch == "arm64" ? "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64" : "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

# Zona Route53 ya existente (delegada en AWS).
data "aws_route53_zone" "main" {
  name         = "${var.root_domain}."
  private_zone = false
}

# Provider OIDC de GitHub — YA existe en la cuenta (lo creó amsa-sender).
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}
