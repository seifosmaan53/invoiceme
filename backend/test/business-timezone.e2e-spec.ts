/**
 * "Today" for date-only invoice values is the date in BUSINESS_TIMEZONE, not
 * the UTC date and not the process's local date (common/calendar-date.ts).
 *
 * The clock is fixed (only Date is faked) at an instant where the three
 * disagree: 2026-12-31T15:30Z is 2027-01-01 in Asia/Tokyo but 2026-12-31 in
 * UTC and in New York (CI also runs this file with TZ=America/New_York).
 *
 * Real AppModule and PostgreSQL (test/e2e-app.ts); stored dates are read with
 * SQL so no JS Date conversion sits between the database and the assertion.
 * Template and recurring generation have no HTTP route, so those call the
 * services; CSV import goes through the HTTP endpoint.
 */
import * as request from 'supertest';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Client } from '../src/entities/client.entity';
import { Invoice, InvoiceStatus } from '../src/entities/invoice.entity';
import { InvoiceTemplate } from '../src/entities/invoice-template.entity';
import { RecurringInvoice, RecurrenceFrequency } from '../src/entities/recurring-invoice.entity';
import { InvoiceTemplatesService } from '../src/invoice-templates/invoice-templates.service';
import { RecurringInvoicesService } from '../src/recurring-invoices/recurring-invoices.service';
import { InvoiceStatusService } from '../src/invoices/invoice-status.service';
import { InvoicesService } from '../src/invoices/invoices.service';
import { createE2eApp, E2eApp } from './e2e-app';

const NOW = new Date('2026-12-31T15:30:00Z');
const TODAY = '2027-01-01'; // in Asia/Tokyo at NOW

describe('Business timezone "today" (E2E)', () => {
  let e2e: E2eApp;
  let clients: Repository<Client>;
  let invoices: Repository<Invoice>;
  let userId: string;
  let auth: string;
  let clientId: string;
  const savedZone = process.env.BUSINESS_TIMEZONE;

  beforeAll(async () => {
    e2e = await createE2eApp();
    clients = e2e.moduleFixture.get(getRepositoryToken(Client));
    invoices = e2e.moduleFixture.get(getRepositoryToken(Invoice));
  });
  afterAll(async () => {
    jest.useRealTimers();
    await e2e.app.close();
  });

  beforeEach(async () => {
    process.env.BUSINESS_TIMEZONE = 'Asia/Tokyo';
    jest.useFakeTimers({
      now: NOW,
      doNotFake: [
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'requestIdleCallback',
        'cancelIdleCallback',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    });
    await e2e.truncateAll();
    const { user, token } = await e2e.createUser('tz-owner@example.test');
    userId = user.id;
    auth = `Bearer ${token}`;
    clientId = (await clients.save(clients.create({ userId, name: 'TZ Client' }))).id;
  });
  afterEach(() => {
    jest.useRealTimers();
    if (savedZone === undefined) delete process.env.BUSINESS_TIMEZONE;
    else process.env.BUSINESS_TIMEZONE = savedZone;
  });

  const invoiceRows = async () =>
    (await e2e.dataSource.query(
      `SELECT to_char(issue_date, 'YYYY-MM-DD') AS issue, to_char(due_date, 'YYYY-MM-DD') AS due, number, status
         FROM invoices WHERE user_id = $1 ORDER BY number`,
      [userId],
    )) as { issue: string; due: string | null; number: string; status: string }[];

  it('the clock is where UTC, process-local and business dates differ', () => {
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-12-31');
  });

  it('creating from a template uses the business date and adds days on the calendar', async () => {
    const templates = e2e.moduleFixture.get<Repository<InvoiceTemplate>>(getRepositoryToken(InvoiceTemplate));
    const template = await templates.save(
      templates.create({
        userId,
        name: 'Monthly',
        currency: 'USD',
        defaultDueDays: 30,
        lineItemsJson: [{ description: 'Service', quantity: 1, unitPrice: 100 }],
      }),
    );
    const dto = await e2e.moduleFixture.get(InvoiceTemplatesService).toInvoiceDto(template.id, userId, clientId);
    expect(dto).toMatchObject({ issueDate: TODAY, dueDate: '2027-01-31' });

    await e2e.moduleFixture.get(InvoicesService).create(dto, userId);
    expect(await invoiceRows()).toEqual([
      expect.objectContaining({ issue: TODAY, due: '2027-01-31', number: 'INV-2027-0001' }),
    ]);
  });

  it('the recurring generator runs on the business date', async () => {
    const recurring = e2e.moduleFixture.get<Repository<RecurringInvoice>>(getRepositoryToken(RecurringInvoice));
    const base = {
      userId,
      clientId,
      frequency: RecurrenceFrequency.MONTHLY,
      interval: 1,
      currency: 'USD',
      lineItemsJson: [{ description: 'Retainer', quantity: 1, unitPrice: 50 }],
      startDate: '2026-12-01' as unknown as Date,
    };
    const due = await recurring.save(recurring.create({ ...base, name: 'due today', nextRunDate: TODAY as unknown as Date }));
    const ended = await recurring.save(
      recurring.create({
        ...base,
        name: 'ended yesterday',
        nextRunDate: '2026-12-31' as unknown as Date,
        endDate: '2026-12-31' as unknown as Date,
      }),
    );
    await recurring.save(recurring.create({ ...base, name: 'tomorrow', nextRunDate: '2027-01-02' as unknown as Date }));

    const result = await e2e.moduleFixture.get(RecurringInvoicesService).processRecurringInvoices();
    expect(result).toEqual({ generated: 1, errors: [] });

    expect(await invoiceRows()).toEqual([
      expect.objectContaining({ issue: TODAY, due: '2027-01-31', number: 'INV-2027-0001' }),
    ]);
    const schedule = await e2e.dataSource.query(
      `SELECT id, to_char(next_run_date, 'YYYY-MM-DD') AS next, is_active AS active FROM recurring_invoices WHERE user_id = $1`,
      [userId],
    );
    const byId = Object.fromEntries(schedule.map((r: { id: string }) => [r.id, r]));
    expect(byId[due.id]).toMatchObject({ next: '2027-02-01', active: true });
    expect(byId[ended.id]).toMatchObject({ active: false });
  });

  it('CSV import defaults the issue date to the business date', async () => {
    const csv = `clientId,dueDate,currency\n${clientId},2027-02-15,USD\n`;
    const res = await request(e2e.app.getHttpServer())
      .post('/api/v1/invoices/import/csv')
      .set('Authorization', auth)
      .attach('file', Buffer.from(csv), { filename: 'invoices.csv', contentType: 'text/csv' })
      .expect(201);
    expect(res.body).toMatchObject({ imported: 1, failed: 0 });
    expect(await invoiceRows()).toEqual([expect.objectContaining({ issue: TODAY, due: '2027-02-15' })]);
  });

  it('overdue means due before the business date: due "yesterday" is overdue, due today is not', async () => {
    const make = (number: string, dueDate: string, status = InvoiceStatus.SENT) =>
      invoices.save(
        invoices.create({
          userId,
          clientId,
          number,
          status,
          issueDate: '2026-12-01' as unknown as Date,
          dueDate: dueDate as unknown as Date,
          currency: 'USD',
          subtotal: 1,
          taxTotal: 0,
          discountTotal: 0,
          total: 1,
        }),
      );
    await make('A-due-1230', '2026-12-30');
    await make('B-due-1231', '2026-12-31');
    await make('C-due-0101', TODAY);
    await make('D-due-0102', '2027-01-02');
    await make('E-paid-1230', '2026-12-30', InvoiceStatus.PAID);

    const status = e2e.moduleFixture.get(InvoiceStatusService);
    expect(await status.runOverdueCheck()).toBe(2);
    expect((await invoiceRows()).map((r) => [r.number, r.status])).toEqual([
      ['A-due-1230', InvoiceStatus.OVERDUE],
      ['B-due-1231', InvoiceStatus.OVERDUE],
      ['C-due-0101', InvoiceStatus.SENT],
      ['D-due-0102', InvoiceStatus.SENT],
      ['E-paid-1230', InvoiceStatus.PAID],
    ]);

    // the scheduled job uses the same boundary
    await invoices.update({ number: 'B-due-1231' }, { status: InvoiceStatus.SENT });
    await status.markOverdueInvoices();
    expect((await invoiceRows()).find((r) => r.number === 'B-due-1231')?.status).toBe(InvoiceStatus.OVERDUE);
  });

  it('duplicate takes the business date and numbers by its year', async () => {
    const service = e2e.moduleFixture.get(InvoicesService);
    const original = await service.create(
      { clientId, issueDate: '2026-06-01', dueDate: '2026-07-01', items: [{ description: 'x', quantity: 1, unitPrice: 1 }] },
      userId,
    );
    await service.duplicateInvoice(original.id, userId);
    const rows = await invoiceRows();
    expect(rows).toEqual([
      expect.objectContaining({ issue: '2026-06-01', number: 'INV-2026-0001' }),
      expect.objectContaining({ issue: TODAY, due: '2026-07-01', number: 'INV-2027-0001' }),
    ]);
  });
});
