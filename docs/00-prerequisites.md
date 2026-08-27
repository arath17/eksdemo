# Prerequisites

Before you can build, deploy, or demo this application, you need the following accounts, tools, and access.

## Accounts

1. **GitHub account** with a repository for this project.
2. **AWS account** with permissions to create:
   - VPC, subnets, internet gateway
   - EKS cluster and managed node groups
   - IAM roles and OIDC providers
   - ECR repositories
   - S3 buckets and DynamoDB tables
3. **Datadog account** (trial or existing) with an API key.

## Local Tools

Install these on your workstation:

| Tool | Purpose | Suggested Version |
|------|---------|-------------------|
| `git` | Source control | latest |
| `node` + `npm` | Application development | 20 LTS |
| `docker` | Container image builds | latest |
| `kubectl` | Kubernetes cluster interaction | 1.30+ |
| `helm` | Kubernetes package management | 3.15+ |
| `terraform` | Infrastructure provisioning | 1.9+ |
| `aws-cli` | AWS API access | 2.x |

Verify installations:

```bash
node --version    # v20.x
npm --version
docker --version
kubectl version --client
helm version
terraform -version
aws --version
```

## AWS CLI Configuration

Configure AWS credentials locally for the initial bootstrap step. This is only needed once to create the Terraform backend and OIDC role. All later access is through GitHub Actions OIDC.

```bash
aws configure
# Enter your AWS Access Key ID, Secret Access Key, and default region (us-east-1)
```

If you use SSO or temporary credentials, ensure the current shell session has valid credentials before running Terraform locally.

## GitHub Repository Settings

1. Create a new repository on GitHub (public or private).
2. Push this project to the `main` branch.
3. You will add repository secrets and variables in `docs/60-github-actions.md`.

## Cost Warning

Running this project on real AWS EKS costs roughly **$0.15–$0.20 per hour**. The EKS control plane ($0.10/hr) is billed even when no worker nodes exist. Create the cluster just before your demo and destroy it immediately after to minimize cost.
