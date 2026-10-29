import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository, LessThan } from 'typeorm';
import { Invoice, InvoiceStatus } from '../entities/invoice.entity';
import { NotificationService } from '../core/services/notification.service';
import { User } from '../entities/user.entity';
import { ownedClient } from '../core/utils/cross-owner.util';
import { addCalendarDays, businessToday, toCalendarDate } from '../common/calendar-date';

/**
 * OVERDUE_NOTIFY_MAX_AGE_DAYS: unset = 7; a whole number of days (1 or more);
 * or `all` to notify every invoice the run marks. Anything else is an error.
 */
export function overdueNotifyMaxAgeDays(raw: string | undefined): number | 'all' {
  if (raw === undefined || raw.trim() === '') return 7;
  const value = raw.trim().toLowerCase();
  if (value === 'all') return 'all';
  if (/^\d+$/.test(value) && Number(value) >= 1) return Number(value);
  throw new Error(`OVERDUE_NOTIFY_MAX_AGE_DAYS must be a whole number of days (1 or more) or "all", not "${raw}"`);
}

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
   * Mark sent invoices as overdue once their due date is before today, and
   * notify the owner of those that became overdue recently.
   *
   * Only invoices due within the last OVERDUE_NOTIFY_MAX_AGE_DAYS (default 7)
   * days are notified; older ones (the backlog on a first run after an
   * upgrade, or after a long outage) are marked silently and counted in the
   * log, so an upgrade does not send one email per historical invoice. To send
   * the backlog deliberately, set OVERDUE_NOTIFY_MAX_AGE_DAYS=all for one run
   * (docs/operations/upgrade-2026-10-28.md).
   *
   * The UPDATE returns exactly the rows it changed, so each invoice is
   * notified at most once, by the run that marked it.
   * Runs daily at midnight (00:00:00)
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async markOverdueInvoices(): Promise<{ marked: number; notified: number; silent: number }> {
    this.logger.log('Starting overdue invoice check...');

    try {
      // Calendar comparison: overdue once the due date is before today in
      // the business timezone (common/calendar-date.ts).
      const today = businessToday();
      const maxAge = overdueNotifyMaxAgeDays(process.env.OVERDUE_NOTIFY_MAX_AGE_DAYS);
      const notifyFrom = maxAge === 'all' ? null : addCalendarDays(today, -maxAge);

      const result = await this.invoiceRepository
        .createQueryBuilder()
        .update(Invoice)
        .set({ status: InvoiceStatus.OVERDUE })
        .where('due_date < :today', { today })
        .andWhere('status = :sent', { sent: InvoiceStatus.SENT })
        .andWhere('deleted_at IS NULL')
        .returning(['id'])
        .execute();
      const markedIds: string[] = (result.raw ?? []).map((row: { id: string }) => row.id);

      const overdueInvoices = markedIds.length
        ? await this.invoiceRepository.find({ where: { id: In(markedIds) }, relations: ['client', 'user'] })
        : [];
      const recent = overdueInvoices.filter(
        (invoice) => notifyFrom === null || (invoice.dueDate && toCalendarDate(invoice.dueDate) >= notifyFrom),
      );

      for (const invoice of recent) {
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

      const silent = markedIds.length - recent.length;
      this.logger.log(
        `Marked ${markedIds.length} invoices as overdue; notified ${recent.length}` +
          (silent ? `; ${silent} due before ${notifyFrom} marked without notification (OVERDUE_NOTIFY_MAX_AGE_DAYS)` : ''),
      );
      return { marked: markedIds.length, notified: recent.length, silent };
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

