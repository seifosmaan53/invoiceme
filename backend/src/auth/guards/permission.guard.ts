import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { ApiKeysService } from '../../api-keys/api-keys.service';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private apiKeysService: ApiKeysService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermission = this.reflector.getAllAndOverride<string>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = (request as any).apiKey;

    // JWT sessions are not scoped; only API keys need permission checks
    if (!apiKey) {
      return true;
    }

    // Fail closed: an API key reaches only routes that name the permission it
    // needs. A route without @RequirePermission is not open to API keys.
    if (!requiredPermission) {
      throw new ForbiddenException('API keys are not accepted on this route');
    }

    // Check if API key has required permission
    if (!this.apiKeysService.hasPermission(apiKey, requiredPermission)) {
      throw new ForbiddenException(
        `API key does not have required permission: ${requiredPermission}`,
      );
    }

    return true;
  }
}

