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

    // If no permission required, allow access
    if (!requiredPermission) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = (request as any).apiKey;

    // If authenticated via JWT (not API key), allow access
    // API keys are the only ones that need permission checks
    if (!apiKey) {
      return true;
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

