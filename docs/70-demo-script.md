# Demo Script

This script walks through the demo step by step. Run it just before your demo and destroy the stack immediately after.

## Pre-Demo Checklist

- [ ] Datadog API key is active.
- [ ] GitHub secrets and variables are configured.
- [ ] Terraform backend (S3 + DynamoDB) is created.
- [ ] First local Terraform apply created the OIDC role.
- [ ] `AWS_DEPLOY_ROLE_ARN` secret is set in GitHub.

## Step 1: Provision Infrastructure

Go to **Actions → Terraform → Run workflow** and select **apply**.

Wait for the workflow to complete (5–10 minutes).

## Step 2: Deploy the Application

Go to **Actions → Deploy → Run workflow**.

Wait for the workflow to complete (3–5 minutes).

## Step 3: Get the Load Balancer URL

```bash
aws eks update-kubeconfig --region us-east-1 --name eksdemo

export LB=$(kubectl get svc eksdemo -n default -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
echo "http://$LB"
```

Wait 30–60 seconds for the NLB hostname to resolve, then open it in a browser.

## Step 4: Show the Browser Endpoint

Open the URL in a browser. You should see:

```json
{
  "service": "eksdemo",
  "version": "1.0.0",
  "endpoints": {
    "health": "/health",
    "customMetrics": "/custom-metrics",
    "load": "/load?duration=5&intensity=100"
  }
}
```

## Step 5: Health Check

```bash
curl "http://$LB/health"
```

Expected output:

```json
{ "status": "ok", "service": "eksdemo", "timestamp": "..." }
```

## Step 6: Custom Metrics

```bash
curl "http://$LB/custom-metrics"
```

This increments a custom OpenTelemetry counter.

## Step 7: HPA Scaling Demo

Open one terminal to watch the HPA:

```bash
kubectl get hpa eksdemo -n default -w
```

Open another terminal to generate load:

```bash
while true; do curl "http://$LB/load?duration=5&intensity=100"; echo; done
```

Within 1–2 minutes, the HPA should scale the deployment from 1 to multiple pods.

## Step 8: Observability in Datadog

Open Datadog and show:

1. **APM → Traces**: filter by `service:eksdemo`.
2. **Metrics → Summary**: search for `eksdemo.custom_requests.total`.
3. **Logs → Search**: filter by `service:eksdemo`.
4. **Infrastructure → Containers**: show the running `eksdemo` pods.

## Step 9: Cleanup

Go to **Actions → Terraform → Run workflow** and select **destroy**.

Alternatively, run locally:

```bash
cd terraform
terraform destroy -auto-approve
```

Confirm in the AWS Console that the EKS cluster, NLB, and EC2 instances are gone.
