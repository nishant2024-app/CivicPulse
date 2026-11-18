variable "cluster_name" {
  type    = string
  default = "civicpulse"
}

variable "node_image" {
  description = "kind node image; selects the Kubernetes version."
  type        = string
  default     = "kindest/node:v1.32.2"
}

variable "http_host_port" {
  description = "Port on this machine that reaches the cluster's ingress."
  type        = number
  default     = 8080
}
