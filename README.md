# EKS Demo Application

A minimal Node.js/TypeScript service running on Amazon EKS, deployed with Helm, autoscaled with HPA, and observable with OpenTelemetry → Datadog.

## Stack

- **Runtime**: Node.js 20 + TypeScript + Express
- **Container**: Docker multi-stage build + Amazon ECR
- **Orchestration**: Amazon EKS 1.30
- **Packaging**: Helm 3
- **Autoscaling**: Kubernetes HPA
- **Observability**: OpenTelemetry (OTLP) → OpenTelemetry Collector → Datadog
- **Infrastructure**: Terraform 1.9+
- **CI/CD**: GitHub Actions with OIDC federation to AWS

## Quick Start

1. See `docs/00-prerequisites.md` for required tools and accounts.
2. See `docs/10-aws-setup.md` to bootstrap the Terraform backend.
3. Push to `main` or run the GitHub Actions workflows to provision infrastructure and deploy.
4. See `docs/70-demo-script.md` for the demo flow.
5. See `docs/80-teardown.md` to destroy everything.

## Documentation

All documentation lives in `docs/`:

- `00-prerequisites.md` — tools, accounts, limits
- `10-aws-setup.md` — bootstrapping S3/DynamoDB, OIDC, ECR
- `20-terraform.md` — Terraform layout, variables, commands
- `30-app.md` — application structure, routes, local development
- `40-helm.md` — Helm chart, HPA, service
- `50-observability.md` — OpenTelemetry configuration and Datadog views
- `60-github-actions.md` — workflows, OIDC, secrets
- `70-demo-script.md` — step-by-step demo checklist
- `80-teardown.md` — cleanup instructions

## Cost Notice

Running this on real AWS EKS costs roughly **$0.15–$0.20 per hour** (EKS control plane + one Spot worker + NLB). Create the cluster just before the demo and destroy it immediately after to minimize cost.
