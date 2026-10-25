import * as dns from 'dns';
import * as https from 'https';
import * as net from 'net';

/**
 * PDF logo handling.
 *
 * The logo URL is chosen by the user. Chromium never fetches it: rendering
 * runs with all network requests blocked (see pdf-render-sandbox.ts). Instead
 * the server fetches the image itself, with the protections below, and
 * inlines it as a data: URI. Anything that fails a check is left out of the
 * PDF; the invoice still renders.
 *
 * - https only, default port only, no credentials in the URL
 * - every resolved address is checked at connect time (in the socket's
 *   `lookup`), so DNS rebinding between check and connect is not possible
 * - private, loopback, link-local, CGNAT, multicast, documentation, metadata
 *   and IPv6 transition ranges are refused
 * - no redirects
 * - LOGO_TIMEOUT_MS overall, LOGO_MAX_BYTES of body
 * - only PNG, JPEG, GIF or WebP, by Content-Type and by magic bytes (no SVG)
 *
 * A URL-format check alone is not SSRF protection: the address check at
 * connect time is the protection. checkPdfLogoUrl() is the input rule.
 */

export const LOGO_MAX_URL_LENGTH = 2048;
export const LOGO_MAX_BYTES = 1024 * 1024;
export const LOGO_TIMEOUT_MS = 5000;

const IMAGE_TYPES: Record<string, (b: Buffer) => boolean> = {
  'image/png': (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/gif': (b) => b.length > 6 && (b.subarray(0, 6).toString('latin1') === 'GIF87a' || b.subarray(0, 6).toString('latin1') === 'GIF89a'),
  'image/webp': (b) => b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};

/**
 * Input rule for pdfLogoUrl. Returns an error message, or null if acceptable.
 * Accepts an absolute https URL with a host, no credentials, no explicit
 * port other than 443, no whitespace or control characters.
 */
export function checkPdfLogoUrl(value: unknown): string | null {
  if (typeof value !== 'string') return 'pdfLogoUrl must be a string';
  if (value.length > LOGO_MAX_URL_LENGTH) return `pdfLogoUrl must be at most ${LOGO_MAX_URL_LENGTH} characters`;
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f-\u009f\u00a0\u1680\u180e\u2000-\u200f\u2028\u2029\u202f\u205f\u3000\ufeff\\]/.test(value)) {
    return 'pdfLogoUrl must not contain whitespace, control characters or backslashes';
  }
  if (!/^https:\/\/[^/?#]/i.test(value)) return 'pdfLogoUrl must be an absolute https:// URL';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'pdfLogoUrl is not a valid URL';
  }
  if (url.protocol !== 'https:' || !url.hostname) return 'pdfLogoUrl must be an absolute https:// URL';
  if (url.username || url.password) return 'pdfLogoUrl must not contain credentials';
  if (url.port && url.port !== '443') return 'pdfLogoUrl must use the default https port';
  return null;
}

// Ranges a logo fetch must never connect to. IPv4-mapped / -compatible IPv6
// addresses are unwrapped and checked as IPv4.
const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(addr, prefix, 'ipv4');
}
for (const [addr, prefix] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 23],
  ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
] as const) {
  blocked.addSubnet(addr, prefix, 'ipv6');
}

function embeddedIpv4(address: string): string | null {
  // ::ffff:a.b.c.d, ::ffff:xxxx:xxxx, ::a.b.c.d (deprecated compatible form)
  const m = /^::(?:ffff:)?(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/i.exec(address);
  if (!m) return null;
  if (m[1]) return m[1];
  const hi = parseInt(m[2], 16);
  const lo = parseInt(m[3], 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/** True if a logo fetch may connect to this IP address. */
export function isPublicAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  if (family === 6) {
    const v4 = embeddedIpv4(address);
    if (v4) return !blocked.check(v4, 'ipv4');
    return !blocked.check(address, 'ipv6');
  }
  return false;
}

type LookupFn = (
  hostname: string,
  options: dns.LookupAllOptions,
  callback: (err: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void,
) => void;

export interface FetchLogoOptions {
  /** Test seam: name resolution (default dns.lookup). */
  lookup?: LookupFn;
  /** Test seam: address policy (default isPublicAddress). */
  isAllowedAddress?: (address: string) => boolean;
  /** Test seam: extra trusted CA for a local https server. */
  ca?: string | Buffer;
  /** Test seam: port to connect to instead of 443. */
  connectPort?: number;
  timeoutMs?: number;
  maxBytes?: number;
}

export class LogoFetchError extends Error {}

/**
 * Fetch a logo with the protections listed at the top of this file and return
 * it as a data: URI. Throws LogoFetchError on any refusal or failure.
 */
export function fetchLogoAsDataUri(rawUrl: string, options: FetchLogoOptions = {}): Promise<string> {
  const problem = checkPdfLogoUrl(rawUrl);
  if (problem) return Promise.reject(new LogoFetchError(problem));

  const url = new URL(rawUrl);
  const resolve: LookupFn = options.lookup ?? (dns.lookup as unknown as LookupFn);
  const allowed = options.isAllowedAddress ?? isPublicAddress;
  const timeoutMs = options.timeoutMs ?? LOGO_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? LOGO_MAX_BYTES;
  // URL keeps IPv6 literals in brackets
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1');

  // Node does not call `lookup` for IP literals: check those here.
  if (net.isIP(host) && !allowed(host)) {
    return Promise.reject(new LogoFetchError(`refusing to connect to ${host}`));
  }

  // Called by the socket right before connecting: the address checked here is
  // the address connected to.
  const guardedLookup = (
    hostname: string,
    _opts: unknown,
    callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void,
  ) => {
    const done = (addresses: dns.LookupAddress[]) => {
      if (addresses.length === 0) return callback(new LogoFetchError(`no address for ${hostname}`), '');
      const refused = addresses.find((a) => !allowed(a.address));
      if (refused) return callback(new LogoFetchError(`refusing to connect to ${refused.address}`), '');
      const { address, family } = addresses[0];
      // Node >= 20 may call lookup with { all: true } (autoSelectFamily)
      if ((_opts as dns.LookupOptions)?.all) return callback(null, [addresses[0]]);
      callback(null, address, family);
    };
    resolve(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) return callback(err, '');
      done(addresses || []);
    });
  };

  return new Promise<string>((resolvePromise, reject) => {
    let settled = false;
    let req: ReturnType<typeof https.request> | undefined;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req?.destroy();
      reject(err instanceof LogoFetchError ? err : new LogoFetchError(err.message));
    };

    const timer = setTimeout(() => fail(new LogoFetchError(`logo request timed out after ${timeoutMs} ms`)), timeoutMs);
    req = https.request(
      {
        protocol: 'https:',
        host,
        port: options.connectPort ?? 443,
        servername: net.isIP(host) ? undefined : host,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: { Accept: 'image/png, image/jpeg, image/gif, image/webp', 'User-Agent': 'InvoiceMe-PDF-Logo' },
        lookup: guardedLookup as any,
        agent: false,
        ca: options.ca,
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status !== 200) {
          res.resume();
          return fail(new LogoFetchError(`logo request answered ${status}${status >= 300 && status < 400 ? ' (redirects are not followed)' : ''}`));
        }
        const contentType = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        const matches = IMAGE_TYPES[contentType === 'image/jpg' ? 'image/jpeg' : contentType];
        if (!matches) {
          res.resume();
          return fail(new LogoFetchError(`logo content type not allowed: ${contentType || 'none'}`));
        }
        const declared = Number(res.headers['content-length']);
        if (Number.isFinite(declared) && declared > maxBytes) {
          res.resume();
          return fail(new LogoFetchError(`logo larger than ${maxBytes} bytes`));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) return fail(new LogoFetchError(`logo larger than ${maxBytes} bytes`));
          chunks.push(chunk);
        });
        res.on('error', fail);
        res.on('end', () => {
          if (settled) return;
          const body = Buffer.concat(chunks);
          const type = contentType === 'image/jpg' ? 'image/jpeg' : contentType;
          if (!matches(body)) return fail(new LogoFetchError(`logo body is not a ${type} image`));
          settled = true;
          clearTimeout(timer);
          resolvePromise(`data:${type};base64,${body.toString('base64')}`);
        });
      },
    );
    req.on('error', fail);
    req.end();
  });
}
