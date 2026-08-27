#!/usr/bin/env bash
# One-off teardown script for the EKS demo.
# Run from Git Bash / WSL / macOS terminal.
#
# Usage:
#   ./teardown.sh
#   ./teardown.sh <LOCK_ID>   # if Terraform state is still locked
#
# Set CLUSTER_NAME or AWS_REGION env vars to override defaults.

set -euo pipefail

CLUSTER_NAME="${CLUSTER_NAME:-eksdemo}"
REGION="${AWS_REGION:-us-east-1}"
ROOT_ARN="arn:aws:iam::330197892447:root"

LOCK_ID="${1:-}"

echo "=== Re-adding root cluster access (if needed) ==="
aws eks create-access-entry \
  --cluster-name "$CLUSTER_NAME" \
  --principal-arn "$ROOT_ARN" \
  --region "$REGION" || true

aws eks associate-access-policy \
  --cluster-name "$CLUSTER_NAME" \
  --principal-arn "$ROOT_ARN" \
  --policy-arn arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy \
  --access-scope type=cluster \
  --region "$REGION" || true

aws eks update-kubeconfig --region "$REGION" --name "$CLUSTER_NAME"

echo "=== Uninstalling Helm releases (releases cloud-provider NLB/ELBs) ==="
helm uninstall eksdemo --namespace default || true
helm uninstall opentelemetry-collector --namespace monitoring || true

echo "=== Initializing Terraform ==="
cd terraform
terraform init -backend-config=backend.tfvars

if [[ -n "$LOCK_ID" ]]; then
  echo "=== Force-unlocking state with ID: $LOCK_ID ==="
  terraform force-unlock -force "$LOCK_ID"
fi

echo "=== Destroying Terraform-managed infrastructure ==="
terraform destroy -auto-approve

echo "=== Teardown complete ==="
echo "If any resources remain, check the AWS Console for:"
echo "  - EKS clusters, EC2 instances, Load balancers, VPCs, ECR repositories"
echo "S3 state bucket and DynamoDB lock table are intentionally preserved."
