import { Router, Request, Response } from 'express';
import { metrics } from '@opentelemetry/api';
import { logInfo } from '../logger';

const router = Router();
const meter = metrics.getMeter('eksdemo', '1.0.0');
const requestCounter = meter.createCounter('eksdemo.custom_requests.total', {
  description: 'Total number of requests to the custom metrics endpoint',
});

router.get('/custom-metrics', (req: Request, res: Response) => {
  requestCounter.add(1, { path: req.path, method: req.method });

  logInfo('Custom metrics endpoint called', {
    method: req.method,
    path: req.path,
  });

  res.status(200).json({
    status: 'ok',
    metric: 'eksdemo.custom_requests.total',
    value: 'incremented',
  });
});

export default router;
