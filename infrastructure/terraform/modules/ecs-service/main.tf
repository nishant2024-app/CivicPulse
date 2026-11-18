terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

# CivicPulse on AWS ECS (Fargate) behind an Application Load Balancer.
#
# THIS MODULE IS NEVER APPLIED BY THIS PROJECT. ECS, the load balancer and the NAT gateway
# it relies on are billed by the hour and need an AWS account with a payment method. It is
# kept validated and reviewable to show that the same images and configuration deploy to
# ECS, as the alternative to Kubernetes. See docs/deployment/ECS.md.

locals {
  services = {
    api = {
      port    = 4000
      cpu     = var.api_cpu
      memory  = var.api_memory
      count   = var.api_desired_count
      health  = "/readyz"
      balance = true
    }
    web = {
      port    = 3000
      cpu     = var.web_cpu
      memory  = var.web_memory
      count   = var.web_desired_count
      health  = "/login"
      balance = true
    }
    workers = {
      port    = 4100
      cpu     = var.workers_cpu
      memory  = var.workers_memory
      count   = var.workers_desired_count
      health  = "/healthz"
      balance = false
    }
  }
}

data "aws_region" "current" {}

resource "aws_ecs_cluster" "this" {
  name = var.name

  setting {
    name  = "containerInsights"
    value = "enhanced"
  }

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "service" {
  for_each          = local.services
  name              = "/ecs/${var.name}/${each.key}"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

# ---------- IAM: pull images, write logs, read secrets ----------
data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${var.name}-task-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "read_secrets" {
  count = length(var.secret_arns) > 0 ? 1 : 0

  statement {
    actions   = ["ssm:GetParameters", "secretsmanager:GetSecretValue", "kms:Decrypt"]
    resources = values(var.secret_arns)
  }
}

resource "aws_iam_role_policy" "read_secrets" {
  count  = length(var.secret_arns) > 0 ? 1 : 0
  name   = "read-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.read_secrets[0].json
}

# ---------- network ----------
resource "aws_security_group" "alb" {
  name_prefix = "${var.name}-alb-"
  description = "Public entry to the load balancer"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidr_blocks
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidr_blocks
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = var.tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group" "service" {
  name_prefix = "${var.name}-svc-"
  description = "CivicPulse tasks"
  vpc_id      = var.vpc_id

  ingress {
    description     = "From the load balancer"
    from_port       = 3000
    to_port         = 4000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    description = "Data services, registries and the internet"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = var.tags

  lifecycle {
    create_before_destroy = true
  }
}

# ---------- load balancer ----------
resource "aws_lb" "this" {
  name               = var.name
  load_balancer_type = "application"
  subnets            = var.public_subnet_ids
  security_groups    = [aws_security_group.alb.id]
  tags               = var.tags
}

resource "aws_lb_target_group" "service" {
  for_each = { for name, svc in local.services : name => svc if svc.balance }

  name_prefix = substr(each.key, 0, 4)
  port        = each.value.port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id

  health_check {
    path                = each.value.health
    matcher             = "200"
    interval            = 15
    healthy_threshold   = 2
    unhealthy_threshold = 4
  }

  deregistration_delay = 30
  tags                 = var.tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  # With a certificate, plain HTTP only redirects to HTTPS.
  dynamic "default_action" {
    for_each = var.certificate_arn == null ? [] : [1]
    content {
      type = "redirect"
      redirect {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }
  }

  dynamic "default_action" {
    for_each = var.certificate_arn == null ? [1] : []
    content {
      type             = "forward"
      target_group_arn = aws_lb_target_group.service["web"].arn
    }
  }
}

resource "aws_lb_listener" "https" {
  count = var.certificate_arn == null ? 0 : 1

  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.service["web"].arn
  }
}

# /api/* goes straight to the API; /metrics, /healthz and /readyz are not routed.
resource "aws_lb_listener_rule" "api" {
  for_each     = toset(var.certificate_arn == null ? ["http"] : ["http", "https"])
  listener_arn = each.key == "http" ? aws_lb_listener.http.arn : aws_lb_listener.https[0].arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.service["api"].arn
  }

  condition {
    path_pattern {
      values = ["/api/*"]
    }
  }
}

# ---------- tasks and services ----------
resource "aws_ecs_task_definition" "service" {
  for_each = local.services

  family                   = "${var.name}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = each.value.cpu
  memory                   = each.value.memory
  execution_role_arn       = aws_iam_role.execution.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = each.key
      image     = "${var.image_prefix}-${each.key}:${var.image_tag}"
      essential = true
      portMappings = [
        { containerPort = each.value.port, protocol = "tcp" }
      ]
      environment = [
        for key, value in(each.key == "web" ? {} : var.environment) : { name = key, value = value }
      ]
      secrets = [
        for key, arn in(each.key == "web" ? {} : var.secret_arns) : { name = key, valueFrom = arn }
      ]
      readonlyRootFilesystem = true
      linuxParameters        = { initProcessEnabled = true }
      healthCheck = {
        command  = ["CMD-SHELL", "wget -qO- http://127.0.0.1:${each.value.port}${each.value.health} >/dev/null || exit 1"]
        interval = 15
        timeout  = 5
        retries  = 4
      }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.service[each.key].name
          awslogs-region        = data.aws_region.current.region
          awslogs-stream-prefix = each.key
        }
      }
    }
  ])

  tags = var.tags
}

resource "aws_ecs_service" "service" {
  for_each = local.services

  name            = each.key
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.service[each.key].arn
  desired_count   = each.value.count
  launch_type     = "FARGATE"

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.service.id]
    assign_public_ip = false
  }

  dynamic "load_balancer" {
    for_each = each.value.balance ? [1] : []
    content {
      target_group_arn = aws_lb_target_group.service[each.key].arn
      container_name   = each.key
      container_port   = each.value.port
    }
  }

  depends_on = [aws_lb_listener.http]
  tags       = var.tags
}
