import type { NextFunction, Request, Response } from 'express';

/** The health route (global prefix 'api' + HealthController 'v1/health'). */
export const HEALTH_PATH = '/api/v1/health';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function isLoopback(address: string | undefined): boolean {
  return !!address && LOOPBACK.has(address);
}

/**
 * Production HTTPS enforcement.
 *
 * A request counts as HTTPS only when Express says so (`req.secure`). Express
 * derives that from X-Forwarded-Proto ONLY when 'trust proxy' is enabled
 * (TRUST_PROXY=true); otherwise the header is ignored. The previous version
 * read X-Forwarded-Proto directly, so any client on plain HTTP could send
 * `X-Forwarded-Proto: https` and skip the enforcement.
 *
 * One exemption: GET of the health route from the loopback interface, so a
 * health check running on the same machine or inside the container works over
 * plain HTTP without spoofing a header. Everything else over plain HTTP is
 * refused (non-GET, 403) or redirected (GET, 301).
 */
export function httpsEnforcement() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.secure) return next();
    if (req.method === 'GET' && req.path === HEALTH_PATH && isLoopback(req.socket?.remoteAddress)) {
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
