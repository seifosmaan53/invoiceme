import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ConfigService } from '@nestjs/config';

/**
 * Security middleware to add security headers and enforce security policies
 */
@Injectable()
export class SecurityMiddleware implements NestMiddleware {
  constructor(private configService: ConfigService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const nodeEnv = this.configService.get<string>('NODE_ENV') || 'development';

    // Security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    // Content Security Policy
    if (nodeEnv === 'production') {
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self';"
      );
    }

    // Remove server information
    res.removeHeader('X-Powered-By');

    // Request size limit (prevent DoS)
    const maxRequestSize = 10 * 1024 * 1024; // 10MB
    if (req.headers['content-length']) {
      const contentLength = parseInt(req.headers['content-length'], 10);
      if (contentLength > maxRequestSize) {
        return res.status(413).json({
          statusCode: 413,
          message: 'Request entity too large',
          error: 'Payload Too Large',
        });
      }
    }

    next();
  }
}

