/**
 * Server-side logo fetch (src/core/services/pdf-logo.ts).
 *
 * All servers are local. Denials use the real address policy: a test name
 * resolves to 127.0.0.1 and the fetch must refuse before connecting (the
 * listener counts TCP connections). Positive controls allow 127.0.0.1 through
 * the isAllowedAddress seam and trust a throwaway self-signed certificate.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as https from 'https';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import {
  checkPdfLogoUrl,
  fetchLogoAsDataUri,
  isPublicAddress,
  LogoFetchError,
} from '../src/core/services/pdf-logo';

// 1x1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('checkPdfLogoUrl (input rule)', () => {
  it.each([
    'https://cdn.example.com/logo.png',
    'https://cdn.example.com:443/a/b.png?v=2',
    'https://[2606:4700::1111]/logo.png',
  ])('accepts %s', (value) => {
    expect(checkPdfLogoUrl(value)).toBeNull();
  });

  it.each([
    ['http (only https is fetched)', 'http://cdn.example.com/logo.png'],
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:image/png;base64,AAAA'],
    ['file:', 'file:///etc/passwd'],
    ['ftp:', 'ftp://example.com/logo.png'],
    ['credentials', 'https://user:pass@cdn.example.com/logo.png'],
    ['username only', 'https://user@cdn.example.com/logo.png'],
    ['non-default port', 'https://cdn.example.com:8443/logo.png'],
    ['no host', 'https:///logo.png'],
    ['no slashes', 'https:cdn.example.com/logo.png'],
    ['protocol-relative', '//cdn.example.com/logo.png'],
    ['relative', 'logo.png'],
    ['leading space', ' https://cdn.example.com/logo.png'],
    ['embedded newline', 'https://cdn.example.com/\nlogo.png'],
    ['backslash', 'https:\\\\cdn.example.com\\logo.png'],
    ['malformed host', 'https://exa mple.com/'],
    ['too long', `https://cdn.example.com/${'a'.repeat(2100)}`],
    ['non-string', 42],
  ])('rejects %s', (_label, value) => {
    expect(checkPdfLogoUrl(value)).not.toBeNull();
  });
});

describe('isPublicAddress (connect-time policy)', () => {
  it.each([
    '127.0.0.1', '127.1.2.3', '10.0.0.1', '172.16.5.4', '192.168.1.1', '169.254.169.254',
    '100.100.100.200', '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1',
    '::1', '::', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:169.254.169.254', '::127.0.0.1',
    'fd00:ec2::254', 'fc00::1', 'fe80::1', 'ff02::1', '64:ff9b::7f00:1', '2002:7f00:1::1', '2001::1',
    'not-an-ip',
  ])('refuses %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700::1111', '2a00:1450:4001::1'])('allows %s', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });
});

describe('fetchLogoAsDataUri (local https servers)', () => {
  let dir: string;
  let key: string;
  let cert: string;
  let server: https.Server;
  let port: number;
  let connections: number;
  let handler: (req: any, res: any) => void;

  const toLoopback = (_h: string, _o: unknown, cb: (e: any, a: any[]) => void) =>
    cb(null, [{ address: '127.0.0.1', family: 4 }]);
  const allowLoopback = (a: string) => a === '127.0.0.1';
  const fetchLocal = (url = 'https://logo.test/logo.png', extra: Record<string, unknown> = {}) =>
    fetchLogoAsDataUri(url, { lookup: toLoopback, isAllowedAddress: allowLoopback, ca: cert, connectPort: port, ...extra });

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-logo-spec-'));
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=logo.test',
      '-addext', 'subjectAltName=DNS:logo.test',
      '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem'),
    ], { stdio: 'ignore' });
    key = fs.readFileSync(path.join(dir, 'key.pem'), 'utf8');
    cert = fs.readFileSync(path.join(dir, 'cert.pem'), 'utf8');
    server = https.createServer({ key, cert }, (req, res) => handler(req, res));
    server.on('connection', () => connections++);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as net.AddressInfo).port;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  beforeEach(() => {
    connections = 0;
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(PNG);
    };
  });

  it('positive control: inlines a PNG from an allowed address as a data: URI', async () => {
    await expect(fetchLocal()).resolves.toBe(`data:image/png;base64,${PNG.toString('base64')}`);
    expect(connections).toBe(1);
  });

  it('refuses a name that resolves to loopback with the real policy, without connecting', async () => {
    await expect(
      fetchLogoAsDataUri('https://logo.test/logo.png', { lookup: toLoopback, ca: cert, connectPort: port }),
    ).rejects.toThrow('refusing to connect to 127.0.0.1');
    expect(connections).toBe(0);
  });

  it('refuses when any resolved address is private (mixed public/private answer)', async () => {
    const mixed = (_h: string, _o: unknown, cb: (e: any, a: any[]) => void) =>
      cb(null, [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }]);
    await expect(
      fetchLogoAsDataUri('https://logo.test/logo.png', { lookup: mixed, ca: cert, connectPort: port }),
    ).rejects.toThrow('refusing to connect to 127.0.0.1');
    expect(connections).toBe(0);
  });

  it.each(['https://127.0.0.1/logo.png', 'https://[::1]/logo.png', 'https://169.254.169.254/latest/meta-data/', 'https://[::ffff:127.0.0.1]/x.png'])(
    'refuses the IP literal %s without connecting',
    async (url) => {
      await expect(fetchLogoAsDataUri(url, { ca: cert, connectPort: port })).rejects.toThrow(/refusing to connect/);
      expect(connections).toBe(0);
    },
  );

  it('refuses URLs that fail the input rule before any lookup', async () => {
    const lookup = jest.fn(toLoopback);
    await expect(fetchLogoAsDataUri('http://logo.test/logo.png', { lookup })).rejects.toThrow(LogoFetchError);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('does not follow redirects', async () => {
    let followed = false;
    handler = (req, res) => {
      if (req.url === '/target.png') followed = true;
      res.writeHead(302, { Location: '/target.png' });
      res.end();
    };
    await expect(fetchLocal()).rejects.toThrow('redirects are not followed');
    expect(followed).toBe(false);
  });

  it.each([
    ['text/html', Buffer.from('<html></html>')],
    ['image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ['', PNG],
  ])('refuses content type %p', async (type, body) => {
    handler = (_req, res) => {
      res.writeHead(200, type ? { 'Content-Type': type } : {});
      res.end(body);
    };
    await expect(fetchLocal()).rejects.toThrow('content type not allowed');
  });

  it('refuses a body that is not the declared image type', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(Buffer.from('<html>not a png</html>'));
    };
    await expect(fetchLocal()).rejects.toThrow('is not a image/png image');
  });

  it('refuses a declared Content-Length above the limit', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(PNG.length) });
      res.end(PNG);
    };
    await expect(fetchLocal(undefined, { maxBytes: 10 })).rejects.toThrow('larger than 10 bytes');
  });

  it('stops reading a chunked body above the limit', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.write(PNG);
      res.write(Buffer.alloc(4096));
      res.end(Buffer.alloc(4096));
    };
    await expect(fetchLocal(undefined, { maxBytes: 1024 })).rejects.toThrow('larger than 1024 bytes');
  });

  it('times out a server that does not answer', async () => {
    handler = () => undefined; // never responds
    await expect(fetchLocal(undefined, { timeoutMs: 300 })).rejects.toThrow('timed out after 300 ms');
  });

  it('rejects a certificate it does not trust', async () => {
    await expect(
      fetchLogoAsDataUri('https://logo.test/logo.png', { lookup: toLoopback, isAllowedAddress: allowLoopback, connectPort: port }),
    ).rejects.toThrow(LogoFetchError);
  });
});
