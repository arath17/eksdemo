# Observability with OpenTelemetry and Datadog

This demo uses **OpenTelemetry** as the vendor-neutral instrumentation layer. The application emits logs, metrics, and traces via the OpenTelemetry Protocol (OTLP). An **OpenTelemetry Collector** running as a **DaemonSet** on every EKS node receives this telemetry, enriches it with Kubernetes attributes, and exports it to **Datadog**.

Because the application only speaks OTLP, switching to another backend later only requires changing the Collector configuration, not the application code.

## Architecture

```
Application Container (on each node)
        │
        │ OTLP (gRPC) on host port 4317
        ▼
OpenTelemetry Collector DaemonSet (monitoring namespace)
        │
        │ Datadog exporter
        ▼
Datadog (US1 — datadoghq.com)
```

The Collector runs in `daemonset` mode with `hostNetwork: true` so each pod sends telemetry to the collector on its own node via the node IP (`status.hostIP`).

## Application Instrumentation

`app/src/telemetry.ts` initializes the OpenTelemetry Node SDK with:

- `OTLPTraceExporter` — sends spans to the local Collector.
- `OTLPMetricExporter` — sends metrics to the local Collector.
- `OTLPLogExporter` — sends logs to the local Collector.
- `getNodeAutoInstrumentations()` — automatically instruments Express, HTTP, and other libraries.

The OTLP endpoint is not hard-coded; the Helm deployment injects it via the node's IP:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://$(HOST_IP):4317
```

The pod also sets `OTEL_RESOURCE_ATTRIBUTES=k8s.pod.ip=$(POD_IP)` so the Collector's `k8sattributes` processor can attach pod metadata.

Resource attributes attached to every signal:

- `service.name`
- `service.version`
- `deployment.environment`
- `datadog.log.source` — set to `node` so Datadog renders logs with the correct source.

### Custom Metrics

`app/src/routes/customMetrics.ts` creates an OpenTelemetry counter:

```typescript
const requestCounter = meter.createCounter('eksdemo.custom_requests.total', {
  description: 'Total number of requests to the custom metrics endpoint',
});
```

Every call to `/custom-metrics` increments this counter with `path` and `method` attributes.

### Logging

`app/src/logger.ts` uses the OpenTelemetry Logs API to emit structured logs:

```typescript
logger.emit({
  severityNumber: SeverityNumber.INFO,
  severityText: 'INFO',
  body: message,
  attributes,
});
```

## OpenTelemetry Collector

The Collector is installed from the official Helm chart using the values file at `helm/otel-collector/values.yaml`.

### Why a DaemonSet?

A DaemonSet places a Collector pod on every node. This avoids cross-node traffic, reduces the blast radius if one Collector restarts, and gives each Collector direct access to the pods running on its node for Kubernetes attribute enrichment.

### Collector Configuration

- **Receivers**: OTLP on gRPC (4317) and HTTP (4318), `hostmetrics`, and `prometheus` self-metrics.
- **Processors**:
  - `batch` — aligns batch sizes with Datadog intake limits.
  - `resource` — injects `environment` and `datadog.log.source`.
  - `k8sattributes` — enriches telemetry with pod, namespace, node, and deployment names.
- **Connectors**: `datadog/connector` computes APM stats from traces.
- **Exporters**: `datadog/exporter` with:
  - API key from the `eksdemo-datadog` Kubernetes secret.
  - Site from the same secret (`DD_SITE`).
  - A fixed `hostname` to avoid the known startup hostname-detection crash-loop bug.
  - `sending_queue.batch` recommended by Datadog instead of over-sized batch processor batches.
- **Pipelines**:
  - `traces`: `otlp` → `batch`/`k8sattributes`/`resource` → `datadog/connector`, `datadog/exporter`
  - `metrics`: `otlp`/`hostmetrics`/`prometheus`/`datadog/connector` → `batch`/`k8sattributes`/`resource` → `datadog/exporter`
  - `logs`: `otlp` → `batch`/`k8sattributes`/`resource` → `datadog/exporter`

The Datadog API key and site are stored in a Kubernetes secret created by the GitHub Actions `deploy.yml` workflow before the Collector is installed:

```bash
kubectl get secret eksdemo-datadog -n monitoring
```

## Datadog Configuration

Set these in GitHub secrets and variables:

| Name | Type | Value |
|------|------|-------|
| `DD_API_KEY` | Secret | Your Datadog API key |
| `DD_SITE` | Variable | `datadoghq.com` (or your Datadog site, e.g. `datadoghq.eu`) |

## Viewing Telemetry in Datadog

After the application is running:

1. **Traces**: Go to **APM → Traces** and search for `service:eksdemo`.
2. **Metrics**: Go to **Metrics → Summary** and search for `eksdemo.*`.
3. **Logs**: Go to **Logs → Search** and search for `service:eksdemo` or `source:node`.
4. **Infrastructure**: Go to **Infrastructure → Containers** to see Kubernetes pods.

## Troubleshooting

Check that the Collector DaemonSet is healthy:

```bash
kubectl get pods -n monitoring
kubectl logs -n monitoring daemonset/opentelemetry-collector --tail=100
```

Verify the secret has both fields:

```bash
kubectl get secret eksdemo-datadog -n monitoring -o jsonpath='{.data}'
```

Check that app pods are sending to the local collector:

```bash
kubectl exec deploy/eksdemo -- env | grep OTEL
```

Generate a custom metric and check the Collector logs for export confirmation:

```bash
curl http://$(kubectl get svc eksdemo -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')/custom-metrics
```

## Vendor Neutrality

To switch from Datadog to another OTLP-compatible backend:

1. Update `helm/otel-collector/values.yaml` to add the new exporter.
2. Change the pipeline exporters from `datadog/exporter` to the new exporter.
3. Redeploy the Collector.

The application code does not need to change.
