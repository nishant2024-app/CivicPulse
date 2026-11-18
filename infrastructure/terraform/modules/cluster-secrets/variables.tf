variable "namespace" {
  description = "Namespace that holds CivicPulse and its data services."
  type        = string
  default     = "civicpulse"
}

variable "secret_name" {
  description = "Name of the Secret the Helm charts read (existingSecret)."
  type        = string
  default     = "civicpulse-secrets"
}
