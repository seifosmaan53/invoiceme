import * as express from 'express';
import * as request from 'supertest';
import { httpsEnforcement, isLoopback, trustProxySetting, HEALTH_PATH } from './https-enforcement';

/** An express app wired like main.ts: TRUST_PROXY parsed, then HTTPS enforcement. */
function appWith(trustProxyEnv: string | undefined) {
  const app = express();
  const trust = trustProxySetting(trustProxyEnv);
  if (trust) app.set('trust proxy', trust);
  app.use(httpsEnforcement());
  app.get(HEALTH_PATH, (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/v1/invoices', (req, res) => res.json({ ok: true, ip: req.ip }));
  app.post('/api/v1/auth/login', (req, res) => res.json({ ok: true, ip: req.ip }));
  return app;
}

describe('trustProxySetting', () => {
  it('maps TRUST_PROXY to an explicit Express trust value', () => {
    expect(trustProxySetting(undefined)).toBeUndefined();
    expect(trustProxySetting('')).toBeUndefined();
    expect(trustProxySetting('false')).toBeUndefined();
    expect(trustProxySetting('true')).toBe('loopback');
    expect(trustProxySetting('10.0.0.5')).toBe('10.0.0.5');
    expect(trustProxySetting('loopback, 192.168.1.0/24')).toBe('loopback, 192.168.1.0/24');
  });

  it('rejects hop counts, which trust whatever peer connects directly', () => {
    expect(() => trustProxySetting('1')).toThrow(/hop count/);
  });
});

describe('httpsEnforcement', () => {
  describe('TRUST_PROXY unset: a direct client (here on loopback) cannot claim HTTPS', () => {
    const app = appWith(undefined);

    it('refuses a plain-HTTP POST', async () => {
      await request(app).post('/api/v1/auth/login').expect(403);
    });

    it('refuses a plain-HTTP POST that claims X-Forwarded-Proto: https', async () => {
      // Regression: the original inline middleware read the header directly and let this through.
      await request(app).post('/api/v1/auth/login').set('X-Forwarded-Proto', 'https').expect(403);
    });

    it('redirects a plain-HTTP GET to HTTPS, even with a spoofed header', async () => {
      const res = await request(app).get('/api/v1/invoices').set('X-Forwarded-Proto', 'https').expect(301);
      expect(res.headers.location).toMatch(/^https:\/\/.+\/api\/v1\/invoices$/);
    });

    it('serves the health route to a local client without forwarding headers', async () => {
      await request(app).get(HEALTH_PATH).expect(200, { status: 'ok' });
    });

    it('does not exempt health requests relayed by a same-machine proxy (forwarding headers present)', async () => {
      await request(app).get(HEALTH_PATH).set('X-Forwarded-For', '203.0.113.9').expect(301);
      await request(app).get(HEALTH_PATH).set('X-Forwarded-Proto', 'http').expect(301);
      await request(app).get(HEALTH_PATH).set('Forwarded', 'for=203.0.113.9').expect(301);
    });

    it('does not exempt other methods on the health route', async () => {
      await request(app).post(HEALTH_PATH).expect(403);
    });
  });

  describe('TRUST_PROXY=true (loopback proxy only)', () => {
    const app = appWith('true');

    it('accepts requests the local proxy marks as HTTPS and takes the client address from it', async () => {
      const res = await request(app).post('/api/v1/auth/login').set('X-Forwarded-Proto', 'https').set('X-Forwarded-For', '198.51.100.7').expect(200);
      expect(res.body.ip).toBe('198.51.100.7');
    });

    it('uses the value the proxy appended, not one the client sent', async () => {
      // client sent "https", proxy appended the real scheme "http"
      await request(app).post('/api/v1/auth/login').set('X-Forwarded-Proto', 'https, http').expect(403);
      // client sent "http", proxy appended "https"
      await request(app).post('/api/v1/auth/login').set('X-Forwarded-Proto', 'http, https').expect(200);
    });

    it('refuses requests the proxy marks as plain HTTP', async () => {
      await request(app).post('/api/v1/auth/login').set('X-Forwarded-Proto', 'http').expect(403);
    });
  });

  describe('TRUST_PROXY names a remote proxy: a direct client is not trusted', () => {
    const app = appWith('10.255.0.1');

    it('ignores X-Forwarded-Proto and X-Forwarded-For from a peer that is not the named proxy', async () => {
      await request(app).post('/api/v1/auth/login').set('X-Forwarded-Proto', 'https').set('X-Forwarded-For', '8.8.8.8').expect(403);
      const res = await request(app)
        .get('/api/v1/invoices')
        .set('X-Forwarded-Proto', 'https')
        .set('X-Forwarded-For', '8.8.8.8')
        .expect(301);
      expect(res.headers.location).toMatch(/^https:/);
    });
  });

  it('redirects a health request from a non-loopback client', () => {
    const redirect = jest.fn();
    const next = jest.fn();
    const req: any = {
      method: 'GET',
      path: HEALTH_PATH,
      originalUrl: HEALTH_PATH,
      headers: { host: 'pos.local' },
      socket: { remoteAddress: '10.0.0.5' },
      app: { get: () => undefined },
    };
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

describe('known flaws (trusted-proxy policy and redirect target)', () => {
  it('req.secure agrees with HTTPS enforcement for a multi-value X-Forwarded-Proto', async () => {
    // client sent "https", the trusted same-machine proxy appended the real "http"
    const app = express();
    app.set('trust proxy', trustProxySetting('true'));
    app.get('/probe', (req, res) => res.json({ secure: req.secure, protocol: req.protocol }));
    const res = await request(app).get('/probe').set('X-Forwarded-Proto', 'https, http').expect(200);
    expect(res.body).toEqual({ secure: false, protocol: 'http' });
  });

  it('never builds a redirect Location from an arbitrary Host header', async () => {
    const app = appWith(undefined);
    const res = await request(app).get('/api/v1/invoices').set('Host', 'evil.example');
    expect(res.headers.location ?? '').not.toContain('evil.example');
  });
});
