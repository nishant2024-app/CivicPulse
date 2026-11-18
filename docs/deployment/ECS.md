# AWS ECS alternative (not deployed)

`infrastructure/terraform/modules/ecs-service` describes the same three images on ECS Fargate
behind an Application Load Balancer, with `/api/*` routed to the API, logs in CloudWatch,
secrets from SSM/Secrets Manager and a deployment circuit breaker that rolls back failed
releases.

**It is never applied by this project.** Fargate, the load balancer and the NAT gateway the
tasks need are billed hourly and require an AWS account with a payment method; there is no free
tier that covers this workload. The module is validated in CI (`terraform validate`) so it stays
correct and reviewable, and the environment refuses to plan without an explicit opt-in:

```bash
terraform -chdir=infrastructure/terraform/environments/aws-ecs apply -var confirm_paid_resources=true ...
```

Use AWS's pricing calculator to estimate cost before doing that. Data services (RDS or Neon,
ElastiCache or Upstash, MSK or Aiven, OpenSearch Service or Aiven, S3) are configured through
the `extra_environment` and `secret_arns` variables, exactly as with the Helm `config` values.

Status: **configured, validated, not deployed.**
