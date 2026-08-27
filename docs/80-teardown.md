# Teardown

Destroy the infrastructure as soon as the demo is finished to avoid ongoing AWS charges.

> **Do not use GitHub Actions for destroy.** The CI role (`eksdemo-github-actions`) is managed by the same Terraform state it would be destroying. Terraform destroys IAM before EKS, so the role disappears mid-run and the workflow fails. Use the local teardown script instead.

## One-off teardown script

From the repo root, run:

```bash
./teardown.sh
```

If the previous run left the Terraform state locked, pass the lock ID from the error:

```bash
./teardown.sh 0f600b1b-561c-8c6f-0f66-89389eec5f8a
```

The script will:

1. Re-add the root account's EKS access entry (so kubectl can reach the cluster).
2. Update kubeconfig.
3. Uninstall the Helm releases (`eksdemo` and `opentelemetry-collector`), releasing the Network Load Balancer and any cloud-provider-managed resources.
4. Initialize Terraform.
5. Run `terraform destroy -auto-approve`.

You can override the defaults with environment variables:

```bash
CLUSTER_NAME=mycluster AWS_REGION=us-west-2 ./teardown.sh
```

## Manual steps (if you prefer)

```bash
aws eks create-access-entry --cluster-name eksdemo --principal-arn arn:aws:iam::330197892447:root --region us-east-1
aws eks associate-access-policy --cluster-name eksdemo --principal-arn arn:aws:iam::330197892447:root --policy-arn arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy --access-scope type=cluster --region us-east-1
aws eks update-kubeconfig --region us-east-1 --name eksdemo

helm uninstall eksdemo
helm uninstall opentelemetry-collector -n monitoring

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
