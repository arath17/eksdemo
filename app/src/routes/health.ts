import { Router, Request, Response } from 'express';
import { logInfo } from '../logger';

const router = Router();

router.get('/health', (req: Request, res: Response) => {
  logInfo('Health endpoint called', {
    method: req.method,
    path: req.path,
    userAgent: req.get('user-agent') || 'unknown',
  });

  res.status(200).json({
    status: 'ok',
    service: 'eksdemo',
    timestamp: new Date().toISOString(),
  });
});

export default router;
