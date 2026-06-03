# ============ IAM para GitHub Actions (OIDC) ============

# Trust común: rama del repo, audiencia sts.
data "aws_iam_policy_document" "gh_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repo}:*"]
    }
  }
}

# --- Rol deploy frontend (S3 + CloudFront) ---
resource "aws_iam_role" "gh_frontend" {
  name               = "amsa-gestion-frontend-deploy"
  assume_role_policy = data.aws_iam_policy_document.gh_assume.json
}

data "aws_iam_policy_document" "gh_frontend" {
  statement {
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.front.arn]
  }
  statement {
    actions   = ["s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.front.arn}/*"]
  }
  statement {
    actions   = ["cloudfront:CreateInvalidation"]
    resources = [aws_cloudfront_distribution.front.arn]
  }
}

resource "aws_iam_role_policy" "gh_frontend" {
  name   = "frontend-deploy"
  role   = aws_iam_role.gh_frontend.id
  policy = data.aws_iam_policy_document.gh_frontend.json
}

# --- Rol deploy backend (ECR push + disparar SSM) ---
resource "aws_iam_role" "gh_backend" {
  name               = "amsa-gestion-backend-deploy"
  assume_role_policy = data.aws_iam_policy_document.gh_assume.json
}

data "aws_iam_policy_document" "gh_backend" {
  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }
  statement {
    sid = "EcrPush"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:CompleteLayerUpload",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]
    resources = [aws_ecr_repository.backend.arn]
  }
  statement {
    sid     = "SsmDeploy"
    actions = ["ssm:SendCommand"]
    resources = [
      "arn:aws:ssm:${var.region}::document/AWS-RunShellScript",
      aws_instance.backend.arn,
    ]
  }
  statement {
    sid       = "SsmReadResult"
    actions   = ["ssm:GetCommandInvocation", "ssm:ListCommands", "ssm:ListCommandInvocations"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "gh_backend" {
  name   = "backend-deploy"
  role   = aws_iam_role.gh_backend.id
  policy = data.aws_iam_policy_document.gh_backend.json
}
