# ============ SSM Parameter Store ============
# Secretos + config del backend (render-env.sh los baja a /opt/amsa-gestion/.env)
# y los artefactos de deploy (compose + scripts).

resource "random_password" "jwt" {
  length  = 48
  special = false
}

locals {
  jwt_secret   = var.jwt_secret != "" ? var.jwt_secret : random_password.jwt.result
  database_url = "mysql://${var.db_username}:${random_password.db.result}@${aws_db_instance.main.address}:3306/${var.db_name}"

  # Secretos → SecureString. SSM no acepta valor vacío: si falta el secreto,
  # se guarda un placeholder REPLACE_ME (se actualiza con un nuevo apply cuando lo tengas).
  secure_params = {
    DATABASE_URL              = local.database_url
    JWT_SECRET                = local.jwt_secret
    NEOTEL_SIP_ENCRYPTION_KEY = var.neotel_sip_encryption_key != "" ? var.neotel_sip_encryption_key : "REPLACE_ME"
    SENDER_INTERNAL_API_KEY   = var.sender_internal_api_key != "" ? var.sender_internal_api_key : "REPLACE_ME"
  }

  # Config no sensible que igual va al .env → String
  string_params = {
    JWT_EXPIRES_IN    = var.jwt_expires_in
    GOOGLE_CLIENT_ID  = var.google_client_id
    SENDER_BASE_URL   = var.sender_base_url
    SENDER_TIMEOUT_MS = var.sender_timeout_ms
  }
}

resource "aws_ssm_parameter" "secure" {
  for_each = local.secure_params
  name     = "${local.ssm_prefix}/${each.key}"
  type     = "SecureString"
  value    = each.value
}

resource "aws_ssm_parameter" "string" {
  for_each = local.string_params
  name     = "${local.ssm_prefix}/${each.key}"
  type     = "String"
  value    = each.value
}

# --- Artefactos de deploy (single source = archivos del repo) ---
resource "aws_ssm_parameter" "compose" {
  name  = "${local.ssm_prefix}/_compose"
  type  = "String"
  value = file("${path.module}/../../docker-compose.prod.yml")
}

resource "aws_ssm_parameter" "deploy_sh" {
  name  = "${local.ssm_prefix}/_deploy_sh"
  type  = "String"
  value = file("${path.module}/../ec2/deploy.sh")
}

resource "aws_ssm_parameter" "render_env_sh" {
  name  = "${local.ssm_prefix}/_render_env_sh"
  type  = "String"
  value = file("${path.module}/../ec2/render-env.sh")
}
