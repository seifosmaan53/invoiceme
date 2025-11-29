import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Field-level validation error
 */
export class ValidationErrorDto {
  @ApiProperty({ description: 'Field name that failed validation', example: 'email' })
  field: string;

  @ApiProperty({
    description: 'Validation error messages for this field',
    example: ['email must be an email', 'email should not be empty'],
    type: [String],
  })
  messages: string[];

  @ApiPropertyOptional({ description: 'Value that failed validation', example: 'invalid-email' })
  value?: any;
}

/**
 * Standardized error response DTO
 */
export class ErrorResponseDto {
  @ApiProperty({ description: 'HTTP status code', example: 400 })
  statusCode: number;

  @ApiProperty({
    description: 'Error messages (array for validation errors, single message for other errors)',
    example: ['Validation failed'],
    type: [String],
  })
  message: string[];

  @ApiPropertyOptional({ description: 'Error code for frontend error handling', example: 'VALIDATION_ERROR' })
  errorCode?: string;

  @ApiPropertyOptional({
    description: 'Field-level validation errors (only for validation errors)',
    type: [ValidationErrorDto],
  })
  errors?: ValidationErrorDto[];

  @ApiProperty({ description: 'Timestamp when error occurred', example: '2025-01-20T10:00:00.000Z' })
  timestamp: string;

  @ApiPropertyOptional({ description: 'Request path', example: '/api/v1/invoices' })
  path?: string;
}

/**
 * Error codes for different error types
 */
export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR = 'AUTHORIZATION_ERROR',
  NOT_FOUND_ERROR = 'NOT_FOUND_ERROR',
  CONFLICT_ERROR = 'CONFLICT_ERROR',
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  RATE_LIMIT_ERROR = 'RATE_LIMIT_ERROR',
  BAD_REQUEST_ERROR = 'BAD_REQUEST_ERROR',
}

