import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RecurringInvoicesService } from './recurring-invoices.service';

@Injectable()
export class RecurringInvoicesCronService {
  private readonly logger = new Logger(RecurringInvoicesCronService.name);

  constructor(private readonly recurringInvoicesService: RecurringInvoicesService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleCron() {
    this.logger.log('Running daily recurring invoices check...');
    const result = await this.recurringInvoicesService.processRecurringInvoices();
    this.logger.log(`Generated ${result.generated} invoices. Errors: ${result.errors.length}`);
    if (result.errors.length > 0) {
      this.logger.error('Recurring invoice errors:', result.errors);
    }
  }
}

