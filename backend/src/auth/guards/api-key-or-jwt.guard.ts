import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Observable } from 'rxjs';
import { ApiKeysService } from '../../api-keys/api-keys.service';
import { Request } from 'express';

/**
 * Guard that allows either API key or JWT token authentication
 * Tries API key first, falls back to JWT if no API key is found
 */
@Injectable()
export class ApiKeyOrJwtGuard extends AuthGuard('jwt') {
  constructor(private readonly apiKeysService: ApiKeysService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = this.extractApiKey(request);

    // If API key is provided, use API key authentication
    if (apiKey) {
      const validatedKey = await this.apiKeysService.validateApiKey(apiKey);

      if (!validatedKey) {
        return false;
      }

      // Attach API key info to request
      (request as any).apiKey = validatedKey;
      (request as any).user = { userId: validatedKey.userId };
      (request as any).authMethod = 'api-key';

      return true;
    }

    // Otherwise, fall back to JWT authentication
    return super.canActivate(context) as Promise<boolean>;
  }

  private extractApiKey(request: Request): string | null {
    // Check X-API-Key header first
    const headerKey = request.headers['x-api-key'] as string;
    if (headerKey) {
      return headerKey;
    }

    // Check Authorization header with Bearer token
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      // If it starts with 'sk_', it's an API key, not a JWT
      if (token.startsWith('sk_')) {
        return token;
      }
    }

    return null;
  }
}

