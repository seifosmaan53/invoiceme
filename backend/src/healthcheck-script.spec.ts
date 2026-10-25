import { spawnSync } from 'child_process';
import * as http from 'http';
import { AddressInfo } from 'net';
import * as path from 'path';

/** Runs backend/healthcheck.js against a local server that returns each kind of response. */
describe('healthcheck.js', () => {
  let server: http.Server;
  let base: string;
  const script = path.join(__dirname, '..', 'healthcheck.js');

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const send = (status: number, body: string, headers: Record<string, string> = {}) => {
        res.writeHead(status, { 'content-type': 'application/json', ...headers });
        res.end(body);
      };
      switch (req.url) {
        case '/ok': return send(200, JSON.stringify({ status: 'ok', database: 'connected', cache: 'connected' }));
        case '/redirect': return send(301, 'Moved Permanently', { location: 'https://localhost/ok' });
        case '/db-down': return send(200, JSON.stringify({ status: 'ok', database: 'disconnected' }));
        case '/degraded': return send(200, JSON.stringify({ status: 'error', database: 'connected' }));
        case '/html': return send(200, '<html>ok</html>', { 'content-type': 'text/html' });
        case '/500': return send(500, JSON.stringify({ status: 'error' }));
        case '/slow': setTimeout(() => send(200, JSON.stringify({ status: 'ok', database: 'connected' })), 3000); return;
        default: return send(404, '{}');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const run = (p: string, env: Record<string, string> = {}) =>
    new Promise<{ status: number | null; out: string }>((resolve) => {
      const { spawn } = require('child_process');
      const child = spawn(process.execPath, [script, `${base}${p}`], { env: { ...process.env, ...env } });
      let out = '';
      child.stdout.on('data', (d: Buffer) => (out += d));
      child.stderr.on('data', (d: Buffer) => (out += d));
      child.on('close', (status: number | null) => resolve({ status, out }));
    });

  it('passes only on HTTP 200 with status ok and database connected', async () => {
    expect((await run('/ok')).status).toBe(0);
  });

  it.each([
    ['/redirect', /HTTP 301/],
    ['/db-down', /database is "disconnected"/],
    ['/degraded', /status is "error"/],
    ['/html', /not JSON/],
    ['/500', /HTTP 500/],
    ['/missing', /HTTP 404/],
  ])('fails on %s', async (p, reason) => {
    const r = await run(p);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(reason);
  });

  it('fails when the server does not answer in time', async () => {
    const r = await run('/slow', { HEALTHCHECK_TIMEOUT_MS: '500' });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/no response within 500 ms/);
  });

  it('fails when nothing listens', () => {
    const r = spawnSync(process.execPath, [script, 'http://127.0.0.1:9/api/v1/health'], { encoding: 'utf8' });
    expect(r.status).toBe(1);
  });
});
