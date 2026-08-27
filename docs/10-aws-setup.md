# AWS Setup

This guide covers the one-time AWS setup needed before the first Terraform run. After this setup, all further infrastructure changes can be done through GitHub Actions.

## 1. Choose a Region

This project defaults to `us-east-1`. If you change it, also update:

- `terraform/variables.tf` default for `region`
- GitHub repository variable `AWS_REGION`
- Any example AZ lists in `terraform/variables.tf`

## 2. Create the Terraform Backend

Terraform needs an S3 bucket for state storage and a DynamoDB table for state locking.

### Create the S3 Bucket

```bash
export BUCKET_NAME="eksdemo-terraform-state-$(uuidgen | tr '[:upper:]' '[:lower:]')"
export AWS_REGION="us-east-1"

aws s3api create-bucket \
  --bucket $BUCKET_NAME \
  --region $AWS_REGION

aws s3api put-bucket-versioning \
  --bucket $BUCKET_NAME \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption \
  --bucket $BUCKET_NAME \
  --server-side-encryption-configuration '{
    "Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]
  }'
```

### Create the DynamoDB Lock Table

```bash
export LOCK_TABLE="eksdemo-terraform-locks"

aws dynamodb create-table \
  --table-name $LOCK_TABLE \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region $AWS_REGION
```

### Save the Backend Configuration

Copy the example backend file and fill in your values:

```bash
cp terraform/backend.tfvars.example terraform/backend.tfvars
```

Edit `terraform/backend.tfvars`:

```hcl
bucket         = "YOUR-TERRAFORM-STATE-BUCKET"
key            = "eksdemo/terraform.tfstate"
region         = "us-east-1"
dynamodb_table = "YOUR-TERRAFORM-LOCK-TABLE"
encrypt        = true
```

> Do **not** commit `terraform/backend.tfvars` to Git. It is already ignored by `.gitignore`.

## 3. Initial Terraform Run (Local)

The first Terraform apply must be done from your local machine because it creates the IAM OIDC provider and role that GitHub Actions needs. After this first run, the role ARN is saved and can be used by CI.

```bash
cd terraform

terraform init -backend-config=backend.tfvars

terraform plan -out=tfplan \
  -var="github_org=YOUR_GITHUB_USERNAME_OR_ORG" \
  -var="github_repo=YOUR_REPO_NAME"

terraform apply tfplan
```

After apply succeeds, note the outputs:

```bash
terraform output github_actions_role_arn
terraform output ecr_repository_url
terraform output cluster_name
```

## 4. Store Outputs in GitHub Secrets

1. Go to **Settings → Secrets and variables → Actions** in your GitHub repository.
2. Add the following **repository secrets**:

| Secret | Value |
|--------|-------|
| `AWS_DEPLOY_ROLE_ARN` | `terraform output github_actions_role_arn` |
| `DD_API_KEY` | Your Datadog API key |
| `TF_BACKEND_BUCKET` | Your S3 bucket name |
| `TF_BACKEND_DYNAMODB_TABLE` | Your DynamoDB table name |

3. Add the following **repository variables**:

| Variable | Value |
|----------|-------|
| `AWS_REGION` | `us-east-1` |
| `CLUSTER_NAME` | `eksdemo` |
| `DD_SITE` | `datadoghq.com` |

Now GitHub Actions can assume the deploy role via OIDC and manage the infrastructure.
