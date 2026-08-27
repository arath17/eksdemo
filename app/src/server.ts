import './telemetry';
import express, { Request, Response, NextFunction } from 'express';
import healthRouter from './routes/health';
import customMetricsRouter from './routes/customMetrics';
import loadRouter from './routes/load';
import { logInfo, logError } from './logger';

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// Request logging middleware.
app.use((req: Request, _res: Response, next: NextFunction) => {
  logInfo('Incoming request', {
    method: req.method,
    path: req.path,
    query: JSON.stringify(req.query),
  });
  next();
});

app.use('/', healthRouter);
app.use('/', customMetricsRouter);
app.use('/', loadRouter);

app.get('/', (req: Request, res: Response) => {
  logInfo('Root endpoint called', { method: req.method });
  res.json({
    service: 'eksdemo',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      customMetrics: '/custom-metrics',
      load: '/load?duration=5&intensity=100',
    },
  });
});

// Error handler.
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logError('Unhandled error', { message: err.message });
  res.status(500).json({ status: 'error', message: err.message });
});

const server = app.listen(port, () => {
  logInfo('Server started', { port });
  console.log(`eksdemo listening on port ${port}`);
});

export { app, server };
