import type { NextFunction, Request, Response } from 'express';
import type { TLSSocket } from 'tls';

/** The health route (global prefix 'api' + HealthController 'v1/health'). */
export const HEALTH_PATH = '/api/v1/health';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function isLoopback(address: string | undefined): boolean {
  return !!address && LOOPBACK.has(address);
}

/**
 * Express 'trust proxy' value from TRUST_PROXY.
 *
 * - unset / 'false'  -> undefined: no proxy is trusted.
 * - 'true'           -> 'loopback': only a proxy on the same machine is trusted.
 *   (Earlier releases used a hop count of 1, which trusts WHATEVER peer
 *   connects directly; on a backend reachable over the LAN any client could
 *   then forge X-Forwarded-Proto and X-Forwarded-For.)
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

/** Last value of a possibly comma-joined forwarded header: the one the nearest proxy set. */
function lastHeaderValue(value: string | string[] | undefined): string {
  const joined = Array.isArray(value) ? value.join(',') : value ?? '';
  return (joined.split(',').pop() ?? '').trim().toLowerCase();
}

/**
 * True when the request reached us over TLS, either directly or through a
 * TRUSTED proxy (the direct peer passes Express's trust function) whose own
 * X-Forwarded-Proto value is https. The last header value is used, so a client
 * cannot win by sending its own X-Forwarded-Proto to a proxy that appends.
 */
export function isSecureRequest(req: Request): boolean {
  if ((req.socket as TLSSocket | undefined)?.encrypted) return true;
  const trust = req.app?.get?.('trust proxy fn') as ((addr: string, i: number) => boolean) | undefined;
  const peer = req.socket?.remoteAddress;
  if (!trust || !peer || !trust(peer, 0)) return false;
  return lastHeaderValue(req.headers['x-forwarded-proto']) === 'https';
}

/**
 * Production HTTPS enforcement. Plain-HTTP requests are refused (non-GET, 403)
 * or redirected (GET, 301), with one exemption: GET of the health route from
 * the loopback interface WITHOUT forwarding headers, i.e. a health check run
 * on the same machine / inside the container. Requests relayed by a
 * same-machine proxy carry forwarding headers and are not exempt.
 */
export function httpsEnforcement() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (isSecureRequest(req)) return next();
    const forwarded = req.headers['x-forwarded-for'] !== undefined || req.headers['x-forwarded-proto'] !== undefined || req.headers.forwarded !== undefined;
    if (req.method === 'GET' && req.path === HEALTH_PATH && isLoopback(req.socket?.remoteAddress) && !forwarded) {
      return next();
    }
    if (req.method !== 'GET') {
      return res.status(403).json({
        error: 'HTTPS required',
        message: 'This application requires HTTPS. Please use HTTPS to access the API.',
      });
    }
    return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
  };
}
