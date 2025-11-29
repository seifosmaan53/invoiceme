import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiKeysService } from '../../api-keys/api-keys.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = this.extractApiKey(request);

    if (!apiKey) {
      throw new UnauthorizedException('API key is required');
    }

    const validatedKey = await this.apiKeysService.validateApiKey(apiKey);

    if (!validatedKey) {
      throw new UnauthorizedException('Invalid or expired API key');
    }

    // Attach API key info to request for use in controllers
    (request as any).apiKey = validatedKey;
    (request as any).user = { userId: validatedKey.userId };

    return true;
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

    // Check query parameter (less secure, but sometimes needed)
    const queryKey = request.query['api_key'] as string;
    if (queryKey) {
      return queryKey;
    }

    return null;
  }
}

