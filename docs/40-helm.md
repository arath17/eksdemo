# Helm Chart

The application is packaged as a Helm chart under `helm/eksdemo`. Helm renders Kubernetes manifests from templates and values files.

## Chart Structure

```
helm/eksdemo/
├── Chart.yaml
├── values.yaml
├── values-production.yaml
└── templates/
    ├── _helpers.tpl           # Reusable template snippets
    ├── deployment.yaml        # Application Deployment
    ├── service.yaml           # LoadBalancer Service (NLB)
    ├── hpa.yaml               # HorizontalPodAutoscaler
    ├── serviceaccount.yaml    # ServiceAccount
    ├── secret.yaml            # Optional Datadog secret
    └── NOTES.txt              # Post-install instructions
```

## Templates

### Deployment

- Runs the `eksdemo` container on port `3000`.
- Sets OTLP environment variables.
- Defines liveness and readiness probes on `/health`.
- Applies resource requests/limits (`100m` CPU request, `500m` limit).

### Service

- Type `LoadBalancer`.
- Annotated to create an AWS Network Load Balancer (NLB).
- Internet-facing so it can be reached from a browser.
- Maps port `80` to container port `3000`.

### HorizontalPodAutoscaler

- Targets the `eksdemo` Deployment.
- Scales between `1` and `10` replicas.
- Targets `50%` average CPU utilization.
- Optional memory target at `70%`.

## Values Files

- `values.yaml` — defaults for local development and CI validation.
- `values-production.yaml` — overrides for the EKS demo, including ECR image repository.

## Installing the Chart

During normal development, the GitHub Actions `deploy.yml` workflow installs the chart automatically. To install manually:

```bash
helm upgrade --install eksdemo ./helm/eksdemo \
  --namespace default \
  --set image.repository=YOUR_ECR_REPO_URL \
  --set image.tag=YOUR_IMAGE_TAG
```

## Verifying the Deployment

```bash
kubectl get pods -n default
kubectl get svc -n default
kubectl get hpa -n default
```

Get the load balancer URL:

```bash
kubectl get svc eksdemo -n default -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
```

## HPA Demo

Trigger load to make the HPA scale the deployment:

```bash
export LB=$(kubectl get svc eksdemo -n default -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')

# Single request
curl "http://$LB/load?duration=10&intensity=100"

# Continuous load in multiple terminals
while true; do curl "http://$LB/load?duration=5&intensity=100"; done
```

Watch HPA scale pods:

```bash
kubectl get hpa eksdemo -n default -w
kubectl get pods -n default -w
```
