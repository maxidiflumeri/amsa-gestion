output "ec2_instance_id" {
  value = aws_instance.backend.id
}

output "ec2_public_ip" {
  value = aws_eip.backend.public_ip
}

output "alb_dns_name" {
  value = aws_lb.api.dns_name
}

output "ecr_repository_url" {
  value = aws_ecr_repository.backend.repository_url
}

output "s3_frontend_bucket" {
  value = aws_s3_bucket.front.id
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.front.id
}

output "rds_endpoint" {
  value = aws_db_instance.main.address
}

output "front_url" {
  value = "https://${var.front_domain}"
}

output "api_url" {
  value = "https://${var.api_domain}"
}

# Config lista para cargar en GitHub (Settings → Secrets and variables → Actions).
output "github_actions_config" {
  value = {
    secrets = {
      AWS_ROLE_ARN_FRONTEND = aws_iam_role.gh_frontend.arn
      AWS_ROLE_ARN_BACKEND  = aws_iam_role.gh_backend.arn
      VITE_GOOGLE_CLIENT_ID = var.google_client_id
    }
    variables = {
      VITE_API_URL       = "https://${var.api_domain}/api"
      VITE_HOST_SOCKET   = "https://${var.api_domain}"
      S3_BUCKET          = aws_s3_bucket.front.id
      CF_DISTRIBUTION_ID = aws_cloudfront_distribution.front.id
      EC2_INSTANCE_ID    = aws_instance.backend.id
    }
  }
}
