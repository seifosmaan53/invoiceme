import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecurringInvoice } from '../entities/recurring-invoice.entity';
import { RecurringInvoicesService } from './recurring-invoices.service';
import { RecurringInvoicesCronService } from './recurring-invoices-cron.service';
import { InvoicesModule } from '../invoices/invoices.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([RecurringInvoice]),
    InvoicesModule,
  ],
  providers: [RecurringInvoicesService, RecurringInvoicesCronService],
  exports: [RecurringInvoicesService],
})
export class RecurringInvoicesModule {}

