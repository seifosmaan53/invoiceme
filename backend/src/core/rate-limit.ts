import type { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { clientIp } from './https-enforcement';

export interface RateLimitConfig {
  nodeEnv: string;
  /** RATE_LIMIT_TTL, seconds (default 60). */
  ttlSeconds?: number;
  /** RATE_LIMIT_MAX (default 100). */
  max?: number;
}

/** Path prefix -> limiter, in the order main.ts mounts them. */
export interface RateLimiters {
  api: RequestHandler;
  login: RequestHandler;
  register: RequestHandler;
}

/**
 * Rate limiters keyed on the client address from the trusted-proxy policy
 * (clientIp, the same value as req.ip). X-Forwarded-For only changes the key
 * when it arrives through a trusted proxy, so a direct client cannot pick a
 * fresh key per request. Counters are in memory, per process.
 */
export function createRateLimiters({ nodeEnv, ttlSeconds = 60, max = 100 }: RateLimitConfig): RateLimiters {
  const common = { keyGenerator: clientIp } as const;

  // General API rate limiter
  const api = rateLimit({
    ...common,
    windowMs: ttlSeconds * 1000,
    max,
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Stricter rate limiting for authentication endpoints
  // More lenient in development mode to prevent blocking during testing
  const login =
    nodeEnv === 'development'
      ? rateLimit({
          ...common,
          windowMs: 2 * 60 * 1000, // 2 minutes
          max: 50, // 50 attempts per 2 minutes (very lenient for dev)
          message: 'Too many login attempts, please try again later.',
          skipSuccessfulRequests: true,
        })
      : rateLimit({
          ...common,
          windowMs: 15 * 60 * 1000, // 15 minutes
          max: 5, // 5 attempts per 15 minutes
          message: 'Too many login attempts, please try again later.',
          skipSuccessfulRequests: true,
        });

  const register = rateLimit({
    ...common,
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // 3 registrations per hour
    message: 'Too many registration attempts, please try again later.',
  });

  return { api, login, register };
}
