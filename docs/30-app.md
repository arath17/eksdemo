# Application

The application is a small Node.js/TypeScript HTTP service built with Express. It is instrumented with OpenTelemetry so it emits traces, metrics, and logs via the OpenTelemetry Protocol (OTLP).

## Directory Layout

```
app/
├── src/
│   ├── server.ts              # Express server setup
│   ├── telemetry.ts           # OpenTelemetry SDK initialization
│   ├── logger.ts              # OTLP log helper
│   └── routes/
│       ├── health.ts          # Health check endpoint
│       ├── customMetrics.ts   # Custom metrics endpoint
│       └── load.ts            # CPU load endpoint for HPA demo
├── tests/
│   └── app.test.ts            # Jest unit tests
├── package.json
├── tsconfig.json
├── jest.config.js
├── Dockerfile
└── .dockerignore
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Service info and endpoint list |
| GET | `/health` | Returns `{ status: "ok" }` |
| GET | `/custom-metrics` | Increments a custom OTel counter |
| GET | `/load` | Burns CPU for HPA scaling demo |

### `/load` Parameters

- `duration` — number of seconds (default: 5, min: 1, max: 30)
- `intensity` — loop iterations factor (default: 100, min: 10, max: 1000)

Example:

```bash
curl "http://LOAD_BALANCER_HOST/load?duration=10&intensity=100"
```

## OpenTelemetry Instrumentation

The app uses the OpenTelemetry Node SDK (`src/telemetry.ts`):

- **Traces**: `OTLPTraceExporter` over gRPC
- **Metrics**: `OTLPMetricExporter` with a periodic reader
- **Logs**: `OTLPLogExporter` through the OpenTelemetry Logs API
- **Auto-instrumentations**: HTTP and Express request tracing

The OTLP endpoint is configured through the environment variable `OTEL_EXPORTER_OTLP_ENDPOINT`. In Kubernetes, this points to the OpenTelemetry Collector service.

## Local Development

```bash
cd app
npm install
npm run dev
```

Run tests:

```bash
npm test
```

Build the production bundle:

```bash
npm run build
```

## Docker

Build locally:

```bash
cd app
docker build -t eksdemo:latest .
```

Run locally:

```bash
docker run -p 3000:3000 eksdemo:latest
```

The Dockerfile uses a multi-stage build:

1. **Builder stage**: installs dependencies and compiles TypeScript to `dist/`.
2. **Production stage**: copies only `package*.json`, production dependencies, and `dist/`. Runs as the unprivileged `node` user.
