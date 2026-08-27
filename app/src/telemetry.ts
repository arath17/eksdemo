import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-grpc';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';
import { ConsoleMetricExporter, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchLogRecordProcessor, ConsoleLogRecordExporter } from '@opentelemetry/sdk-logs';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
} from '@opentelemetry/semantic-conventions';

const isTest = process.env.NODE_ENV === 'test';
const serviceName = process.env.OTEL_SERVICE_NAME || 'eksdemo';
const serviceVersion = process.env.OTEL_SERVICE_VERSION || '1.0.0';
const deploymentEnvironment = process.env.OTEL_DEPLOYMENT_ENVIRONMENT || 'demo';
const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4317';
const metricExportIntervalMs = parseInt(
  process.env.OTEL_METRIC_EXPORT_INTERVAL || '60000',
  10
);

const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: serviceName,
  [ATTR_SERVICE_VERSION]: serviceVersion,
  [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: deploymentEnvironment,
  'datadog.log.source': 'node',
});

// Use console exporters in tests to avoid failed network calls to a missing collector.
const traceExporter = isTest
  ? new ConsoleSpanExporter()
  : new OTLPTraceExporter({ url: otlpEndpoint });
const metricExporter = isTest
  ? new ConsoleMetricExporter()
  : new OTLPMetricExporter({ url: otlpEndpoint });
const logExporter = isTest
  ? new ConsoleLogRecordExporter()
  : new OTLPLogExporter({ url: otlpEndpoint });

// Single NodeSDK owns traces, metrics, and logs so pipelines are consistent.
const sdk = new NodeSDK({
  resource,
  traceExporter,
  metricReader: new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: metricExportIntervalMs,
  }),
  instrumentations: [getNodeAutoInstrumentations()],
  logRecordProcessors: [new BatchLogRecordProcessor({ exporter: logExporter })],
});

sdk.start();

process.on('SIGTERM', () => {
  sdk.shutdown().finally(() => process.exit(0));
});

export { sdk, serviceName, serviceVersion, otlpEndpoint, deploymentEnvironment };
