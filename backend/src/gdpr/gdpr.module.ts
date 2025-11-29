import { Module } from '@nestjs/common';
import { GdprController } from './gdpr.controller';
import { CoreServicesModule } from '../core/core-services.module';

@Module({
  imports: [CoreServicesModule],
  controllers: [GdprController],
})
export class GdprModule {}

