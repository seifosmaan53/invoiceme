import type { Express, NextFunction, Request, Response } from 'express';
import type { TLSSocket } from 'tls';

/** The health route (global prefix 'api' + HealthController 'v1/health'). */
export const HEALTH_PATH = '/api/v1/health';

/**
 * Loopback peer, matching what Express's 'loopback' trust value covers
 * (127.0.0.0/8, ::1 and their IPv4-mapped form).
 */
export function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  if (address === '::1') return true;
  const v4 = address.startsWith('::ffff:') ? address.slice(7) : address;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4);
}

/**
 * Express 'trust proxy' value from TRUST_PROXY.
 *
 * - unset / 'false'  -> undefined: no proxy is trusted.
 * - 'true'           -> 'loopback': only a proxy on the same machine is trusted.
 *   (Earlier releases used a hop count of 1, which trusts WHATEVER peer
 *   connects directly; on a backend reachable over the LAN any client could
 *   then forge X-Forwarded-Proto and X-Forwarded-For.) Note that 'loopback'
 *   trusts every local process, not only the proxy: on a machine shared with
 *   untrusted users, name a dedicated address instead (docs/SECURITY.md).
 * - anything else    -> passed to Express as an explicit list of proxy
 *   addresses/subnets, e.g. '10.0.0.5' or 'loopback, 192.168.1.0/24'.
 * Hop counts are rejected for the same reason.
 */
export function trustProxySetting(raw: string | undefined): string | undefined {
  const value = (raw ?? '').trim();
  if (!value || value.toLowerCase() === 'false') return undefined;
  if (value.toLowerCase() === 'true') return 'loopback';
  if (/^\d+$/.test(value)) {
    throw new Error('TRUST_PROXY must name the proxy (true = loopback, or addresses/subnets), not a hop count');
  }
  return value;
}

type TrustFn = (addr: string, i: number) => boolean;

/** Comma-separated header values, nearest hop first (i.e. right to left), blanks dropped. */
function valuesRightToLeft(value: string | string[] | undefined): string[] {
  const joined = Array.isArray(value) ? value.join(',') : value ?? '';
  return joined
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
    .reverse();
}

export interface ForwardedHops {
  /** Client address: the first address, walking from the socket peer outwards, that is not a trusted proxy. */
  ip: string | undefined;
  /** Scheme the client used to reach the outermost trusted proxy (or this server directly). */
  protocol: 'http' | 'https';
}

/**
 * THE trusted-proxy policy. Every consumer (HTTPS enforcement, req.secure,
 * req.protocol, req.ip, rate-limit keys, logs) goes through this function.
 *
 * The hop chain is [socket peer, X-Forwarded-For values right to left].
 * Starting at the socket peer, hops are counted while Express's trust
 * function accepts them ('trust proxy fn', compiled from TRUST_PROXY); the
 * first untrusted hop is the client (all hops trusted: the last one), the
 * same result Express/proxy-addr gives for req.ip.
 *
 * X-Forwarded-Proto is read only when the socket peer is trusted, and then
 * at the position of the outermost trusted proxy counted from the right
 * (each proxy appends the scheme it received), clamped to the values
 * present (a proxy that overwrites leaves a single value). Values to the
 * left of that position were supplied by untrusted parties and are never
 * read. Anything other than exactly 'http' / 'https' counts as 'http'.
 */
export function forwardedHops(req: Request): ForwardedHops {
  const peer = req.socket?.remoteAddress;
  const tls = !!(req.socket as TLSSocket | undefined)?.encrypted;
  const socketProto = tls ? 'https' : 'http';
  const trust = req.app?.get?.('trust proxy fn') as TrustFn | undefined;

  const chain = [peer, ...valuesRightToLeft(req.headers['x-forwarded-for'])];
  // trusted = number of consecutive trusted proxies, from the socket peer outwards
  let trusted = 0;
  while (trust && trusted < chain.length && chain[trusted] !== undefined && trust(chain[trusted] as string, trusted)) {
    trusted++;
  }
  const ip = chain[Math.min(trusted, chain.length - 1)];
  if (tls || trusted === 0) return { ip, protocol: socketProto };

  const protos = valuesRightToLeft(req.headers['x-forwarded-proto']);
  if (protos.length === 0) return { ip, protocol: socketProto };
  const value = protos[Math.min(trusted, protos.length) - 1].toLowerCase();
  return { ip, protocol: value === 'https' ? 'https' : 'http' };
}

/** True when the client reached us (or the outermost trusted proxy) over TLS. */
export function isSecureRequest(req: Request): boolean {
  return forwardedHops(req).protocol === 'https';
}

/** Rate-limit / logging identity of the client (same walk as req.ip). */
export function clientIp(req: Request): string {
  return forwardedHops(req).ip ?? 'unknown';
}

/**
 * Applies TRUST_PROXY to an Express app and makes req.ip, req.protocol and
 * (through req.protocol) req.secure use forwardedHops(), so Express's own
 * first-value reading of X-Forwarded-Proto can never disagree with HTTPS
 * enforcement. Call before any middleware that reads them.
 */
export function applyTrustedProxyPolicy(app: Express, trustProxy: string | undefined): void {
  app.set('trust proxy', trustProxy ?? false);
  Object.defineProperty(app.request, 'ip', {
    configurable: true,
    enumerable: true,
    get(this: Request) {
      return forwardedHops(this).ip;
    },
  });
  Object.defineProperty(app.request, 'protocol', {
    configurable: true,
    enumerable: true,
    get(this: Request) {
      return forwardedHops(this).protocol;
    },
  });
}

/** Where plain-HTTP GETs are redirected; see httpsRedirectPolicy(). */
export type HttpsRedirectPolicy =
  | { kind: 'origin'; origin: string }
  | { kind: 'trusted-hosts'; hosts: Set<string> }
  | { kind: 'none' };

const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*|\[[0-9a-f:.]+\])(?::\d{1,5})?$/;

/**
 * Redirect target for plain-HTTP GETs, from PUBLIC_ORIGIN / TRUSTED_HOSTS.
 *
 * - PUBLIC_ORIGIN set (e.g. https://invoices.example.com): always redirect
 *   there. Must be an https origin without path, query, fragment or
 *   credentials; a malformed value throws (startup fails).
 * - else TRUSTED_HOSTS set (comma-separated host or host:port, exact,
 *   case-insensitive): redirect to https://<Host> only when the request's
 *   Host header is on the list. A malformed entry throws.
 * - else: never redirect; plain-HTTP GETs are refused like other methods.
 * The Host header alone never decides the destination.
 */
export function httpsRedirectPolicy(publicOrigin: string | undefined, trustedHosts: string | undefined): HttpsRedirectPolicy {
  const origin = (publicOrigin ?? '').trim();
  if (origin) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error(`PUBLIC_ORIGIN is not a valid URL: ${JSON.stringify(origin)}`);
    }
    if (url.protocol !== 'https:') throw new Error('PUBLIC_ORIGIN must use https://');
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || /[?#]/.test(origin)) {
      throw new Error('PUBLIC_ORIGIN must be an origin only (https://host[:port]), without path, query, fragment or credentials');
    }
    return { kind: 'origin', origin: url.origin };
  }
  const list = (trustedHosts ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h.length > 0);
  if (list.length > 0) {
    for (const h of list) {
      if (!HOST_RE.test(h)) throw new Error(`TRUSTED_HOSTS entry is not a host or host:port: ${JSON.stringify(h)}`);
    }
    return { kind: 'trusted-hosts', hosts: new Set(list) };
  }
  return { kind: 'none' };
}

/** Absolute https URL for the redirect, or undefined when the policy gives none. */
function redirectLocation(req: Request, policy: HttpsRedirectPolicy): string | undefined {
  const path = req.originalUrl;
  // Only origin-form targets ("/..."); absolute-form or odd targets are never echoed.
  if (typeof path !== 'string' || !path.startsWith('/')) return undefined;
  if (policy.kind === 'origin') return `${policy.origin}${path}`;
  if (policy.kind === 'trusted-hosts') {
    const host = (req.headers.host ?? '').trim().toLowerCase();
    if (HOST_RE.test(host) && policy.hosts.has(host)) return `https://${host}${path}`;
  }
  return undefined;
}

const HTTPS_REQUIRED = {
  error: 'HTTPS required',
  message: 'This application requires HTTPS. Please use HTTPS to access the API.',
};

/**
 * Production HTTPS enforcement. Plain-HTTP requests are refused (403), except
 * GETs the redirect policy can send to a validated destination (301). One
 * exemption: GET of the health route from the loopback interface WITHOUT
 * forwarding headers, i.e. a health check run on the same machine / inside
 * the container. Requests relayed by a same-machine proxy carry forwarding
 * headers and are not exempt.
 */
export function httpsEnforcement(policy: HttpsRedirectPolicy = { kind: 'none' }) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (isSecureRequest(req)) return next();
    const forwarded = req.headers['x-forwarded-for'] !== undefined || req.headers['x-forwarded-proto'] !== undefined || req.headers.forwarded !== undefined;
    if (req.method === 'GET' && req.path === HEALTH_PATH && isLoopback(req.socket?.remoteAddress) && !forwarded) {
      return next();
    }
    const location = req.method === 'GET' ? redirectLocation(req, policy) : undefined;
    if (location) return res.redirect(301, location);
    return res.status(403).json(HTTPS_REQUIRED);
  };
}

export interface HttpSecurityEnv {
  NODE_ENV?: string;
  TRUST_PROXY?: string;
  PUBLIC_ORIGIN?: string;
  TRUSTED_HOSTS?: string;
}

/**
 * main.ts wiring: trusted-proxy policy first, then (production only) HTTPS
 * enforcement. PUBLIC_ORIGIN / TRUSTED_HOSTS are validated whenever they
 * are set, so a malformed value fails at startup in every environment;
 * leaving both unset is valid (plain-HTTP GETs are then refused, not redirected).
 */
export function applyHttpSecurity(app: Express, env: HttpSecurityEnv): { enforced: boolean; redirect: HttpsRedirectPolicy['kind'] } {
  const trustProxy = trustProxySetting(env.TRUST_PROXY);
  const policy = httpsRedirectPolicy(env.PUBLIC_ORIGIN, env.TRUSTED_HOSTS);
  applyTrustedProxyPolicy(app, trustProxy);
  const enforced = (env.NODE_ENV || 'development') === 'production';
  if (enforced) app.use(httpsEnforcement(policy));
  return { enforced, redirect: policy.kind };
}
