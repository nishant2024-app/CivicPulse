output "urls" {
  value = {
    app        = "http://civicpulse.localtest.me:8080"
    argocd     = "http://argocd.localtest.me:8080"
    grafana    = "http://grafana.localtest.me:8080"
    jaeger     = "http://jaeger.localtest.me:8080"
    prometheus = "http://prometheus.localtest.me:8080"
    mail       = "http://mail.localtest.me:8080"
  }
}

output "grafana_admin_password" {
  value     = module.secrets.grafana_admin_password
  sensitive = true
}

output "seed_password" {
  value     = module.secrets.seed_password
  sensitive = true
}
