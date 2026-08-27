# Observability with OpenTelemetry and Datadog

This demo uses **OpenTelemetry** as the vendor-neutral instrumentation layer. The application emits logs, metrics, and traces via the OpenTelemetry Protocol (OTLP). An **OpenTelemetry Collector** receives this telemetry and exports it to **Datadog**.

Because the application only speaks OTLP, switching to another backend later only requires changing the Collector configuration, not the application code.

## Architecture

```
Application Container
        │
        │ OTLP (gRPC) on port 4317
        ▼
OpenTelemetry Collector (monitoring namespace)
        │
        │ Datadog exporter
        ▼
Datadog (US1 — datadoghq.com)
```

## Application Instrumentation

`app/src/telemetry.ts` initializes the OpenTelemetry Node SDK with:

- `OTLPTraceExporter` — sends spans to the Collector.
- `OTLPMetricExporter` — sends metrics to the Collector.
- `OTLPLogExporter` — sends logs to the Collector.
- `getNodeAutoInstrumentations()` — automatically instruments Express, HTTP, and other libraries.

The OTLP endpoint is configured through the environment variable:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://opentelemetry-collector.monitoring.svc.cluster.local:4317
```

### Custom Metrics

`app/src/routes/customMetrics.ts` creates an OpenTelemetry counter:

```typescript
const requestCounter = meter.createCounter('eksdemo.custom_requests.total', {
  description: 'Total number of requests to the custom metrics endpoint',
});
```

Every call to `/custom-metrics` increments this counter with attributes.

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

### Collector Configuration

- **Receivers**: OTLP on gRPC (4317) and HTTP (4318).
- **Processors**: `batch` and `resource` (adds `environment: demo`).
- **Exporters**: `datadog` with API key from the `eksdemo-datadog` Kubernetes secret.
- **Pipelines**: separate pipelines for traces, metrics, and logs.

The Datadog API key is stored in a Kubernetes secret created by the GitHub Actions `deploy.yml` workflow before the Collector is installed:

```bash
kubectl get secret eksdemo-datadog -n monitoring
```

## Datadog Configuration

Set these in GitHub secrets and variables:

| Name | Type | Value |
|------|------|-------|
| `DD_API_KEY` | Secret | Your Datadog API key |
| `DD_SITE` | Variable | `datadoghq.com` |

## Viewing Telemetry in Datadog

After the application is running:

1. **Traces**: Go to **APM → Traces** and search for `service:eksdemo`.
2. **Metrics**: Go to **Metrics → Summary** and search for `eksdemo.*`.
3. **Logs**: Go to **Logs → Search** and search for `service:eksdemo`.
4. **Infrastructure**: Go to **Infrastructure → Containers** to see Kubernetes pods.

## Vendor Neutrality

To switch from Datadog to another OTLP-compatible backend:

1. Update `helm/otel-collector/values.yaml` to add the new exporter.
2. Change the pipeline exporters from `datadog` to the new exporter.
3. Redeploy the Collector.

The application code does not need to change.
