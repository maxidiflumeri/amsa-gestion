variable "region" {
  type    = string
  default = "us-east-1"
}

variable "project" {
  type    = string
  default = "amsa-gestion"
}

# --- Dominios ---
variable "root_domain" {
  type    = string
  default = "anamayasa.com"
}

variable "front_domain" {
  type    = string
  default = "amsagestion.anamayasa.com"
}

variable "api_domain" {
  type    = string
  default = "api.amsagestion.anamayasa.com"
}

# --- GitHub (OIDC) ---
variable "github_repo" {
  type    = string
  default = "maxidiflumeri/amsa-gestion"
}

variable "github_branch" {
  type    = string
  default = "main"
}

# --- Acceso admin ---
variable "admin_cidr" {
  type        = string
  default     = "190.16.88.238/32"
  description = "IP admin para SSH (igual a amsa-sender). El acceso recomendado es SSM Session Manager, que no requiere abrir el 22."
}

# --- Compute (Graviton / ARM) ---
variable "instance_type" {
  type    = string
  default = "t4g.large"
}

variable "instance_arch" {
  type        = string
  default     = "arm64"
  description = "arm64 (Graviton) o x86_64. Debe coincidir con la plataforma de la imagen Docker que buildea la CI."
}

variable "ebs_size_gb" {
  type    = number
  default = 60
}

# --- RDS ---
variable "rds_instance_class" {
  type    = string
  default = "db.t4g.small"
}

variable "rds_engine_version" {
  type    = string
  default = "8.0"
}

variable "rds_storage_gb" {
  type    = number
  default = 50
}

variable "rds_max_storage_gb" {
  type    = number
  default = 200
}

variable "db_name" {
  type    = string
  default = "amsa_gestion"
}

variable "db_username" {
  type    = string
  default = "amsagestion"
}

# --- Monitoring ---
variable "alarm_email" {
  type    = string
  default = "maxidiflumeri@gmail.com"
}

# --- Secretos / config del backend (van a SSM) ---
variable "jwt_secret" {
  type        = string
  default     = ""
  sensitive   = true
  description = "Si queda vacío, Terraform genera uno aleatorio fuerte."
}

variable "jwt_expires_in" {
  type    = string
  default = "1d"
}

variable "google_client_id" {
  type    = string
  default = "887952568365-102oapkp75mu0oucmidouqcmn33m5f6u.apps.googleusercontent.com"
}

variable "sender_base_url" {
  type    = string
  default = "https://api.amsasender.anamayasa.com/api"
}

variable "sender_internal_api_key" {
  type        = string
  default     = ""
  sensitive   = true
  description = "Valor que amsa-sender prod espera en su INTERNAL_API_KEYS. Completar antes de usar el módulo email-sender."
}

variable "sender_timeout_ms" {
  type    = string
  default = "8000"
}

variable "neotel_sip_encryption_key" {
  type        = string
  default     = ""
  sensitive   = true
  description = "Misma key AES-256-GCM que usa gestión para descifrar credenciales SIP. Completar antes de usar telefonía."
}
