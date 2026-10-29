/**
 * Conflict resolution keeps invoice totals consistent with the invoice's
 * lines: restoring or applying an item recomputes its line total and the
 * invoice's subtotal, tax, discount and total in the same transaction, from
 * the invoice business rules (invoices/invoice-totals.ts). A restore into a
 * sent, overdue or paid invoice is refused and the conflict stays open.
 *
 * Real AppModule and PostgreSQL (test/e2e-app.ts).
 */
import * as request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Client } from '../src/entities/client.entity';
import { Invoice, InvoiceStatus } from '../src/entities/invoice.entity';
import { InvoiceItem } from '../src/entities/invoice-item.entity';
import { SyncConflict } from '../src/entities/sync-conflict.entity';
import { calculateTotals } from '../src/invoices/invoice-totals';
import { createE2eApp, E2eApp } from './e2e-app';

describe('Conflict resolution keeps invoice totals consistent (E2E)', () => {
  let e2e: E2eApp;
  let clients: Repository<Client>;
  let invoices: Repository<Invoice>;
  let items: Repository<InvoiceItem>;
  let conflicts: Repository<SyncConflict>;
  let token: string;
  let otherToken: string;
  let userId: string;

  beforeAll(async () => {
    e2e = await createE2eApp();
    clients = e2e.moduleFixture.get(getRepositoryToken(Client));
    invoices = e2e.moduleFixture.get(getRepositoryToken(Invoice));
    items = e2e.moduleFixture.get(getRepositoryToken(InvoiceItem));
    conflicts = e2e.moduleFixture.get(getRepositoryToken(SyncConflict));
  });
  afterAll(async () => {
    await e2e.app.close();
  });
  beforeEach(async () => {
    await e2e.truncateAll();
    const a = await e2e.createUser('totals-a@example.test');
    const b = await e2e.createUser('totals-b@example.test');
    token = a.token;
    otherToken = b.token;
    userId = a.user.id;
  });

  const http = () => request(e2e.app.getHttpServer());
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });

  /** Invoice totals recomputed from its stored lines, and the stored totals. */
  async function totalsOf(invoiceId: string) {
    const lines = await items.find({ where: { invoiceId } });
    const invoice = await invoices.findOneByOrFail({ id: invoiceId });
    return {
      expected: calculateTotals(lines),
      stored: {
        subtotal: Number(invoice.subtotal),
        taxTotal: Number(invoice.taxTotal),
        discountTotal: Number(invoice.discountTotal),
        total: Number(invoice.total),
      },
      lineTotalsOk: lines.every(
        (l) => Number(l.lineTotal) === Math.round(Number(l.quantity) * Number(l.unitPrice) * (1 - Number(l.discountRate) / 100) * (1 + Number(l.taxRate) / 100) * 100) / 100,
      ),
    };
  }

  /**
   * The reported case: the web replaces an invoice's lines (deleting line B),
   * a phone edited B offline; its edit becomes an edit_after_delete conflict.
   */
  async function editAfterDeleteOfLine(status: InvoiceStatus = InvoiceStatus.DRAFT) {
    const client = await clients.save(clients.create({ userId, name: 'C' }));
    const created = await http()
      .post('/api/v1/invoices')
      .set(auth())
      .send({
        clientId: client.id,
        issueDate: '2026-10-01',
        status: InvoiceStatus.DRAFT,
        items: [
          { description: 'A', quantity: 1, unitPrice: 100, taxRate: 10 },
          { description: 'B', quantity: 2, unitPrice: 50, discountRate: 10 },
        ],
      })
      .expect(201);
    const invoiceId = created.body.id;
    const lineB = (await items.find({ where: { invoiceId } })).find((l) => l.description === 'B')!;

    // Web edit: lines replaced (B is deleted, C added); REST recomputes totals.
    await http()
      .patch(`/api/v1/invoices/${invoiceId}`)
      .set(auth())
      .send({ items: [{ description: 'A', quantity: 1, unitPrice: 100, taxRate: 10 }, { description: 'C', quantity: 1, unitPrice: 30 }] })
      .expect(200);
    if (status !== InvoiceStatus.DRAFT) await invoices.update({ id: invoiceId }, { status });
    const invoiceRevision = (await invoices.findOneByOrFail({ id: invoiceId })).revision;

    // The phone's offline edit of B (it saw the invoice as it is now)
    const push = await http()
      .post('/api/v1/sync/push')
      .set(auth())
      .send({
        protocol: 2,
        deviceId: 'phone',
        changes: [
          {
            change_id: uuidv4(),
            base_revision: 1,
            parent_revision: invoiceRevision,
            object_type: 'invoice_item',
            object_id: lineB.id,
            change_type: 'update',
            data: { quantity: 3, lineTotal: 1 /* a wrong client-side value */ },
            device_id: 'phone',
          },
        ],
      })
      .expect(200);
    const conflictId = push.body.results[0].conflict_id as string;
    expect(push.body.results[0].status).toBe('conflict');
    return { invoiceId, lineB, conflictId };
  }

  const detail = (id: string, t = token) => http().get(`/api/v1/sync/conflicts/${id}`).set(auth(t)).expect(t === token ? 200 : 404);
  const resolve = (id: string, body: Record<string, any>, t = token) => http().post(`/api/v1/sync/conflicts/${id}/resolve`).set(auth(t)).send(body);

  it('restoring a deleted line recomputes its line total and the invoice totals', async () => {
    const { invoiceId, lineB, conflictId } = await editAfterDeleteOfLine();
    const before = await totalsOf(invoiceId);
    expect(before.stored).toEqual(before.expected);

    const d = await detail(conflictId);
    await resolve(conflictId, { action: 'restore', expected_revision: d.body.current.revision }).expect(200);

    const restored = await items.findOneByOrFail({ id: lineB.id });
    expect(Number(restored.quantity)).toBe(3);
    expect(Number(restored.lineTotal)).toBe(135); // 3 x 50, -10% = 135; the client's 1 is ignored
    const after = await totalsOf(invoiceId);
    expect(after.lineTotalsOk).toBe(true);
    expect(after.stored).toEqual(after.expected);
    expect(after.stored.total).toBe(110 + 30 + 135);
  });

  it.each([InvoiceStatus.SENT, InvoiceStatus.OVERDUE, InvoiceStatus.PAID])(
    'restoring a line into a %s invoice is refused; nothing changes and the conflict stays open',
    async (status) => {
      const { invoiceId, lineB, conflictId } = await editAfterDeleteOfLine(status);
      const before = await invoices.findOneByOrFail({ id: invoiceId });
      const d = await detail(conflictId);
      const res = await resolve(conflictId, { action: 'restore', expected_revision: d.body.current.revision }).expect(422);
      expect(res.body.message).toMatch(/sent or paid/);
      expect(await items.existsBy({ id: lineB.id })).toBe(false);
      const after = await invoices.findOneByOrFail({ id: invoiceId });
      expect([after.total, after.revision]).toEqual([before.total, before.revision]);
      const conflict = await conflicts.findOneByOrFail({ id: conflictId });
      expect(conflict.status).toBe('open');
      expect(conflict.clientFields).toMatchObject({ quantity: 3 }); // the proposed edit is kept for review
    },
  );

  it('applying a device version of a line recomputes totals too', async () => {
    const client = await clients.save(clients.create({ userId, name: 'C' }));
    const created = await http()
      .post('/api/v1/invoices')
      .set(auth())
      .send({ clientId: client.id, issueDate: '2026-10-01',
        status: InvoiceStatus.DRAFT, items: [{ description: 'A', quantity: 1, unitPrice: 100 }] })
      .expect(201);
    const line = (await items.find({ where: { invoiceId: created.body.id } }))[0];
    await items.update({ id: line.id }, { description: 'A (server)' }); // a server edit of the same field
    const invoiceRevision = (await invoices.findOneByOrFail({ id: created.body.id })).revision;
    const push = await http()
      .post('/api/v1/sync/push')
      .set(auth())
      .send({
        protocol: 2,
        deviceId: 'phone',
        changes: [
          {
            change_id: uuidv4(), base_revision: 1, parent_revision: invoiceRevision, object_type: 'invoice_item', object_id: line.id,
            change_type: 'update', data: { description: 'A (phone)', quantity: 4 }, device_id: 'phone',
          },
        ],
      })
      .expect(200);
    const conflictId = push.body.results[0].conflict_id;
    const d = await detail(conflictId);
    await resolve(conflictId, { action: 'apply_client', expected_revision: d.body.current.revision }).expect(200);
    const after = await totalsOf(created.body.id);
    expect(after.stored).toEqual(after.expected);
    expect(after.stored.total).toBe(400);
  });

  it('concurrent resolutions of one restore: exactly one succeeds and the totals count the line once', async () => {
    const { invoiceId, conflictId } = await editAfterDeleteOfLine();
    const d = await detail(conflictId);
    const codes = (
      await Promise.all([1, 2, 3].map(() => resolve(conflictId, { action: 'restore', expected_revision: d.body.current.revision })))
    )
      .map((r) => r.status)
      .sort();
    expect(codes).toEqual([200, 409, 409]);
    const after = await totalsOf(invoiceId);
    expect(after.stored).toEqual(after.expected);
    expect(await items.count({ where: { invoiceId } })).toBe(3);
  });

  it("another user cannot see or restore the conflict", async () => {
    const { conflictId } = await editAfterDeleteOfLine();
    await detail(conflictId, otherToken);
    await resolve(conflictId, { action: 'restore', expected_revision: 1 }, otherToken).expect(404);
  });
});
