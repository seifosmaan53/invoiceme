import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKey } from '../entities/api-key.entity';
import { ApiKeysService } from './api-keys.service';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { ApiKeyOrJwtGuard } from '../auth/guards/api-key-or-jwt.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';

@Module({
  imports: [TypeOrmModule.forFeature([ApiKey])],
  controllers: [ApiKeysController],
  providers: [ApiKeysService, ApiKeyGuard, ApiKeyOrJwtGuard, PermissionGuard],
  exports: [ApiKeysService, ApiKeyGuard, ApiKeyOrJwtGuard, PermissionGuard],
})
export class ApiKeysModule {}

