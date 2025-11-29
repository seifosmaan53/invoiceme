import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { LoggerService } from '../services/logger.service';

@Injectable()
export class AccessLogMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AccessLogMiddleware.name);

  constructor(private loggerService: LoggerService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();
    const { method, originalUrl, ip } = req;
    const userAgent = req.get('user-agent') || '';

    // Log request start
    this.loggerService.log(
      `[${method}] ${originalUrl} - IP: ${ip} - User-Agent: ${userAgent.substring(0, 100)}`,
      'AccessLog',
    );

    // Capture response finish
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const { statusCode } = res;
      const contentLength = res.get('content-length') || 0;

      // Log request completion
      const logMessage = `[${method}] ${originalUrl} - ${statusCode} - ${duration}ms - ${contentLength}bytes - IP: ${ip}`;
      
      if (statusCode >= 400) {
        this.loggerService.warn(logMessage, 'AccessLog');
      } else {
        this.loggerService.log(logMessage, 'AccessLog');
      }

      // Log slow requests (>1 second)
      if (duration > 1000) {
        this.logger.warn(`Slow request detected: ${originalUrl} took ${duration}ms`);
      }
    });

    next();
  }
}

