/**
 * Delivery guarantee of the protocol-2 pull (docs/SYNC-CONTRACT.md
 * "Delivery guarantee"): every change committed after a pull's snapshot is
 * delivered by a later pull, whatever its timestamps, including writes that
 * were still running while a pull read; deletes arrive as tombstones;
 * pagination returns every row of a pull exactly once.
 *
 * Real AppModule and PostgreSQL (test/e2e-app.ts); "late" writes are made in
 * a separate database session whose transaction stays open across a pull.
 */
import * as request from 'supertest';
import { Client as PgClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Client } from '../src/entities/client.entity';
import { Invoice } from '../src/entities/invoice.entity';
import { InvoiceItem } from '../src/entities/invoice-item.entity';
import { Attachment, AttachmentOwnerType } from '../src/entities/attachment.entity';
import { encodeCursor } from '../src/sync/sync-pull-cursor';
import { createE2eApp, E2eApp } from './e2e-app';

describe('Sync pull delivery guarantee (E2E)', () => {
  let e2e: E2eApp;
  let clients: Repository<Client>;
  let invoices: Repository<Invoice>;
  let items: Repository<InvoiceItem>;
  let attachments: Repository<Attachment>;
  let token: string;
  let otherToken: string;
  let userId: string;
  let otherId: string;

  beforeAll(async () => {
    e2e = await createE2eApp();
    clients = e2e.moduleFixture.get(getRepositoryToken(Client));
    invoices = e2e.moduleFixture.get(getRepositoryToken(Invoice));
    items = e2e.moduleFixture.get(getRepositoryToken(InvoiceItem));
    attachments = e2e.moduleFixture.get(getRepositoryToken(Attachment));
  });
  afterAll(async () => {
    await e2e.app.close();
  });
  beforeEach(async () => {
    await e2e.truncateAll();
    const a = await e2e.createUser('delivery-a@example.test');
    const b = await e2e.createUser('delivery-b@example.test');
    token = a.token;
    otherToken = b.token;
    userId = a.user.id;
    otherId = b.user.id;
  });

  const pull = (cursor?: string, limit?: number, t = token) =>
    request(e2e.app.getHttpServer())
      .get('/api/v1/sync/pull')
      .query({ protocol: '2', ...(cursor ? { cursor } : {}), ...(limit ? { limit } : {}) })
      .set('Authorization', `Bearer ${t}`);

  /** A complete pull: every page until hasMore is false. */
  async function pullAll(cursor?: string, limit?: number, t = token) {
    const all = { clients: [] as any[], invoices: [] as any[], invoiceItems: [] as any[], attachments: [] as any[], tombstones: [] as any[] };
    let pages = 0;
    for (;;) {
      const res = await pull(cursor, limit, t).expect(200);
      for (const k of Object.keys(all)) (all as any)[k].push(...res.body[k]);
      cursor = res.body.cursor;
      pages++;
      if (!res.body.hasMore) return { ...all, cursor: cursor as string, pages };
    }
  }

  const writers: PgClient[] = [];
  afterEach(async () => {
    // A failed assertion must not leave a transaction holding locks
    for (const w of writers.splice(0)) await w.end().catch(() => undefined);
  });

  /** A session whose transaction stays open while pulls run. */
  async function openWriter() {
    const writer = new PgClient({
      host: process.env.DB_TEST_HOST || process.env.DB_HOST,
      port: Number(process.env.DB_TEST_PORT || process.env.DB_PORT),
      user: process.env.DB_TEST_USERNAME || process.env.DB_USERNAME,
      password: process.env.DB_TEST_PASSWORD || process.env.DB_PASSWORD,
      database: process.env.DB_TEST_DATABASE,
    });
    await writer.connect();
    writers.push(writer);
    await writer.query('BEGIN');
    return writer;
  }

  async function seed() {
    const client = await clients.save(clients.create({ userId, name: 'before' }));
    const invoice = await invoices.save(
      invoices.create({ userId, clientId: client.id, number: 'D-1', issueDate: '2026-10-01' as any, currency: 'USD' } as Partial<Invoice>),
    );
    const item = await items.save(items.create({ invoiceId: invoice.id, description: 'line', quantity: 1, unitPrice: 1, lineTotal: 1 } as Partial<InvoiceItem>));
    return { client, invoice, item };
  }

  it('a write committed after a pull started is delivered by the next pull (update, insert, delete)', async () => {
    const { client, invoice, item } = await seed();
    const first = await pullAll();
    expect(first.clients.map((c) => c.id)).toEqual([client.id]);

    // Three late writes, made before the next pull starts and committed after it read
    const writer = await openWriter();
    await writer.query(`UPDATE clients SET name = 'late', updated_at = now() - interval '1 hour' WHERE id = $1`, [client.id]);
    const lateItem = uuidv4();
    await writer.query(`INSERT INTO invoice_items (id, invoice_id, description, quantity, unit_price, line_total) VALUES ($1, $2, 'late line', 1, 2, 2)`, [lateItem, invoice.id]);
    await writer.query(`DELETE FROM invoice_items WHERE id = $1`, [item.id]);

    const during = await pullAll(first.cursor);
    expect(during.clients).toEqual([]); // not committed yet
    expect(during.invoiceItems).toEqual([]);
    expect(during.tombstones).toEqual([]);

    await writer.query('COMMIT');
    await writer.end();

    const after = await pullAll(during.cursor);
    expect(after.clients.map((c) => [c.id, c.name])).toEqual([[client.id, 'late']]);
    expect(after.invoiceItems.map((i) => i.id)).toEqual([lateItem]);
    expect(after.tombstones).toEqual([expect.objectContaining({ object_type: 'invoice_item', object_id: item.id })]);

    // Nothing is delivered twice once caught up
    const quiet = await pullAll(after.cursor);
    expect([quiet.clients, quiet.invoiceItems, quiet.tombstones]).toEqual([[], [], []]);
  });

  it('older apps (timestamp pull) still miss such a write: the documented protocol-1 limitation', async () => {
    const { client } = await seed();
    const http = request(e2e.app.getHttpServer());
    const first = await http.get('/api/v1/sync/pull').set('Authorization', `Bearer ${token}`).expect(200);
    const writer = await openWriter();
    await writer.query(`UPDATE clients SET name = 'late', updated_at = now() WHERE id = $1`, [client.id]);
    const middle = await http.get('/api/v1/sync/pull').query({ since: first.body.lastSyncTimestamp }).set('Authorization', `Bearer ${token}`).expect(200);
    await writer.query('COMMIT');
    await writer.end();
    const next = await http.get('/api/v1/sync/pull').query({ since: middle.body.lastSyncTimestamp }).set('Authorization', `Bearer ${token}`).expect(200);
    expect(next.body.clients.some((c: any) => c.name === 'late')).toBe(false);
  });

  it('pages return every record of a pull exactly once; a change during paging arrives on the next pull', async () => {
    const created: string[] = [];
    for (let i = 0; i < 23; i++) created.push((await clients.save(clients.create({ userId, name: `c${i}` }))).id);
    const inv = await invoices.save(invoices.create({ userId, clientId: created[0], number: 'P-1', issueDate: '2026-10-01' as any } as Partial<Invoice>));
    for (let i = 0; i < 6; i++) await items.save(items.create({ invoiceId: inv.id, description: `l${i}`, quantity: 1, unitPrice: 1, lineTotal: 1 } as Partial<InvoiceItem>));

    // First page, then a change to a client already delivered, then the rest
    const page1 = await pull(undefined, 5).expect(200);
    expect(page1.body.hasMore).toBe(true);
    await clients.update({ id: page1.body.clients[0].id }, { name: 'changed while paging' });
    const rest = await pullAll(page1.body.cursor, 5);
    const ids = [...page1.body.clients, ...rest.clients].map((c: any) => c.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates within a pull
    expect(ids.sort()).toEqual([...created].sort()); // ...and none missing
    expect(page1.body.invoices.length + rest.invoices.length).toBe(1);
    expect(page1.body.invoiceItems.length + rest.invoiceItems.length).toBe(6);
    expect(rest.pages).toBeGreaterThan(4);

    const next = await pullAll(rest.cursor, 5);
    expect(next.clients.map((c) => c.name)).toEqual(['changed while paging']);
  });

  it('tombstones page like records: each delivered exactly once', async () => {
    const { invoice } = await seed();
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) ids.push((await items.save(items.create({ invoiceId: invoice.id, description: `t${i}`, quantity: 1, unitPrice: 1, lineTotal: 1 } as Partial<InvoiceItem>))).id);
    const base = await pullAll();
    await items.delete(ids);
    const deletes = await pullAll(base.cursor, 3);
    const got = deletes.tombstones.map((t) => t.object_id);
    expect(new Set(got).size).toBe(got.length);
    expect(got.sort()).toEqual([...ids].sort());
    expect(deletes.pages).toBeGreaterThan(2);
  });

  it('deletes and restores are delivered; another user\'s changes never are', async () => {
    const { client, invoice } = await seed();
    const otherClient = await clients.save(clients.create({ userId: otherId, name: 'not yours' }));
    const first = await pullAll();
    expect(first.clients.map((c) => c.id)).toEqual([client.id]);

    await invoices.update({ id: invoice.id }, { deletedAt: new Date() });
    await clients.update({ id: otherClient.id }, { name: 'still not yours' });
    const deleted = await pullAll(first.cursor);
    expect(deleted.tombstones.map((t) => [t.object_type, t.object_id])).toEqual([['invoice', invoice.id]]);
    expect(deleted.invoices).toEqual([]);
    expect(deleted.clients).toEqual([]);

    await invoices.update({ id: invoice.id }, { deletedAt: null });
    const restored = await pullAll(deleted.cursor);
    expect(restored.invoices.map((i) => i.id)).toEqual([invoice.id]);

    const theirs = await pullAll(undefined, undefined, otherToken);
    expect(theirs.clients.map((c) => c.id)).toEqual([otherClient.id]);
  });

  it('restoring an invoice or client re-delivers its lines and attachments, including edits made while it was deleted', async () => {
    const { client, invoice, item } = await seed();
    const attach = (ownerType: AttachmentOwnerType, ownerId: string) =>
      attachments.save(attachments.create({ ownerType, ownerId, url: 'https://cdn.example.test/receipts/r1.png', filename: 'r1.png' }));
    const invoiceFile = await attach(AttachmentOwnerType.INVOICE, invoice.id);
    const clientFile = await attach(AttachmentOwnerType.CLIENT, client.id);
    const first = await pullAll();
    expect(first.invoiceItems.map((i) => i.id)).toEqual([item.id]);

    // Deleted (devices drop the children with the tombstone), a line edited meanwhile, then restored
    await invoices.update({ id: invoice.id }, { deletedAt: new Date() });
    await clients.update({ id: client.id }, { deletedAt: new Date() });
    const deleted = await pullAll(first.cursor);
    expect(deleted.tombstones.map((t) => t.object_type).sort()).toEqual(['client', 'invoice']);
    await items.update({ id: item.id }, { description: 'edited while deleted' });
    const quiet = await pullAll(deleted.cursor);
    expect(quiet.invoiceItems).toEqual([]); // parent still deleted

    const revisionBefore = (await items.findOneByOrFail({ id: item.id })).revision;
    await clients.update({ id: client.id }, { deletedAt: null });
    await invoices.update({ id: invoice.id }, { deletedAt: null });
    const restored = await pullAll(quiet.cursor);
    expect(restored.invoices.map((i) => i.id)).toEqual([invoice.id]);
    expect(restored.invoiceItems.map((i) => [i.id, i.description])).toEqual([[item.id, 'edited while deleted']]);
    expect(restored.attachments.map((a) => a.id).sort()).toEqual([invoiceFile.id, clientFile.id].sort());
    // Re-delivery does not count as an edit: no revision bump, so no false conflicts
    expect((await items.findOneByOrFail({ id: item.id })).revision).toBe(revisionBefore);
  });

  it('rejects a damaged cursor, and asks for a full resync when the cursor is older than retention', async () => {
    await seed();
    const bad = await pull('not-a-cursor').expect(400);
    expect(bad.body.reason).toBe('invalid_cursor');
    const injected = encodeCursor({ v: 1, snap: "1:2:'; DROP TABLE clients; --", issued: new Date().toISOString() } as any);
    expect((await pull(injected).expect(400)).body.reason).toBe('invalid_cursor');
    // Matches the format but PostgreSQL refuses it (xmin > xmax, unsorted in-progress list)
    for (const snap of ['5:3:', '3:9:7,4']) {
      const c = encodeCursor({ v: 1, snap, issued: new Date().toISOString() });
      expect((await pull(c).expect(400)).body.reason).toBe('invalid_cursor');
    }

    const ancient = encodeCursor({ v: 1, snap: '1:1:', issued: '2000-01-01T00:00:00.000Z' });
    const res = await pull(ancient).expect(200);
    expect(res.body).toMatchObject({ fullResyncRequired: true, hasMore: false, clients: [] });

    // A cursor from a transaction counter ahead of the database's (restored
    // or replaced database): start over rather than skip new writes
    const ahead = '9000000000000:9000000000000:';
    for (const c of [
      encodeCursor({ v: 1, snap: ahead, issued: new Date().toISOString() }),
      encodeCursor({ v: 1, from: null, upto: ahead, t: 0, after: null, issued: new Date().toISOString() }),
    ]) {
      expect((await pull(c).expect(200)).body).toMatchObject({ fullResyncRequired: true, hasMore: false, clients: [] });
    }
    const current = (await pullAll()).cursor;
    expect((await pull(current).expect(200)).body.fullResyncRequired).toBeFalsy();
  });
});
