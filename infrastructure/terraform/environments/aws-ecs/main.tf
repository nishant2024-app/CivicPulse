terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.region
}

# Cost gate. Applying this environment creates billed resources (ECS Fargate tasks, an
# Application Load Balancer, log storage) and needs an AWS account with a payment method.
# It will not plan or apply unless the caller says so explicitly:
#   terraform apply -var confirm_paid_resources=true
resource "terraform_data" "cost_gate" {
  lifecycle {
    precondition {
      condition     = var.confirm_paid_resources
      error_message = "This environment creates paid AWS resources. Re-run with -var confirm_paid_resources=true only if you intend that."
    }
  }
}

module "civicpulse" {
  source = "../../modules/ecs-service"

  name               = var.name
  vpc_id             = var.vpc_id
  public_subnet_ids  = var.public_subnet_ids
  private_subnet_ids = var.private_subnet_ids
  image_prefix       = var.image_prefix
  image_tag          = var.image_tag
  certificate_arn    = var.certificate_arn

  environment = merge(
    {
      NODE_ENV           = "production"
      TRUST_PROXY        = "true"
      EMBEDDED_WORKERS   = "false"
      WEB_ORIGIN         = var.web_origin
      LOG_LEVEL          = "info"
      API_DOCS_ENABLED   = "false"
      EVENT_BROKER       = "kafka"
      SEARCH_DRIVER      = "opensearch"
      STORAGE_DRIVER     = "s3"
      S3_REGION          = var.region
      EMAIL_DRIVER       = "smtp"
      RATE_LIMIT_ENABLED = "true"
    },
    var.extra_environment,
  )

  # Names the application reads => where AWS stores the value (SSM Parameter Store or Secrets Manager).
  secret_arns = var.secret_arns

  tags = var.tags

  depends_on = [terraform_data.cost_gate]
}
