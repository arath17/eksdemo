# Teardown

Destroy the infrastructure as soon as the demo is finished to avoid ongoing AWS charges.

## Option 1: GitHub Actions (Recommended)

1. Go to **Actions → Terraform → Run workflow**.
2. Select **destroy** as the action.
3. Run the workflow on the `main` branch.

This destroys:

- EKS cluster and managed node groups
- Network Load Balancer
- VPC, subnets, and internet gateway
- IAM roles and OIDC provider
- ECR repository
- Kubernetes namespace and secret created by Terraform

## Option 2: Local Terraform Destroy

If you prefer to run it from your machine:

```bash
cd terraform
terraform init -backend-config=backend.tfvars
terraform destroy -auto-approve
```

## Verify Cleanup

After destruction, check the AWS Console for any remaining resources:

1. **EKS**: no `eksdemo` cluster.
2. **EC2**: no running `t3a.medium` instances.
3. **Load Balancers**: no `eksdemo` NLB.
4. **VPC**: no `eksdemo` VPC.
5. **ECR**: the repository is also destroyed (`force_delete = true`).

## Cost After Teardown

The only remaining billable items are:

- S3 storage for Terraform state (usually <$0.01/month for a small state file).
- DynamoDB table for state locking (minimal cost with on-demand billing).

If you want to remove these too, delete the S3 bucket and DynamoDB table manually. Keep in mind this will delete your Terraform state history.
