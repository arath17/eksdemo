import { Router, Request, Response } from 'express';
import { trace } from '@opentelemetry/api';
import { logInfo } from '../logger';

const router = Router();
const tracer = trace.getTracer('eksdemo', '1.0.0');

function burnCpu(durationMs: number): void {
  const start = Date.now();
  while (Date.now() - start < durationMs) {
    // Perform a small amount of arithmetic to keep the CPU busy.
    Math.sqrt(Math.random() * Date.now());
  }
}

router.get('/load', (req: Request, res: Response) => {
  const duration = parseInt(req.query.duration as string, 10) || 5;
  const intensity = parseInt(req.query.intensity as string, 10) || 100;
  const clampedDuration = Math.min(Math.max(duration, 1), 30) * 1000;
  const clampedIntensity = Math.min(Math.max(intensity, 10), 1000);

  const span = tracer.startSpan('generate-load');
  span.setAttribute('load.duration_ms', clampedDuration);
  span.setAttribute('load.intensity', clampedIntensity);

  logInfo('Load endpoint called', {
    duration: clampedDuration,
    intensity: clampedIntensity,
  });

  try {
    const start = process.hrtime.bigint();
    burnCpu(clampedDuration);
    const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000;

    span.setAttribute('load.elapsed_ms', elapsed);
    span.setStatus({ code: 1 }); // OK

    res.status(200).json({
      status: 'ok',
      durationMs: clampedDuration,
      intensity: clampedIntensity,
      elapsedMs: elapsed,
    });
  } catch (error) {
    span.recordException(error as Error);
    span.setStatus({ code: 2 }); // ERROR
    res.status(500).json({ status: 'error', message: (error as Error).message });
  } finally {
    span.end();
  }
});

export default router;
