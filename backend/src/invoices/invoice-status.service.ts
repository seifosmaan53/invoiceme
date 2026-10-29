import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository, LessThan } from 'typeorm';
import { Invoice, InvoiceStatus } from '../entities/invoice.entity';
import { NotificationService } from '../core/services/notification.service';
import { User } from '../entities/user.entity';
import { ownedClient } from '../core/utils/cross-owner.util';
import { addCalendarDays, businessToday, toCalendarDate } from '../common/calendar-date';

/**
 * OVERDUE_NOTIFY_HISTORICAL: unset or `false` = the first overdue run of this
 * version marks the historical backlog without notifications; `true` = it
 * notifies the backlog too (explicit operator opt-in). Anything else is an
 * error, so a typo cannot send or suppress notifications by accident.
 */
export function overdueNotifyHistorical(raw: string | undefined): boolean {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '' || value === 'false') return false;
  if (value === 'true') return true;
  throw new Error(`OVERDUE_NOTIFY_HISTORICAL must be "true" or "false", not "${raw}"`);
}

const MISSING_022 =
  'Migration 022 (system_state) is not applied: the daily overdue check cannot run and no invoice is marked overdue. ' +
  'Apply backend/migrations/022_system_state.sql (docs/operations/upgrade-2026-10-28.md).';

/** system_state key (migration 022): business date of the first overdue run. */
export const OVERDUE_FIRST_RUN_KEY = 'overdue.first_run';

export interface OverdueRunResult {
  marked: number;
  notified: number;
  /** Historical invoices marked without a notification (first run only). */
  silent: number;
  firstRun: boolean;
}

/**
 * Service to automatically update invoice statuses
 * Runs daily at midnight to mark overdue invoices
 */
@Injectable()
export class InvoiceStatusService implements OnApplicationBootstrap {
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
   * notify the owner of each invoice that became overdue.
   *
   * Historical backlog: the first run of this version (no `overdue.first_run`
   * in system_state) marks every sent invoice already past due, but notifies
   * only those due yesterday, which become overdue today in any case. The
   * others are marked silently and counted in the log, unless the operator
   * opted in with OVERDUE_NOTIFY_HISTORICAL=true for that run. Every later run
   * notifies everything it marks: an invoice it marks was not past due, or not
   * sent, at the previous run (also after downtime).
   *
   * The UPDATE returns exactly the rows it changed, and the first-run marker
   * is written in the same transaction, so each invoice is notified at most
   * once, by the run that marked it; concurrent runs are serialised.
   * Runs daily at midnight in the server process's timezone; "today" is the
   * business date (BUSINESS_TIMEZONE).
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async markOverdueInvoices(): Promise<OverdueRunResult> {
    return this.runOverdueJob();
  }

  /** Migration 022 must be applied, or no invoice is ever marked overdue: say so at startup. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const [{ present }] = await this.invoiceRepository.manager.query("SELECT to_regclass('system_state') IS NOT NULL AS present");
      if (!present) this.logger.error(MISSING_022);
    } catch (error) {
      this.logger.error(`Could not check for migration 022: ${(error as Error).message}`);
    }
  }

  private async runOverdueJob(): Promise<OverdueRunResult> {
    this.logger.log('Starting overdue invoice check...');

    try {
      const today = businessToday();
      const notifyHistorical = overdueNotifyHistorical(process.env.OVERDUE_NOTIFY_HISTORICAL);

      const { markedIds, firstRun } = await this.invoiceRepository.manager.transaction(async (manager) => {
        await manager.query("SELECT pg_advisory_xact_lock(hashtext('invoice-overdue-job'))");
        const marker = await manager.query('SELECT value FROM system_state WHERE key = $1', [OVERDUE_FIRST_RUN_KEY]);
        const result = await manager
          .createQueryBuilder()
          .update(Invoice)
          .set({ status: InvoiceStatus.OVERDUE })
          .where('due_date < :today', { today })
          .andWhere('status = :sent', { sent: InvoiceStatus.SENT })
          .andWhere('deleted_at IS NULL')
          .returning(['id'])
          .execute();
        if (marker.length === 0) {
          await manager.query(
            'INSERT INTO system_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
            [OVERDUE_FIRST_RUN_KEY, today],
          );
        }
        return {
          markedIds: (result.raw ?? []).map((row: { id: string }) => row.id) as string[],
          firstRun: marker.length === 0,
        };
      });

      const overdueInvoices = markedIds.length
        ? await this.invoiceRepository.find({ where: { id: In(markedIds) }, relations: ['client', 'user'] })
        : [];
      // On the first run without opt-in, only invoices that become overdue today
      const newlyOverdueFrom = addCalendarDays(today, -1);
      const toNotify =
        !firstRun || notifyHistorical
          ? overdueInvoices
          : overdueInvoices.filter((invoice) => invoice.dueDate && toCalendarDate(invoice.dueDate) >= newlyOverdueFrom);

      for (const invoice of toNotify) {
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

      const silent = markedIds.length - toNotify.length;
      this.logger.log(
        `Marked ${markedIds.length} invoices as overdue; notified ${toNotify.length}` +
          (silent
            ? `; first run of this version: ${silent} historical invoices (due before ${newlyOverdueFrom}) marked without ` +
              'notification (set OVERDUE_NOTIFY_HISTORICAL=true before the first run to notify them)'
            : ''),
      );
      return { marked: markedIds.length, notified: toNotify.length, silent, firstRun };
    } catch (error) {
      const code = (error as any)?.driverError?.code ?? (error as any)?.code;
      if (code === '42P01' && /system_state/.test(String((error as any)?.message ?? ''))) {
        this.logger.error(MISSING_022);
        throw new Error(MISSING_022);
      }
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

