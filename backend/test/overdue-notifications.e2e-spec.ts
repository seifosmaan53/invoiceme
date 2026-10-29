/**
 * The overdue check after an upgrade: every sent invoice past due becomes
 * overdue, but only those due within OVERDUE_NOTIFY_MAX_AGE_DAYS are emailed;
 * a run never notifies an invoice twice; `all` sends the backlog on purpose.
 */
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Client } from '../src/entities/client.entity';
import { Invoice, InvoiceStatus } from '../src/entities/invoice.entity';
import { InvoiceStatusService, overdueNotifyMaxAgeDays } from '../src/invoices/invoice-status.service';
import { NotificationService } from '../src/core/services/notification.service';
import { addCalendarDays, businessToday } from '../src/common/calendar-date';
import { createE2eApp, E2eApp } from './e2e-app';

describe('Overdue notifications after an upgrade (E2E)', () => {
  let e2e: E2eApp;
  let invoices: Repository<Invoice>;
  let status: InvoiceStatusService;
  let notify: jest.SpyInstance;
  let userId: string;
  let clientId: string;
  const saved = process.env.OVERDUE_NOTIFY_MAX_AGE_DAYS;

  beforeAll(async () => {
    e2e = await createE2eApp();
    invoices = e2e.moduleFixture.get(getRepositoryToken(Invoice));
    status = e2e.moduleFixture.get(InvoiceStatusService);
    notify = jest.spyOn(e2e.moduleFixture.get(NotificationService), 'notifyInvoiceOverdue').mockResolvedValue(undefined as any);
  });
  afterAll(async () => {
    await e2e.app.close();
  });
  beforeEach(async () => {
    delete process.env.OVERDUE_NOTIFY_MAX_AGE_DAYS;
    notify.mockClear();
    await e2e.truncateAll();
    userId = (await e2e.createUser('overdue@example.test')).user.id;
    const clients: Repository<Client> = e2e.moduleFixture.get(getRepositoryToken(Client));
    clientId = (await clients.save(clients.create({ userId, name: 'Acme' }))).id;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.OVERDUE_NOTIFY_MAX_AGE_DAYS;
    else process.env.OVERDUE_NOTIFY_MAX_AGE_DAYS = saved;
  });

  const today = () => businessToday();
  const make = (number: string, daysAgo: number, s = InvoiceStatus.SENT) =>
    invoices.save(
      invoices.create({
        userId,
        clientId,
        number,
        status: s,
        issueDate: addCalendarDays(today(), -daysAgo - 30) as unknown as Date,
        dueDate: addCalendarDays(today(), -daysAgo) as unknown as Date,
        currency: 'USD',
        subtotal: 1,
        taxTotal: 0,
        discountTotal: 0,
        total: 1,
      }),
    );
  const notified = () => notify.mock.calls.map(([arg]) => arg.invoiceNumber).sort();
  const statuses = async () =>
    Object.fromEntries((await invoices.find({ order: { number: 'ASC' } })).map((i) => [i.number, i.status]));

  async function backlog() {
    await make('A-1d', 1);
    await make('B-7d', 7);
    await make('C-8d', 8);
    await make('D-400d', 400);
    await make('E-paid', 50, InvoiceStatus.PAID);
    await make('F-today', 0);
  }

  it('default: marks the whole backlog, notifies only invoices due in the last 7 days, and never twice', async () => {
    await backlog();
    expect(await status.markOverdueInvoices()).toEqual({ marked: 4, notified: 2, silent: 2 });
    expect(notified()).toEqual(['A-1d', 'B-7d']);
    expect(await statuses()).toEqual({
      'A-1d': InvoiceStatus.OVERDUE,
      'B-7d': InvoiceStatus.OVERDUE,
      'C-8d': InvoiceStatus.OVERDUE,
      'D-400d': InvoiceStatus.OVERDUE,
      'E-paid': InvoiceStatus.PAID,
      'F-today': InvoiceStatus.SENT,
    });

    notify.mockClear();
    expect(await status.markOverdueInvoices()).toEqual({ marked: 0, notified: 0, silent: 0 });
    expect(notify).not.toHaveBeenCalled();
  });

  it('an explicit window and `all` (operator catch-up) widen what is notified', async () => {
    await backlog();
    process.env.OVERDUE_NOTIFY_MAX_AGE_DAYS = '30';
    expect(await status.markOverdueInvoices()).toMatchObject({ marked: 4, notified: 3 });
    expect(notified()).toEqual(['A-1d', 'B-7d', 'C-8d']);

    await invoices.update({ status: InvoiceStatus.OVERDUE }, { status: InvoiceStatus.SENT });
    notify.mockClear();
    process.env.OVERDUE_NOTIFY_MAX_AGE_DAYS = 'all';
    expect(await status.markOverdueInvoices()).toEqual({ marked: 4, notified: 4, silent: 0 });
    expect(notified()).toEqual(['A-1d', 'B-7d', 'C-8d', 'D-400d']);
  });

  it('an invalid setting is refused, not guessed', async () => {
    expect(overdueNotifyMaxAgeDays(undefined)).toBe(7);
    expect(overdueNotifyMaxAgeDays(' ALL ')).toBe('all');
    expect(overdueNotifyMaxAgeDays('14')).toBe(14);
    for (const bad of ['0', '-3', '2.5', 'seven', '7d']) expect(() => overdueNotifyMaxAgeDays(bad)).toThrow(/OVERDUE_NOTIFY_MAX_AGE_DAYS/);
    await make('A-1d', 1);
    process.env.OVERDUE_NOTIFY_MAX_AGE_DAYS = 'forever';
    await expect(status.markOverdueInvoices()).rejects.toThrow(/OVERDUE_NOTIFY_MAX_AGE_DAYS/);
    expect((await statuses())['A-1d']).toBe(InvoiceStatus.SENT);
  });
});
