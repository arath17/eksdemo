import request from 'supertest';
import { app, server } from '../src/server';
import { sdk } from '../src/telemetry';

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await sdk.shutdown();
});

describe('eksdemo routes', () => {
  it('GET / returns service info', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.service).toBe('eksdemo');
    expect(res.body.endpoints).toHaveProperty('health');
  });

  it('GET /health returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('eksdemo');
  });

  it('GET /custom-metrics increments counter', async () => {
    const res = await request(app).get('/custom-metrics');
    expect(res.status).toBe(200);
    expect(res.body.metric).toBe('eksdemo.custom_requests.total');
  });

  it('GET /load burns CPU and returns elapsed time', async () => {
    const res = await request(app).get('/load?duration=1&intensity=10');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.elapsedMs).toBeGreaterThan(0);
  });
});
