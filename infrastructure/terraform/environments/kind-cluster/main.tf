terraform {
  required_version = ">= 1.6"
  required_providers {
    kind = {
      source  = "tehcyx/kind"
      version = "~> 0.9"
    }
  }
}

provider "kind" {}

# A single-node Kubernetes cluster that runs inside Docker. Free, needs no account, and is
# what the CI workflow and a Codespace use. (On a real cloud this file would be replaced by
# a managed-cluster module; everything in ../gitops-demo stays the same.)
resource "kind_cluster" "this" {
  name            = var.cluster_name
  node_image      = var.node_image
  wait_for_ready  = true
  kubeconfig_path = abspath("${path.module}/.kube/${var.cluster_name}.yaml")

  kind_config {
    kind        = "Cluster"
    api_version = "kind.x-k8s.io/v1alpha4"

    node {
      role = "control-plane"

      kubeadm_config_patches = [
        "kind: InitConfiguration\nnodeRegistration:\n  kubeletExtraArgs:\n    node-labels: \"ingress-ready=true\"\n"
      ]

      # Traffic to localhost:<http_host_port> reaches the ingress controller on port 80.
      extra_port_mappings {
        container_port = 80
        host_port      = var.http_host_port
        protocol       = "TCP"
      }
    }
  }
}
