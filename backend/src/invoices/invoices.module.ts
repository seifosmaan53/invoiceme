import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvoicesService } from './invoices.service';
import { InvoicesController } from './invoices.controller';
import { InvoiceStatusService } from './invoice-status.service';
import { InvoicesImportService } from './invoices-import.service';
import { User } from '../entities/user.entity';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceItem } from '../entities/invoice-item.entity';
import { Client } from '../entities/client.entity';
import { Attachment } from '../entities/attachment.entity';
import { Payment } from '../entities/payment.entity';
import { CoreServicesModule } from '../core/core-services.module';
import { PaymentsModule } from '../payments/payments.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Invoice, InvoiceItem, Client, Attachment, User, Payment]),
    CoreServicesModule,
    PaymentsModule,
    ApiKeysModule,
  ],
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoiceStatusService, InvoicesImportService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
