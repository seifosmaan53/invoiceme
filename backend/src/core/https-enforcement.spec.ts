import * as express from 'express';
import * as request from 'supertest';
import * as proxyaddr from 'proxy-addr';
import {
  applyHttpSecurity,
  applyTrustedProxyPolicy,
  clientIp,
  forwardedHops,
  httpsEnforcement,
  httpsRedirectPolicy,
  isLoopback,
  isSecureRequest,
  trustProxySetting,
  HEALTH_PATH,
  HttpSecurityEnv,
} from './https-enforcement';

const HTTPS_REQUIRED = {
  error: 'HTTPS required',
  message: 'This application requires HTTPS. Please use HTTPS to access the API.',
};

/** An express app wired like main.ts (production): trusted-proxy policy, then HTTPS enforcement. */
function appWith(trustProxyEnv: string | undefined, env: Omit<HttpSecurityEnv, 'TRUST_PROXY' | 'NODE_ENV'> = {}) {
  const app = express();
  applyHttpSecurity(app, { NODE_ENV: 'production', TRUST_PROXY: trustProxyEnv, ...env });
  app.get(HEALTH_PATH, (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/v1/invoices', (req, res) => res.json({ ok: true, ip: req.ip }));
  app.post('/api/v1/auth/login', (req, res) => res.json({ ok: true, ip: req.ip }));
  return app;
}

/** A request object of `app` (so its getters and trust function apply) with the given peer and headers. */
function fakeReq(app: express.Express, peer: string | undefined, headers: Record<string, string | string[]> = {}, encrypted = false): express.Request {
  const req = Object.create(app.request);
  req.app = app;
  req.headers = headers;
  req.socket = { remoteAddress: peer, encrypted };
  req.connection = req.socket;
  return req;
}

function policyApp(trustProxyEnv: string | undefined) {
  const app = express();
  applyTrustedProxyPolicy(app, trustProxySetting(trustProxyEnv));
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

describe('forwardedHops (the trusted-proxy policy)', () => {
  it('without TRUST_PROXY ignores every forwarded header', () => {
    const app = policyApp(undefined);
    const req = fakeReq(app, '192.168.1.20', { 'x-forwarded-for': '8.8.8.8', 'x-forwarded-proto': 'https' });
    expect(forwardedHops(req)).toEqual({ ip: '192.168.1.20', protocol: 'http' });
  });

  it('ignores forwarded headers from a peer that is not a trusted proxy', () => {
    const app = policyApp('10.255.0.1');
    const req = fakeReq(app, '192.168.1.20', { 'x-forwarded-for': '8.8.8.8', 'x-forwarded-proto': 'https' });
    expect(forwardedHops(req)).toEqual({ ip: '192.168.1.20', protocol: 'http' });
  });

  it('a TLS socket is https whatever the headers say', () => {
    const app = policyApp('true');
    expect(forwardedHops(fakeReq(app, '127.0.0.1', { 'x-forwarded-proto': 'http' }, true)).protocol).toBe('https');
  });

  it('takes the scheme the trusted proxy appended (last value), not the one the client sent', () => {
    const app = policyApp('true');
    const hop = (proto: string | string[]) => forwardedHops(fakeReq(app, '127.0.0.1', { 'x-forwarded-for': '198.51.100.7', 'x-forwarded-proto': proto }));
    expect(hop('https, http').protocol).toBe('http');
    expect(hop('http, https').protocol).toBe('https');
    expect(hop(['https', 'http']).protocol).toBe('http'); // duplicate header lines
    expect(hop(' HTTPS ').protocol).toBe('https');
    expect(hop('wss').protocol).toBe('http');
    expect(hop('').protocol).toBe('http');
  });

  it('through a chain of trusted proxies, reads the scheme at the outermost trusted hop', () => {
    // client -> edge proxy 10.0.0.7 (TLS) -> local proxy 127.0.0.1 (plain) -> app
    const app = policyApp('loopback, 10.0.0.0/8');
    const req = fakeReq(app, '127.0.0.1', { 'x-forwarded-for': '203.0.113.5, 10.0.0.7', 'x-forwarded-proto': 'https, http' });
    expect(forwardedHops(req)).toEqual({ ip: '203.0.113.5', protocol: 'https' });
    // a client-supplied value to the left of the trusted chain is never read
    const spoof = fakeReq(app, '127.0.0.1', { 'x-forwarded-for': '203.0.113.5, 10.0.0.7', 'x-forwarded-proto': 'https, http, http' });
    expect(forwardedHops(spoof).protocol).toBe('http');
  });

  it('a client cannot extend the trusted chain by prepending a trusted-looking address', () => {
    const app = policyApp('true');
    // the client sent X-Forwarded-For: 127.0.0.1, the local proxy appended the real address
    const req = fakeReq(app, '127.0.0.1', { 'x-forwarded-for': '127.0.0.1, 198.51.100.7', 'x-forwarded-proto': 'https, http' });
    expect(forwardedHops(req)).toEqual({ ip: '198.51.100.7', protocol: 'http' });
  });

  it('a single overwritten value from a trusted proxy is used even when the chain is longer', () => {
    const app = policyApp('loopback, 10.0.0.0/8');
    const req = fakeReq(app, '127.0.0.1', { 'x-forwarded-for': '203.0.113.5, 10.0.0.7', 'x-forwarded-proto': 'https' });
    expect(forwardedHops(req).protocol).toBe('https');
  });

  it('req.ip, req.protocol and req.secure are the policy values', () => {
    const app = policyApp('true');
    const req = fakeReq(app, '127.0.0.1', { 'x-forwarded-for': '198.51.100.7', 'x-forwarded-proto': 'https, http' });
    expect(req.ip).toBe('198.51.100.7');
    expect(req.protocol).toBe('http');
    expect(req.secure).toBe(false);
    expect(isSecureRequest(req)).toBe(false);
    expect(clientIp(req)).toBe('198.51.100.7');
  });

  it('client address matches Express/proxy-addr for every chain and trust setting', () => {
    const chains = ['', '198.51.100.7', '1.1.1.1, 198.51.100.7', '127.0.0.1, 198.51.100.7', '198.51.100.7, 127.0.0.1', '10.0.0.7', '203.0.113.5, 10.0.0.7', ' , 10.0.0.7 ,', '::1, fe80::1'];
    const peers = ['127.0.0.1', '::1', '::ffff:127.0.0.1', '10.0.0.7', '192.168.1.20'];
    for (const setting of [undefined, 'true', '10.0.0.7', 'loopback, 10.0.0.0/8', 'uniquelocal']) {
      const app = policyApp(setting);
      const trust = proxyaddr.compile((trustProxySetting(setting) ?? '').split(',').map((v) => v.trim()).filter(Boolean));
      for (const peer of peers) {
        for (const xff of chains) {
          const headers = xff ? { 'x-forwarded-for': xff } : {};
          const req = fakeReq(app, peer, headers);
          expect([setting, peer, xff, clientIp(req)]).toEqual([setting, peer, xff, proxyaddr(req as any, trust)]);
        }
      }
    }
  });
});

describe('httpsRedirectPolicy', () => {
  it('defaults to no redirect', () => {
    expect(httpsRedirectPolicy(undefined, undefined)).toEqual({ kind: 'none' });
    expect(httpsRedirectPolicy(' ', ' , ')).toEqual({ kind: 'none' });
  });

  it('accepts an https origin and normalises it', () => {
    expect(httpsRedirectPolicy('https://Invoices.Example.com', 'ignored.example')).toEqual({ kind: 'origin', origin: 'https://invoices.example.com' });
    expect(httpsRedirectPolicy('https://invoices.example.com:8443/', undefined)).toEqual({ kind: 'origin', origin: 'https://invoices.example.com:8443' });
  });

  it.each([
    'invoices.example.com',
    'http://invoices.example.com',
    'https://invoices.example.com/app',
    'https://invoices.example.com/?x=1',
    'https://invoices.example.com/#x',
    'https://user:pw@invoices.example.com',
    'javascript:alert(1)',
    'https://',
  ])('rejects a malformed PUBLIC_ORIGIN %p', (value) => {
    expect(() => httpsRedirectPolicy(value, undefined)).toThrow(/PUBLIC_ORIGIN/);
  });

  it('parses TRUSTED_HOSTS and rejects malformed entries', () => {
    expect(httpsRedirectPolicy(undefined, 'POS.local, pos.local:8443,[::1]:8443')).toEqual({
      kind: 'trusted-hosts',
      hosts: new Set(['pos.local', 'pos.local:8443', '[::1]:8443']),
    });
    for (const bad of ['*.example.com', 'https://pos.local', 'pos.local/x', 'a b', 'pos.local@evil']) {
      expect(() => httpsRedirectPolicy(undefined, bad)).toThrow(/TRUSTED_HOSTS/);
    }
  });

  it('applyHttpSecurity fails on a malformed value even outside production', () => {
    expect(() => applyHttpSecurity(express(), { NODE_ENV: 'development', PUBLIC_ORIGIN: 'http://x.example' })).toThrow(/PUBLIC_ORIGIN/);
    expect(() => applyHttpSecurity(express(), { NODE_ENV: 'development' })).not.toThrow();
  });
});

describe('httpsEnforcement', () => {
  describe('TRUST_PROXY unset, no redirect policy: a direct client (here on loopback) cannot claim HTTPS', () => {
    const app = appWith(undefined);

    it('refuses a plain-HTTP POST', async () => {
      await request(app).post('/api/v1/auth/login').expect(403, HTTPS_REQUIRED);
    });

    it('refuses a plain-HTTP POST that claims X-Forwarded-Proto: https', async () => {
      // Regression: the original inline middleware read the header directly and let this through.
      await request(app).post('/api/v1/auth/login').set('X-Forwarded-Proto', 'https').expect(403);
    });

    it('refuses (does not redirect) a plain-HTTP GET, even with a spoofed header', async () => {
      const res = await request(app).get('/api/v1/invoices').set('X-Forwarded-Proto', 'https').expect(403, HTTPS_REQUIRED);
      expect(res.headers.location).toBeUndefined();
    });

    it('serves the health route to a local client without forwarding headers', async () => {
      await request(app).get(HEALTH_PATH).expect(200, { status: 'ok' });
    });

    it('does not exempt health requests relayed by a same-machine proxy (forwarding headers present)', async () => {
      await request(app).get(HEALTH_PATH).set('X-Forwarded-For', '203.0.113.9').expect(403);
      await request(app).get(HEALTH_PATH).set('X-Forwarded-Proto', 'http').expect(403);
      await request(app).get(HEALTH_PATH).set('Forwarded', 'for=203.0.113.9').expect(403);
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
      await request(app).post('/api/v1/auth/login').set('X-Forwarded-Proto', 'https, http').expect(403);
      await request(app).post('/api/v1/auth/login').set('X-Forwarded-Proto', 'http, https').expect(200);
    });

    it('refuses requests the proxy marks as plain HTTP', async () => {
      await request(app).post('/api/v1/auth/login').set('X-Forwarded-Proto', 'http').expect(403);
    });
  });

  describe('TRUST_PROXY names a remote proxy: a direct client is not trusted', () => {
    const app = appWith('10.255.0.1', { PUBLIC_ORIGIN: 'https://invoices.example.com' });

    it('ignores X-Forwarded-Proto and X-Forwarded-For from a peer that is not the named proxy', async () => {
      await request(app).post('/api/v1/auth/login').set('X-Forwarded-Proto', 'https').set('X-Forwarded-For', '8.8.8.8').expect(403);
      const res = await request(app).get('/api/v1/invoices').set('X-Forwarded-Proto', 'https').set('X-Forwarded-For', '8.8.8.8').expect(301);
      expect(res.headers.location).toBe('https://invoices.example.com/api/v1/invoices');
    });
  });

  describe('PUBLIC_ORIGIN set', () => {
    const app = appWith(undefined, { PUBLIC_ORIGIN: 'https://invoices.example.com' });

    it('redirects plain-HTTP GETs to the configured origin, whatever the Host header says', async () => {
      for (const host of ['evil.example', 'invoices.example.com.evil.example', 'invoices.example.com@evil.example', '']) {
        const res = await request(app).get('/api/v1/invoices?status=paid').set('Host', host).expect(301);
        expect(res.headers.location).toBe('https://invoices.example.com/api/v1/invoices?status=paid');
      }
    });

    it('keeps a path starting with // on the configured origin', async () => {
      const res = await request(app).get('//evil.example/x').expect(301);
      expect(res.headers.location).toBe('https://invoices.example.com//evil.example/x');
    });

    it('still refuses non-GET requests', async () => {
      await request(app).post('/api/v1/auth/login').expect(403, HTTPS_REQUIRED);
    });
  });

  describe('TRUSTED_HOSTS set (no PUBLIC_ORIGIN)', () => {
    const app = appWith(undefined, { TRUSTED_HOSTS: 'pos.local, pos.local:8443' });

    it('redirects only to an allowed Host', async () => {
      let res = await request(app).get('/api/v1/invoices').set('Host', 'POS.local').expect(301);
      expect(res.headers.location).toBe('https://pos.local/api/v1/invoices');
      res = await request(app).get('/api/v1/invoices').set('Host', 'pos.local:8443').expect(301);
      expect(res.headers.location).toBe('https://pos.local:8443/api/v1/invoices');
    });

    it('refuses, without a Location, any other Host', async () => {
      for (const host of ['evil.example', 'pos.local:3000', 'pos.local.evil.example', 'evil.example/pos.local', 'pos.local@evil.example']) {
        const res = await request(app).get('/api/v1/invoices').set('Host', host).expect(403, HTTPS_REQUIRED);
        expect(res.headers.location).toBeUndefined();
      }
    });
  });

  it('never echoes an absolute-form request target', () => {
    const redirect = jest.fn();
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const req: any = {
      method: 'GET',
      path: '/x',
      originalUrl: 'http://evil.example/x',
      headers: { host: 'pos.local' },
      socket: { remoteAddress: '10.0.0.5' },
      app: { get: () => undefined },
    };
    httpsEnforcement(httpsRedirectPolicy('https://invoices.example.com', undefined))(req, { redirect, status } as any, jest.fn());
    expect(redirect).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });

  it('does not exempt a health request from a non-loopback client', () => {
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
    httpsEnforcement(httpsRedirectPolicy(undefined, 'pos.local'))(req, { redirect } as any, next);
    expect(next).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith(301, `https://pos.local${HEALTH_PATH}`);
  });

  it('recognises only loopback addresses (same range as Express "loopback")', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('127.0.0.2')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopback('10.0.0.5')).toBe(false);
    expect(isLoopback('::ffff:10.0.0.5')).toBe(false);
    expect(isLoopback('127.0.0.1.evil')).toBe(false);
    expect(isLoopback(undefined)).toBe(false);
  });
});

describe('regressions (trusted-proxy policy and redirect target)', () => {
  it('req.secure agrees with HTTPS enforcement for a multi-value X-Forwarded-Proto', async () => {
    // client sent "https", the trusted same-machine proxy appended the real "http"
    const app = policyApp('true');
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
