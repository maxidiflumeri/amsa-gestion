# ============ EC2 backend + IAM ============

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ec2" {
  name               = "amsa-gestion-ec2-role"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

# SSM Session Manager + Run Command
resource "aws_iam_role_policy_attachment" "ec2_ssm" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# Pull de imágenes desde ECR
resource "aws_iam_role_policy_attachment" "ec2_ecr" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

data "aws_iam_policy_document" "ec2_inline" {
  statement {
    sid       = "ReadAppParams"
    actions   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
    resources = ["arn:aws:ssm:${var.region}:${local.account_id}:parameter${local.ssm_prefix}/*"]
  }

  statement {
    sid       = "DecryptParams"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.region}.amazonaws.com"]
    }
  }

  statement {
    sid       = "CloudWatchLogs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"]
    resources = ["arn:aws:logs:${var.region}:${local.account_id}:log-group:/amsa-gestion/*"]
  }
}

resource "aws_iam_role_policy" "ec2_inline" {
  name   = "amsa-gestion-ec2-inline"
  role   = aws_iam_role.ec2.id
  policy = data.aws_iam_policy_document.ec2_inline.json
}

resource "aws_iam_instance_profile" "ec2" {
  name = "amsa-gestion-ec2-profile"
  role = aws_iam_role.ec2.name
}

resource "aws_instance" "backend" {
  ami                    = data.aws_ssm_parameter.al2023_ami.value
  instance_type          = var.instance_type
  subnet_id              = tolist(data.aws_subnets.selected.ids)[0]
  vpc_security_group_ids = [aws_security_group.ec2.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2.name

  user_data = templatefile("${path.module}/templates/user-data.sh.tftpl", {
    region       = var.region
    compose_arch = var.instance_arch == "arm64" ? "aarch64" : "x86_64"
  })

  root_block_device {
    volume_type = "gp3"
    volume_size = var.ebs_size_gb
    encrypted   = true
  }

  metadata_options {
    http_tokens   = "required" # IMDSv2 obligatorio
    http_endpoint = "enabled"
  }

  tags = { Name = "amsa-gestion-backend" }

  # La box lee los SSM params en el user-data → deben existir antes.
  depends_on = [
    aws_ssm_parameter.compose,
    aws_ssm_parameter.deploy_sh,
    aws_ssm_parameter.render_env_sh,
    aws_ssm_parameter.secure,
    aws_ssm_parameter.string,
  ]
}

resource "aws_eip" "backend" {
  instance = aws_instance.backend.id
  domain   = "vpc"
  tags     = { Name = "amsa-gestion-backend" }
}
