import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository, LessThan } from 'typeorm';
import { Invoice, InvoiceStatus } from '../entities/invoice.entity';
import { NotificationService } from '../core/services/notification.service';
import { User } from '../entities/user.entity';
import { ownedClient } from '../core/utils/cross-owner.util';
import { businessToday, toCalendarDate } from '../common/calendar-date';

/**
 * Service to automatically update invoice statuses
 * Runs daily at midnight to mark overdue invoices
 */
@Injectable()
export class InvoiceStatusService {
  private readonly logger = new Logger(InvoiceStatusService.name);

  constructor(
    @InjectRepository(Invoice)
    private invoiceRepository: Repository<Invoice>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private notificationService: NotificationService,
  ) {}

  /**
   * Mark invoices as overdue if due_date < today and status = UNPAID
   * Runs daily at midnight (00:00:00)
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async markOverdueInvoices() {
    this.logger.log('Starting overdue invoice check...');

    try {
      // Calendar comparison: overdue once the due date is before today in
      // the business timezone (common/calendar-date.ts).
      const today = businessToday() as unknown as Date;

      // Find invoices that need to be marked as overdue
      const overdueInvoices = await this.invoiceRepository.find({
        where: {
          dueDate: LessThan(today),
          status: InvoiceStatus.SENT,
          deletedAt: IsNull(),
        },
        relations: ['client', 'user'],
      });

      if (overdueInvoices.length > 0) {
        // Update status
        await this.invoiceRepository.update(
          {
            dueDate: LessThan(today),
            status: InvoiceStatus.SENT,
            deletedAt: IsNull(),
          },
          {
            status: InvoiceStatus.OVERDUE,
          },
        );

        // Send notifications
        for (const invoice of overdueInvoices) {
          try {
            const user = await this.userRepository.findOne({ where: { id: invoice.userId } });
            if (user) {
              await this.notificationService.notifyInvoiceOverdue({
                userEmail: user.email,
                userName: user.name,
                invoiceNumber: invoice.number,
                invoiceId: invoice.id,
                clientName: ownedClient(invoice)?.name || 'Unknown',
                amount: parseFloat(invoice.total.toString()),
                currency: invoice.currency,
                dueDate: invoice.dueDate ? toCalendarDate(invoice.dueDate) : undefined,
              });
            }
          } catch (error) {
            this.logger.error(`Failed to send overdue notification for invoice ${invoice.number}:`, error);
          }
        }
      }

      this.logger.log(`Marked ${overdueInvoices.length} invoices as overdue`);
    } catch (error) {
      this.logger.error('Error marking overdue invoices:', error);
      throw error;
    }
  }

  /**
   * Manual trigger for testing purposes
   */
  async runOverdueCheck(): Promise<number> {
    this.logger.log('Manually triggering overdue invoice check...');
    const today = businessToday() as unknown as Date;

    const result = await this.invoiceRepository.update(
      {
        dueDate: LessThan(today),
        status: InvoiceStatus.SENT,
        deletedAt: IsNull(),
      },
      {
        status: InvoiceStatus.OVERDUE,
      },
    );

    const count = result.affected || 0;
    this.logger.log(`Marked ${count} invoices as overdue`);
    return count;
  }
}

