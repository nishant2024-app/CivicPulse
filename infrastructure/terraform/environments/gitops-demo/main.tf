terraform {
  required_version = ">= 1.6"
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.38"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.17"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
  }
}

provider "kubernetes" {
  config_path = var.kubeconfig_path
}

provider "helm" {
  kubernetes {
    config_path = var.kubeconfig_path
  }
}

# 1. Namespace and generated secrets.
module "secrets" {
  source = "../../modules/cluster-secrets"
}

# 2. Ingress controller, Argo CD and the root Application. After this, Argo CD syncs the
#    data services and the application from Git on its own.
module "gitops" {
  source = "../../modules/gitops-bootstrap"

  repo_url       = var.repo_url
  repo_revision  = var.repo_revision
  image_tag      = var.image_tag
  image_prefix   = var.image_prefix
  app_value_file = var.app_value_file

  depends_on = [module.secrets]
}
