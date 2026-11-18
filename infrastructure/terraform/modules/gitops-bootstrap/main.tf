terraform {
  required_version = ">= 1.6"
  required_providers {
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.17"
    }
  }
}

# The load balancer: Traefik as the ingress controller. On kind it listens on the node's
# port 80 (hostPort), which the cluster maps to a port on the machine.
resource "helm_release" "traefik" {
  name             = "traefik"
  repository       = "https://traefik.github.io/charts"
  chart            = "traefik"
  version          = var.traefik_chart_version
  namespace        = "traefik"
  create_namespace = true
  wait             = true
  timeout          = 300

  values = [yamlencode({
    deployment = { replicas = 1 }
    service    = { spec = { type = "ClusterIP" } }
    ports = {
      web       = { hostPort = 80 }
      websecure = { expose = { default = false } }
    }
    nodeSelector = { "ingress-ready" = "true" }
    tolerations = [{
      key      = "node-role.kubernetes.io/control-plane"
      operator = "Exists"
      effect   = "NoSchedule"
    }]
    updateStrategy = {
      type          = "RollingUpdate"
      rollingUpdate = { maxUnavailable = 1, maxSurge = 0 }
    }
    ingressClass = { enabled = true, isDefaultClass = true }
    providers = {
      kubernetesIngress = { publishedService = { enabled = false } }
    }
    resources = {
      requests = { cpu = "50m", memory = "64Mi" }
      limits   = { memory = "192Mi" }
    }
  })]
}

# GitOps engine. Applications are defined in Git; Argo CD keeps the cluster equal to Git.
resource "helm_release" "argocd" {
  name             = "argocd"
  repository       = "https://argoproj.github.io/argo-helm"
  chart            = "argo-cd"
  version          = var.argocd_chart_version
  namespace        = var.argocd_namespace
  create_namespace = true
  wait             = true
  timeout          = 600

  values = [yamlencode({
    configs = {
      params = { "server.insecure" = true } # TLS is terminated at the ingress
      cm = {
        # Traefik here has no load balancer, so an Ingress never gets a published address and
        # Argo CD would report it Progressing forever. The Ingress is healthy once it exists;
        # real reachability is proven by the browser tests that go through it.
        "resource.customizations.health.networking.k8s.io_Ingress" = <<-LUA
          hs = {}
          hs.status = "Healthy"
          hs.message = "Ingress accepted (address publication ignored)"
          return hs
        LUA
      }
    }
    dex            = { enabled = false }
    notifications  = { enabled = false }
    applicationSet = { enabled = false }
    server = {
      ingress = {
        enabled          = true
        ingressClassName = "traefik"
        hostname         = var.argocd_host
      }
      resources = {
        requests = { cpu = "50m", memory = "128Mi" }
        limits   = { memory = "256Mi" }
      }
    }
    controller = {
      resources = {
        requests = { cpu = "100m", memory = "256Mi" }
        limits   = { memory = "512Mi" }
      }
    }
    repoServer = {
      resources = {
        requests = { cpu = "50m", memory = "128Mi" }
        limits   = { memory = "256Mi" }
      }
    }
    redis = {
      resources = {
        requests = { cpu = "20m", memory = "32Mi" }
        limits   = { memory = "128Mi" }
      }
    }
  })]

  depends_on = [helm_release.traefik]
}

# The single "app of apps" Application. From here on, everything else is driven by Git.
resource "helm_release" "root" {
  name      = "civicpulse-root"
  chart     = "${path.module}/../../../argocd/root"
  namespace = var.argocd_namespace
  wait      = false

  set {
    name  = "repoURL"
    value = var.repo_url
  }
  set {
    name  = "targetRevision"
    value = var.repo_revision
  }
  set {
    name  = "imageTag"
    value = var.image_tag
  }
  set {
    name  = "imagePrefix"
    value = var.image_prefix
  }
  set {
    name  = "appValueFile"
    value = var.app_value_file
  }

  depends_on = [helm_release.argocd]
}
