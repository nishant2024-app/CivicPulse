variable "name" {
  description = "Name prefix for every resource."
  type        = string
  default     = "civicpulse"
}

variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  description = "Subnets for the load balancer."
  type        = list(string)
}

variable "private_subnet_ids" {
  description = "Subnets for the tasks (need a route to the internet for pulling images, e.g. a NAT gateway)."
  type        = list(string)
}

variable "image_prefix" {
  description = "Images are <prefix>-api, <prefix>-workers, <prefix>-web."
  type        = string
  default     = "ghcr.io/nishant2024-app/civicpulse"
}

variable "image_tag" {
  type = string
}

variable "environment" {
  description = "Non-secret environment of the API and workers (see infrastructure/helm/civicpulse/values.yaml `config`)."
  type        = map(string)
}

variable "secret_arns" {
  description = "Environment variable name => ARN of an SSM parameter or Secrets Manager secret."
  type        = map(string)
  default     = {}
}

variable "certificate_arn" {
  description = "ACM certificate for HTTPS. Null serves HTTP only (not for production)."
  type        = string
  default     = null
}

variable "allowed_cidr_blocks" {
  type    = list(string)
  default = ["0.0.0.0/0"]
}

variable "api_cpu" {
  type    = number
  default = 512
}

variable "api_memory" {
  type    = number
  default = 1024
}

variable "api_desired_count" {
  type    = number
  default = 2
}

variable "web_cpu" {
  type    = number
  default = 256
}

variable "web_memory" {
  type    = number
  default = 512
}

variable "web_desired_count" {
  type    = number
  default = 2
}

variable "workers_cpu" {
  type    = number
  default = 512
}

variable "workers_memory" {
  type    = number
  default = 1024
}

variable "workers_desired_count" {
  type    = number
  default = 1
}

variable "log_retention_days" {
  type    = number
  default = 14
}

variable "tags" {
  type    = map(string)
  default = {}
}
