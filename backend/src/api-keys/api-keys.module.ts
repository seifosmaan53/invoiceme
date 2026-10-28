import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKey } from '../entities/api-key.entity';
import { ApiKeysService } from './api-keys.service';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeyOrJwtGuard } from '../auth/guards/api-key-or-jwt.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';

@Module({
  imports: [TypeOrmModule.forFeature([ApiKey])],
  controllers: [ApiKeysController],
  providers: [ApiKeysService, ApiKeyOrJwtGuard, PermissionGuard],
  exports: [ApiKeysService, ApiKeyOrJwtGuard, PermissionGuard],
})
export class ApiKeysModule {}

