terraform {
  required_version = ">= 1.6"
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.38"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
  }
}

# Every credential the platform needs is generated here and written straight into a
# Kubernetes Secret. Nothing is committed to Git and no value is chosen by a human.
# (State is local and the Secret lives only in the cluster; in a long-lived environment use
# an external secrets manager instead — see docs/deployment.)

resource "kubernetes_namespace_v1" "this" {
  metadata {
    name = var.namespace
    labels = {
      "app.kubernetes.io/part-of" = "civicpulse"
    }
  }
}

resource "random_password" "postgres" {
  length  = 32
  special = false
}

resource "random_password" "session" {
  length  = 64
  special = false
}

resource "random_string" "s3_access_key" {
  length  = 20
  special = false
  lower   = false
}

resource "random_password" "s3_secret_key" {
  length  = 40
  special = false
}

resource "random_password" "grafana" {
  length  = 24
  special = false
}

resource "random_password" "seed" {
  length  = 20
  special = false
}

resource "kubernetes_secret_v1" "this" {
  metadata {
    name      = var.secret_name
    namespace = kubernetes_namespace_v1.this.metadata[0].name
  }

  data = {
    "postgres-password"      = random_password.postgres.result
    "database-url"           = "postgres://civicpulse:${random_password.postgres.result}@postgres:5432/civicpulse"
    "session-secret"         = random_password.session.result
    "s3-access-key-id"       = random_string.s3_access_key.result
    "s3-secret-access-key"   = random_password.s3_secret_key.result
    "grafana-admin-password" = random_password.grafana.result
    "seed-password"          = random_password.seed.result
    "s3-config.json" = jsonencode({
      identities = [
        {
          name = "civicpulse"
          credentials = [
            {
              accessKey = random_string.s3_access_key.result
              secretKey = random_password.s3_secret_key.result
            }
          ]
          actions = ["Admin", "Read", "Write", "List", "Tagging"]
        }
      ]
    })
  }
}
