data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  ssm_prefix = "/amsa-gestion"
  ecr_repo   = "amsa-gestion-backend"
}
