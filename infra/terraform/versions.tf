terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  backend "s3" {
    bucket         = "amsa-gestion-tfstate-592943773890"
    key            = "prod/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "amsa-gestion-tflock"
    encrypt        = true
  }
}
