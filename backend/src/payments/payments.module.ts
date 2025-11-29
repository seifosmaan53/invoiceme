import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentsService } from './payments.service';
import { WebhooksController } from './webhooks.controller';
import { Payment } from '../entities/payment.entity';
import { Invoice } from '../entities/invoice.entity';
import { User } from '../entities/user.entity';
import { CoreServicesModule } from '../core/core-services.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment, Invoice, User]),
    CoreServicesModule,
  ],
  controllers: [WebhooksController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}

