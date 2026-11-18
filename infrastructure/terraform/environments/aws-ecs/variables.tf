variable "confirm_paid_resources" {
  description = "Must be true to proceed. Applying creates billed AWS resources."
  type        = bool
  default     = false
}

variable "region" {
  type    = string
  default = "ap-south-1"
}

variable "name" {
  type    = string
  default = "civicpulse"
}

variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "image_prefix" {
  type    = string
  default = "ghcr.io/nishant2024-app/civicpulse"
}

variable "image_tag" {
  type = string
}

variable "web_origin" {
  description = "Public https:// address of the site."
  type        = string
}

variable "certificate_arn" {
  type    = string
  default = null
}

variable "extra_environment" {
  description = "Endpoints of managed services: REDIS_URL, KAFKA_BROKERS, OPENSEARCH_URL, S3_BUCKET, SMTP_URL, OTEL_EXPORTER_OTLP_ENDPOINT, ..."
  type        = map(string)
  default     = {}
}

variable "secret_arns" {
  description = "DATABASE_URL, SESSION_SECRET, S3 keys and other secrets, as ARNs."
  type        = map(string)
  default     = {}
}

variable "tags" {
  type    = map(string)
  default = {}
}
