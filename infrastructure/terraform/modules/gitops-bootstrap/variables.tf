variable "repo_url" {
  description = "Git repository Argo CD watches."
  type        = string
}

variable "repo_revision" {
  description = "Branch, tag or commit SHA to deploy."
  type        = string
  default     = "main"
}

variable "image_tag" {
  description = "Tag of the CivicPulse images (usually the commit SHA)."
  type        = string
  default     = ""
}

variable "image_prefix" {
  description = "Image name prefix; images are <prefix>-api, <prefix>-workers, <prefix>-web."
  type        = string
  default     = "ghcr.io/nishant2024-app/civicpulse"
}

variable "app_value_file" {
  description = "Helm values file of the application chart to use."
  type        = string
  default     = "values-kind.yaml"
}

variable "argocd_namespace" {
  type    = string
  default = "argocd"
}

variable "argocd_host" {
  type    = string
  default = "argocd.localtest.me"
}

variable "argocd_chart_version" {
  description = "Version of the argo-cd Helm chart."
  type        = string
  default     = "10.18.0"
}

variable "traefik_chart_version" {
  description = "Version of the traefik Helm chart."
  type        = string
  default     = "42.4.1"
}
