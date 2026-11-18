variable "kubeconfig_path" {
  description = "Kubeconfig of the target cluster (output of the kind-cluster environment)."
  type        = string
}

variable "repo_url" {
  type    = string
  default = "https://github.com/nishant2024-app/CivicPulse"
}

variable "repo_revision" {
  description = "Branch, tag or commit SHA Argo CD deploys."
  type        = string
  default     = "main"
}

variable "image_tag" {
  type    = string
  default = ""
}

variable "image_prefix" {
  type    = string
  default = "civicpulse"
}

variable "app_value_file" {
  type    = string
  default = "values-kind.yaml"
}
