import request from 'supertest';
import app from './app';

describe('app (integration)', () => {
    it('GET /health returns 200 with { status: "ok" } and an X-Request-Id header', async () => {
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: 'ok' });
        expect(res.headers['x-request-id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('produces a different X-Request-Id for each request', async () => {
        const a = await request(app).get('/health');
        const b = await request(app).get('/health');
        expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id']);
    });
});
