/**
 * Soft-deleted clients and invoices are gone from the active dataset.
 *
 * Queries filtered with `where: { deletedAt: null }`, which TypeORM 0.3
 * ignores, so deleted records were still served by id, accepted as
 * references, exported and marked overdue. They now use IsNull().
 * Real AppModule and PostgreSQL (test/e2e-app.ts).
 */
import * as request from 'supertest';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Client } from '../src/entities/client.entity';
import { Invoice, InvoiceStatus } from '../src/entities/invoice.entity';
import { InvoiceStatusService } from '../src/invoices/invoice-status.service';
import { createE2eApp, E2eApp } from './e2e-app';

describe('Soft-deleted records (E2E)', () => {
  let e2e: E2eApp;
  let clients: Repository<Client>;
  let invoices: Repository<Invoice>;
  let auth: string;
  let userId: string;

  beforeAll(async () => {
    e2e = await createE2eApp();
    clients = e2e.moduleFixture.get(getRepositoryToken(Client));
    invoices = e2e.moduleFixture.get(getRepositoryToken(Invoice));
  });
  afterAll(async () => {
    await e2e.app.close();
  });
  beforeEach(async () => {
    await e2e.truncateAll();
    const { user, token } = await e2e.createUser('soft-delete@example.test');
    userId = user.id;
    auth = `Bearer ${token}`;
  });

  const http = () => request(e2e.app.getHttpServer());
  const invoiceRow = (clientId: string, number: string, extra: Partial<Invoice> = {}) =>
    invoices.save(
      invoices.create({
        userId,
        clientId,
        number,
        issueDate: '2026-01-01' as any,
        currency: 'USD',
        subtotal: 10,
        taxTotal: 0,
        discountTotal: 0,
        total: 10,
        ...extra,
      } as Partial<Invoice>),
    );

  it('a deleted client is not served, referenced or exported; an active one is', async () => {
    const active = await clients.save(clients.create({ userId, name: 'Active' }));
    const gone = await clients.save(clients.create({ userId, name: 'Gone', deletedAt: new Date() }));

    await http().get(`/api/v1/clients/${gone.id}`).set('Authorization', auth).expect(404);
    await http().get(`/api/v1/clients/${active.id}`).set('Authorization', auth).expect(200);

    const body = (clientId: string) => ({ clientId, issueDate: '2026-10-01', items: [{ description: 'x', quantity: 1, unitPrice: 1 }] });
    await http().post('/api/v1/invoices').set('Authorization', auth).send(body(gone.id)).expect(404);
    await http().post('/api/v1/invoices').set('Authorization', auth).send(body(active.id)).expect(201);

    const csv = await http().get('/api/v1/clients/export/csv').set('Authorization', auth).expect(200);
    expect(csv.text).toContain('Active');
    expect(csv.text).not.toContain('Gone');
  });

  it('a deleted invoice is not served or marked overdue; an active one is', async () => {
    const client = await clients.save(clients.create({ userId, name: 'C' }));
    const active = await invoiceRow(client.id, 'A-1', { status: InvoiceStatus.SENT, dueDate: '2026-01-02' as any });
    const gone = await invoiceRow(client.id, 'G-1', { status: InvoiceStatus.SENT, dueDate: '2026-01-02' as any, deletedAt: new Date() });

    await http().get(`/api/v1/invoices/${gone.id}`).set('Authorization', auth).expect(404);
    await http().get(`/api/v1/invoices/${active.id}`).set('Authorization', auth).expect(200);

    await e2e.moduleFixture.get(InvoiceStatusService).runOverdueCheck();
    expect((await invoices.findOneByOrFail({ id: active.id })).status).toBe(InvoiceStatus.OVERDUE);
    expect((await invoices.findOneByOrFail({ id: gone.id })).status).toBe(InvoiceStatus.SENT);
  });
});
