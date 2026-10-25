import * as express from 'express';
import * as request from 'supertest';
import { httpsEnforcement, isLoopback, HEALTH_PATH } from './https-enforcement';

function appWith(trustProxy: boolean) {
  const app = express();
  if (trustProxy) app.set('trust proxy', 1);
  app.use(httpsEnforcement());
  app.get(HEALTH_PATH, (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/v1/invoices', (_req, res) => res.json({ ok: true }));
  app.post('/api/v1/auth/login', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('httpsEnforcement', () => {
  describe('without TRUST_PROXY (trust proxy off)', () => {
    const app = appWith(false);

    it('refuses a plain-HTTP POST', async () => {
      await request(app).post('/api/v1/auth/login').expect(403);
    });

    it('refuses a plain-HTTP POST that claims X-Forwarded-Proto: https (header not trusted)', async () => {
      // Regression: the previous inline middleware read the header directly and let this through.
      await request(app).post('/api/v1/auth/login').set('X-Forwarded-Proto', 'https').expect(403);
    });

    it('redirects a plain-HTTP GET to HTTPS, even with a spoofed header', async () => {
      const res = await request(app).get('/api/v1/invoices').set('X-Forwarded-Proto', 'https').expect(301);
      expect(res.headers.location).toMatch(/^https:\/\/.+\/api\/v1\/invoices$/);
    });

    it('serves the health route over plain HTTP to a loopback client', async () => {
      await request(app).get(HEALTH_PATH).expect(200, { status: 'ok' });
    });

    it('does not exempt other methods on the health route', async () => {
      await request(app).post(HEALTH_PATH).expect(403);
    });
  });

  describe('with TRUST_PROXY=true (trust proxy 1)', () => {
    const app = appWith(true);

    it('accepts requests the trusted proxy marks as HTTPS', async () => {
      await request(app).post('/api/v1/auth/login').set('X-Forwarded-Proto', 'https').expect(200);
      await request(app).get('/api/v1/invoices').set('X-Forwarded-Proto', 'https').expect(200);
    });

    it('still refuses requests the proxy marks as plain HTTP', async () => {
      await request(app).post('/api/v1/auth/login').set('X-Forwarded-Proto', 'http').expect(403);
    });
  });

  it('redirects a health request from a non-loopback client', () => {
    const redirect = jest.fn();
    const next = jest.fn();
    const req: any = { secure: false, method: 'GET', path: HEALTH_PATH, originalUrl: HEALTH_PATH, headers: { host: 'pos.local' }, socket: { remoteAddress: '10.0.0.5' } };
    httpsEnforcement()(req, { redirect } as any, next);
    expect(next).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith(301, `https://pos.local${HEALTH_PATH}`);
  });

  it('recognises only loopback addresses', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopback('10.0.0.5')).toBe(false);
    expect(isLoopback('::ffff:10.0.0.5')).toBe(false);
    expect(isLoopback(undefined)).toBe(false);
  });
});
