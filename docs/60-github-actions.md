# GitHub Actions

Three workflows automate the build, infrastructure, and deployment lifecycle. All AWS access uses OIDC federation, so no long-lived AWS credentials are stored in GitHub.

## Workflows

### 1. CI (`ci.yml`)

**Triggers**: push/PR to `main`.

**Steps**:

1. Check out code.
2. Set up Node.js 20.
3. Install dependencies.
4. Type-check the TypeScript code.
5. Build the application.
6. Run Jest unit tests.
7. Build the Docker image (no push).

### 2. Terraform (`terraform.yml`)

**Triggers**: push/PR to `main` when `terraform/**` changes, or manually via `workflow_dispatch`.

**Inputs** (for manual runs):

- `plan` — run `terraform plan`
- `apply` — run `terraform apply`
- `destroy` — run `terraform destroy`

**Steps**:

1. Configure AWS credentials via OIDC using `secrets.AWS_DEPLOY_ROLE_ARN`.
2. Set up Terraform 1.9.
3. Initialize with S3 backend.
4. Check formatting and validate.
5. Run plan/apply/destroy based on the trigger.

### 3. Deploy (`deploy.yml`)

**Triggers**: after a successful `Terraform` workflow run, or manually via `workflow_dispatch`.

**Steps**:

1. Configure AWS credentials via OIDC.
2. Log in to Amazon ECR.
3. Build and push the Docker image tagged with the Git commit SHA.
4. Set up `kubectl` and Helm.
5. Update kubeconfig for the EKS cluster.
6. Install/upgrade the OpenTelemetry Collector in the `monitoring` namespace.
7. Install/upgrade the `eksdemo` Helm release in the `default` namespace.
8. Verify pods, services, and HPA.

## Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `AWS_DEPLOY_ROLE_ARN` | IAM role ARN created by Terraform for GitHub Actions |
| `DD_API_KEY` | Datadog API key |
| `TF_BACKEND_BUCKET` | S3 bucket for Terraform state |
| `TF_BACKEND_DYNAMODB_TABLE` | DynamoDB table for Terraform state locking |

## Required GitHub Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AWS_REGION` | `us-east-1` | AWS region |
| `CLUSTER_NAME` | `eksdemo` | EKS cluster name |
| `DD_SITE` | `datadoghq.com` | Datadog site |

## OIDC Trust Relationship

The IAM role created by Terraform trusts only:

- The GitHub OIDC provider (`token.actions.githubusercontent.com`)
- Your specific repository (`repo:YOUR_ORG/YOUR_REPO:ref:refs/heads/main`)

This means pull requests from forks cannot assume the role, and only the `main` branch can deploy.

## Running Workflows Manually

1. Go to **Actions** in GitHub.
2. Select **Terraform** or **Deploy**.
3. Click **Run workflow**.
4. Choose the branch (`main`) and, for Terraform, the action (`plan`, `apply`, or `destroy`).
