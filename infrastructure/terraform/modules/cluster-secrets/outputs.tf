output "namespace" {
  value = kubernetes_namespace_v1.this.metadata[0].name
}

output "secret_name" {
  value = kubernetes_secret_v1.this.metadata[0].name
}

output "grafana_admin_password" {
  value     = random_password.grafana.result
  sensitive = true
}

output "seed_password" {
  description = "Password of the demo accounts created by the seed job."
  value       = random_password.seed.result
  sensitive   = true
}
