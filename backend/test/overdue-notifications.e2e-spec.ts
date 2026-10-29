/**
 * Overdue notifications after an upgrade (docs/operations/upgrade-2026-10-28.md):
 * - the first overdue run of this version marks the historical backlog of
 *   past-due sent invoices, but notifies only invoices that become overdue
 *   that day; the backlog is notified only with OVERDUE_NOTIFY_HISTORICAL=true;
 * - every later run notifies every invoice it marks (newly overdue);
 * - an invoice is notified at most once, also with concurrent runs.
 */
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Client } from '../src/entities/client.entity';
import { Invoice, InvoiceStatus } from '../src/entities/invoice.entity';
import { SystemState } from '../src/entities/system-state.entity';
import { InvoiceStatusService, OVERDUE_FIRST_RUN_KEY, overdueNotifyHistorical } from '../src/invoices/invoice-status.service';
import { NotificationService } from '../src/core/services/notification.service';
import { addCalendarDays, businessToday } from '../src/common/calendar-date';
import { createE2eApp, E2eApp } from './e2e-app';

describe('Overdue notifications after an upgrade (E2E)', () => {
  let e2e: E2eApp;
  let invoices: Repository<Invoice>;
  let state: Repository<SystemState>;
  let status: InvoiceStatusService;
  let notify: jest.SpyInstance;
  let userId: string;
  let clientId: string;
  const saved = process.env.OVERDUE_NOTIFY_HISTORICAL;

  beforeAll(async () => {
    e2e = await createE2eApp();
    invoices = e2e.moduleFixture.get(getRepositoryToken(Invoice));
    state = e2e.moduleFixture.get(getRepositoryToken(SystemState));
    status = e2e.moduleFixture.get(InvoiceStatusService);
    notify = jest.spyOn(e2e.moduleFixture.get(NotificationService), 'notifyInvoiceOverdue').mockResolvedValue(undefined as any);
  });
  afterAll(async () => {
    await e2e.app.close();
  });
  beforeEach(async () => {
    delete process.env.OVERDUE_NOTIFY_HISTORICAL;
    notify.mockClear();
    await e2e.truncateAll(); // includes system_state: every test starts before the first run
    userId = (await e2e.createUser('overdue@example.test')).user.id;
    const clients: Repository<Client> = e2e.moduleFixture.get(getRepositoryToken(Client));
    clientId = (await clients.save(clients.create({ userId, name: 'Acme' }))).id;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.OVERDUE_NOTIFY_HISTORICAL;
    else process.env.OVERDUE_NOTIFY_HISTORICAL = saved;
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

  /** Past-due sent invoices at upgrade time, plus ones that must not change. */
  async function backlog() {
    await make('A-1d', 1); // becomes overdue today: not historical
    await make('B-2d', 2);
    await make('C-8d', 8);
    await make('D-400d', 400);
    await make('E-paid', 50, InvoiceStatus.PAID);
    await make('F-today', 0);
  }

  it('first run, default: marks the whole backlog, notifies only what becomes overdue today; historical stays silent', async () => {
    await backlog();
    expect(await status.markOverdueInvoices()).toEqual({ marked: 4, notified: 1, silent: 3, firstRun: true });
    expect(notified()).toEqual(['A-1d']);
    expect(await statuses()).toEqual({
      'A-1d': InvoiceStatus.OVERDUE,
      'B-2d': InvoiceStatus.OVERDUE,
      'C-8d': InvoiceStatus.OVERDUE,
      'D-400d': InvoiceStatus.OVERDUE,
      'E-paid': InvoiceStatus.PAID,
      'F-today': InvoiceStatus.SENT,
    });
    expect((await state.findOneByOrFail({ key: OVERDUE_FIRST_RUN_KEY })).value).toBe(today());
  });

  it('later runs keep notifying newly overdue invoices (also ones that crossed their due date during downtime), never twice', async () => {
    await backlog();
    await status.markOverdueInvoices(); // first run
    notify.mockClear();

    // Since the first run: an invoice due yesterday, one sent late with an old due date, and downtime-era ones
    await make('G-1d', 1);
    await make('H-sent-late', 90);
    await make('I-downtime-5d', 5);
    expect(await status.markOverdueInvoices()).toEqual({ marked: 3, notified: 3, silent: 0, firstRun: false });
    expect(notified()).toEqual(['G-1d', 'H-sent-late', 'I-downtime-5d']);

    notify.mockClear();
    expect(await status.markOverdueInvoices()).toEqual({ marked: 0, notified: 0, silent: 0, firstRun: false });
    expect(notify).not.toHaveBeenCalled();
  });

  it('OVERDUE_NOTIFY_HISTORICAL=true on the first run notifies the backlog (explicit opt-in)', async () => {
    await backlog();
    process.env.OVERDUE_NOTIFY_HISTORICAL = 'true';
    expect(await status.markOverdueInvoices()).toEqual({ marked: 4, notified: 4, silent: 0, firstRun: true });
    expect(notified()).toEqual(['A-1d', 'B-2d', 'C-8d', 'D-400d']);
  });

  it('opting in after the first run notifies nothing more: the backlog was already marked', async () => {
    await backlog();
    await status.markOverdueInvoices();
    notify.mockClear();
    process.env.OVERDUE_NOTIFY_HISTORICAL = 'true';
    expect(await status.markOverdueInvoices()).toEqual({ marked: 0, notified: 0, silent: 0, firstRun: false });
    expect(notify).not.toHaveBeenCalled();
  });

  it('two runs at the same time notify each invoice once and record one first run', async () => {
    await backlog();
    process.env.OVERDUE_NOTIFY_HISTORICAL = 'true';
    const [a, b] = await Promise.all([status.markOverdueInvoices(), status.markOverdueInvoices()]);
    expect(a.marked + b.marked).toBe(4);
    expect([a.firstRun, b.firstRun].sort()).toEqual([false, true]);
    expect(notified()).toEqual(['A-1d', 'B-2d', 'C-8d', 'D-400d']);
    expect(await state.countBy({ key: OVERDUE_FIRST_RUN_KEY })).toBe(1);
  });

  it('an invalid setting is refused, not guessed: nothing is marked and the first run is not recorded', async () => {
    expect(overdueNotifyHistorical(undefined)).toBe(false);
    expect(overdueNotifyHistorical(' FALSE ')).toBe(false);
    expect(overdueNotifyHistorical('true')).toBe(true);
    for (const bad of ['1', 'yes', 'all', '7', 'tru']) expect(() => overdueNotifyHistorical(bad)).toThrow(/OVERDUE_NOTIFY_HISTORICAL/);
    await make('A-1d', 1);
    process.env.OVERDUE_NOTIFY_HISTORICAL = 'yes';
    await expect(status.markOverdueInvoices()).rejects.toThrow(/OVERDUE_NOTIFY_HISTORICAL/);
    expect((await statuses())['A-1d']).toBe(InvoiceStatus.SENT);
    expect(await state.countBy({ key: OVERDUE_FIRST_RUN_KEY })).toBe(0);
  });
});
