# Terraform Infrastructure

This project uses Terraform to provision all AWS infrastructure: VPC, EKS cluster, IAM roles, ECR repository, and the Kubernetes resources needed for observability.

## Directory Layout

```
terraform/
├── backend.tfvars.example      # Example backend configuration
├── main.tf                     # Root module wiring
├── outputs.tf                  # Terraform outputs
├── variables.tf                # Input variables
├── versions.tf                 # Provider versions and backend
└── modules/
    ├── vpc/                    # VPC and public subnets
    ├── eks/                    # EKS cluster and node group
    ├── iam/                    # OIDC provider and GitHub Actions role
    └── ecr/                    # Elastic Container Registry repository
```

## Modules

### VPC (`modules/vpc`)

Uses the official `terraform-aws-modules/vpc/aws` module.

- Creates a VPC with the CIDR from `var.vpc_cidr`.
- Creates public subnets in two availability zones.
- Enables DNS hostnames and support.
- Does **not** create NAT gateways (cost optimization).
- Maps public IPs on launch so nodes get public IPs.

### ECR (`modules/ecr`)

Creates an ECR repository named after the project with:

- Image scanning on push
- A lifecycle policy keeping the last 30 images
- `force_delete = true` so the repository can be destroyed without manual cleanup

### EKS (`modules/eks`)

Uses the official `terraform-aws-modules/eks/aws` module.

- Creates an EKS cluster with the version from `var.cluster_version`.
- Uses public subnets only.
- Creates one managed node group:
  - Instance type: `t3a.medium` (configurable)
  - Capacity type: `SPOT` by default (cheapest)
  - Min/desired/max: 1/1/2 by default
- Grants the GitHub Actions role cluster admin access through EKS access entries.
- Installs the `metrics-server` EKS add-on, required for HorizontalPodAutoscaler.

### IAM (`modules/iam`)

- Creates the GitHub OIDC provider (`token.actions.githubusercontent.com`).
- Creates an IAM role (`eksdemo-github-actions`) that can be assumed by GitHub Actions.
- Trust policy restricts access to:
  - Your GitHub organization/user
  - Your repository
  - Your chosen branch (`main` by default)
- Attaches policies for:
  - ECR push/pull
  - EKS describe/list
  - Terraform state S3/DynamoDB access

## Root Module Resources

In addition to the modules, `main.tf` creates:

- The `metrics-server` EKS add-on (required for HPA).

## Common Commands

### Plan

```bash
cd terraform
terraform init -backend-config=backend.tfvars
terraform plan -var="github_org=YOUR_ORG" -var="github_repo=YOUR_REPO"
```

### Apply

```bash
terraform apply -var="github_org=YOUR_ORG" -var="github_repo=YOUR_REPO"
```

### Destroy

```bash
terraform destroy -var="github_org=YOUR_ORG" -var="github_repo=YOUR_REPO"
```

> Destroying also removes the EKS cluster, nodes, load balancer, and ECR repository. This stops all AWS charges for this project.

## Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `region` | `us-east-1` | AWS region |
| `cluster_name` | `eksdemo` | EKS cluster name |
| `cluster_version` | `1.30` | Kubernetes version |
| `node_instance_types` | `["t3a.medium"]` | Worker node instance types |
| `node_capacity_type` | `SPOT` | SPOT or ON_DEMAND |
| `node_min_size` | `1` | Minimum nodes |
| `node_max_size` | `2` | Maximum nodes |
| `node_desired_size` | `1` | Desired nodes |
| `github_org` | required | GitHub organization or user |
| `github_repo` | required | GitHub repository name |
| `create_github_oidc_provider` | `false` | Set to `true` only if the GitHub OIDC provider does not already exist in the AWS account |
| `backend_bucket` | required | S3 state bucket |
| `backend_dynamodb_table` | required | DynamoDB lock table |
