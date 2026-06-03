provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "amsa-gestion"
      Env       = "prod"
      ManagedBy = "terraform"
    }
  }
}
