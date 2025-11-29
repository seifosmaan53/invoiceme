import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, BadRequestException } from '@nestjs/common';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import { ErrorCode, ErrorResponseDto, ValidationErrorDto } from '../dto/error-response.dto';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private configService?: ConfigService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    // Send to Sentry for error tracking (only if Sentry is initialized)
    try {
      if (exception instanceof Error) {
        Sentry.captureException(exception);
      } else {
        Sentry.captureException(new Error(String(exception)));
      }
    } catch (sentryError) {
      // Sentry not initialized or error - continue without it
    }

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const nodeEnv = this.configService?.get<string>('NODE_ENV') || process.env.NODE_ENV || 'development';
    const isProduction = nodeEnv === 'production';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let error: string | object = 'Internal Server Error';
    let detailedError: any = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
        error = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        message = (exceptionResponse as any).message || exception.message;
        error = exceptionResponse;
        detailedError = exceptionResponse;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      error = exception.name;
      detailedError = {
        name: exception.name,
        message: exception.message,
        stack: exception.stack,
      };
    }

    // Security: Log full error details (server-side only)
    console.error('Exception:', {
      status,
      message,
      path: request.url,
      method: request.method,
      timestamp: new Date().toISOString(),
      error: detailedError || (exception instanceof Error ? exception.stack : exception),
      ip: request.ip,
      userAgent: request.get('user-agent'),
    });

    // Determine error code based on status and exception type
    let errorCode: ErrorCode | undefined;
    if (status === HttpStatus.BAD_REQUEST) {
      errorCode = ErrorCode.VALIDATION_ERROR;
    } else if (status === HttpStatus.UNAUTHORIZED) {
      errorCode = ErrorCode.AUTHENTICATION_ERROR;
    } else if (status === HttpStatus.FORBIDDEN) {
      errorCode = ErrorCode.AUTHORIZATION_ERROR;
    } else if (status === HttpStatus.NOT_FOUND) {
      errorCode = ErrorCode.NOT_FOUND_ERROR;
    } else if (status === HttpStatus.CONFLICT) {
      errorCode = ErrorCode.CONFLICT_ERROR;
    } else if (status === HttpStatus.TOO_MANY_REQUESTS) {
      errorCode = ErrorCode.RATE_LIMIT_ERROR;
    } else if (status >= 500) {
      errorCode = ErrorCode.INTERNAL_SERVER_ERROR;
    }

    // Parse validation errors into field-level format
    const validationErrors: ValidationErrorDto[] = [];
    if (status === HttpStatus.BAD_REQUEST && detailedError && typeof detailedError === 'object') {
      // Handle class-validator error format
      if (Array.isArray(detailedError.message)) {
        detailedError.message.forEach((errorItem: any) => {
          if (typeof errorItem === 'string') {
            // String format: "property clientId must be a UUID" or "clientId must be a UUID"
            const fieldMatch = errorItem.match(/property\s+(\w+)\s+/i) || 
                              errorItem.match(/(\w+)\s+must\s+/i) ||
                              errorItem.match(/(\w+)\s+should\s+/i);
            const field = fieldMatch ? fieldMatch[1] : 'unknown';
            
            const existingFieldError = validationErrors.find((e) => e.field === field);
            if (existingFieldError) {
              existingFieldError.messages.push(errorItem);
            } else {
              validationErrors.push({
                field,
                messages: [errorItem],
              });
            }
          } else if (typeof errorItem === 'object' && errorItem.property) {
            // Object format with property and constraints
            const field = errorItem.property;
            const messages = errorItem.constraints 
              ? Object.values(errorItem.constraints) as string[]
              : [errorItem.message || 'Validation failed'];
            
            const existingFieldError = validationErrors.find((e) => e.field === field);
            if (existingFieldError) {
              existingFieldError.messages.push(...messages);
            } else {
              validationErrors.push({
                field,
                messages,
                value: errorItem.value,
              });
            }
          }
        });
      }
    }

    // Build standardized error response
    const responseBody: ErrorResponseDto = {
      statusCode: status,
      message: Array.isArray(message) ? message : [message],
      timestamp: new Date().toISOString(),
    };

    // Add error code
    if (errorCode) {
      responseBody.errorCode = errorCode;
    }

    // Add field-level validation errors if available
    if (validationErrors.length > 0) {
      responseBody.errors = validationErrors;
    }

    // Include path in development or for client errors
    if (!isProduction || status < 500) {
      responseBody.path = request.url;
    }

    // Production: Sanitize error messages for 5xx errors
    if (isProduction && status >= 500) {
      responseBody.message = ['An internal server error occurred'];
      responseBody.errorCode = ErrorCode.INTERNAL_SERVER_ERROR;
    }

    response.status(status).json(responseBody);
  }
}

