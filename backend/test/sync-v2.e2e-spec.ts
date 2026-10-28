/**
 * Sync protocol 2 (docs/SYNC-CONTRACT.md "Protocol 2"): revisions, merges,
 * conflicts, tombstones, resolution, and the protocol-1 protections.
 *
 * Real AppModule and PostgreSQL (test/e2e-app.ts); the revision and
 * tombstone triggers are installed by SyncSchemaService because the schema
 * comes from DB_SYNCHRONIZE. Synthetic users only.
 */
import * as request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Client } from '../src/entities/client.entity';
import { Invoice, InvoiceStatus } from '../src/entities/invoice.entity';
import { InvoiceItem } from '../src/entities/invoice-item.entity';
import { SyncConflict } from '../src/entities/sync-conflict.entity';
import { DeviceChange } from '../src/entities/device-change.entity';
import { ApiKeysService } from '../src/api-keys/api-keys.service';
import { SYNC_CONFIG, SyncConfig } from '../src/sync/sync-config';
import { GdprService } from '../src/core/services/gdpr.service';
import { createE2eApp, E2eApp } from './e2e-app';

describe('Sync protocol 2 (E2E)', () => {
  let e2e: E2eApp;
  let clients: Repository<Client>;
  let invoices: Repository<Invoice>;
  let items: Repository<InvoiceItem>;
  let conflicts: Repository<SyncConflict>;
  let changes: Repository<DeviceChange>;
  let config: SyncConfig;
  let tokenA: string;
  let tokenB: string;
  let userA: string;

  beforeAll(async () => {
    e2e = await createE2eApp();
    clients = e2e.moduleFixture.get(getRepositoryToken(Client));
    invoices = e2e.moduleFixture.get(getRepositoryToken(Invoice));
    items = e2e.moduleFixture.get(getRepositoryToken(InvoiceItem));
    conflicts = e2e.moduleFixture.get(getRepositoryToken(SyncConflict));
    changes = e2e.moduleFixture.get(getRepositoryToken(DeviceChange));
    config = e2e.moduleFixture.get(SYNC_CONFIG);
  });
  afterAll(async () => {
    await e2e.app.close();
  });

  beforeEach(async () => {
    await e2e.truncateAll();
    const a = await e2e.createUser('sync2-a@example.test');
    const b = await e2e.createUser('sync2-b@example.test');
    tokenA = a.token;
    tokenB = b.token;
    userA = a.user.id;
  });

  const http = () => request(e2e.app.getHttpServer());

  const change = (objectType: string, objectId: string, changeType: string, data: Record<string, any> = {}, base?: number) => ({
    change_id: uuidv4(),
    ...(base !== undefined ? { base_revision: base } : {}),
    object_type: objectType,
    object_id: objectId,
    change_type: changeType,
    data,
    device_id: 'device-2',
    updated_at: new Date().toISOString(),
  });

  const push2 = (token: string, list: any[]) =>
    http().post('/api/v1/sync/push').set('Authorization', `Bearer ${token}`).send({ protocol: 2, deviceId: 'device-2', changes: list }).expect(200);
  const push1 = (token: string, list: any[]) =>
    http().post('/api/v1/sync/push').set('Authorization', `Bearer ${token}`).send({ deviceId: 'device-1', changes: list }).expect(200);
  const resolve = (token: string, id: string, body: Record<string, any>) =>
    http().post(`/api/v1/sync/conflicts/${id}/resolve`).set('Authorization', `Bearer ${token}`).send(body);

  /** A client and an invoice of user A, created through protocol 2. */
  async function seed(status: InvoiceStatus = InvoiceStatus.DRAFT) {
    const clientId = uuidv4();
    const invoiceId = uuidv4();
    const res = await push2(tokenA, [
      change('client', clientId, 'create', { name: 'Acme', email: 'a@example.test' }),
      change('invoice', invoiceId, 'create', {
        clientId,
        type: 'invoice',
        number: `INV-${invoiceId.slice(0, 6)}`,
        status,
        issueDate: '2026-10-01',
        currency: 'USD',
        subtotal: 100,
        taxTotal: 0,
        discountTotal: 0,
        total: 100,
        notes: 'first',
      }),
    ]);
    expect(res.body.results.map((r: any) => r.status)).toEqual(['applied', 'applied']);
    return { clientId, invoiceId };
  }

  const revisionOf = async (repo: Repository<any>, id: string) => (await repo.findOneByOrFail({ id })).revision;

  describe('revisions', () => {
    it('are set by the database on every write path and cannot be set by a client', async () => {
      const { clientId } = await seed();
      expect(await revisionOf(clients, clientId)).toBe(1);

      const res = await push2(tokenA, [change('client', clientId, 'update', { name: 'Acme 2', revision: 99 }, 1)]);
      expect(res.body.results[0]).toMatchObject({ status: 'applied', revision: 2 });

      // A REST edit bumps it too, so the device's older base becomes stale.
      await http().patch(`/api/v1/clients/${clientId}`).set('Authorization', `Bearer ${tokenA}`).send({ phone: '123' }).expect(200);
      expect(await revisionOf(clients, clientId)).toBe(3);

      // A no-op save does not.
      await clients.update({ id: clientId }, { phone: '123' });
      expect(await revisionOf(clients, clientId)).toBe(3);
    });
  });

  describe('stale writes', () => {
    it('a stale edit of the same field becomes a conflict and overwrites nothing', async () => {
      const { clientId } = await seed();
      await push2(tokenA, [change('client', clientId, 'update', { name: 'Server name' }, 1)]);

      const stale = await push2(tokenA, [change('client', clientId, 'update', { name: 'Offline name', metadataJson: { x: 1 } }, 1)]);
      expect(stale.body.results[0]).toMatchObject({ status: 'conflict' });
      expect(stale.body).toMatchObject({ synced: 0, failed: 1 });
      expect((await clients.findOneByOrFail({ id: clientId })).name).toBe('Server name');

      const conflict = await conflicts.findOneByOrFail({ id: stale.body.results[0].conflict_id });
      expect(conflict).toMatchObject({
        kind: 'stale_edit',
        baseRevision: 1,
        serverRevision: 2,
        clientFields: { name: 'Offline name' },
        conflictingFields: ['name'],
        omittedFields: ['metadataJson'],
      });
      expect(conflict.serverFields).toMatchObject({ name: 'Server name' });
    });

    it('a stale edit of other fields is merged when the history proves it', async () => {
      const { clientId } = await seed();
      await push2(tokenA, [change('client', clientId, 'update', { name: 'Server name' }, 1)]);

      const merged = await push2(tokenA, [change('client', clientId, 'update', { phone: '555' }, 1)]);
      expect(merged.body.results[0]).toMatchObject({ status: 'merged', revision: 3 });
      expect(await clients.findOneByOrFail({ id: clientId })).toMatchObject({ name: 'Server name', phone: '555' });
    });

    it('without complete history the same stale edit is a conflict, not a merge', async () => {
      const { clientId } = await seed();
      await push2(tokenA, [change('client', clientId, 'update', { name: 'Server name' }, 1)]);
      await e2e.dataSource.query(`DELETE FROM sync_record_revisions WHERE object_id = $1`, [clientId]);

      const res = await push2(tokenA, [change('client', clientId, 'update', { phone: '555' }, 1)]);
      expect(res.body.results[0].status).toBe('conflict');
      expect((await clients.findOneByOrFail({ id: clientId })).phone).toBeNull();
    });

    it('a stale edit that sends the current values is applied without a change', async () => {
      const { clientId } = await seed();
      await push2(tokenA, [change('client', clientId, 'update', { name: 'Same' }, 1)]);
      const res = await push2(tokenA, [change('client', clientId, 'update', { name: 'Same' }, 1)]);
      expect(res.body.results[0]).toMatchObject({ status: 'applied', revision: 2 });
      expect(await conflicts.count()).toBe(0);
    });

    it('numbers are compared by value (stored "100.00" equals sent 100)', async () => {
      const { invoiceId } = await seed();
      await push2(tokenA, [change('invoice', invoiceId, 'update', { notes: 'server' }, 1)]);
      const res = await push2(tokenA, [change('invoice', invoiceId, 'update', { total: 100, subtotal: '100' }, 1)]);
      expect(res.body.results[0].status).toBe('applied');
    });
  });

  describe('sent, overdue and paid invoices', () => {
    it.each([InvoiceStatus.SENT, InvoiceStatus.OVERDUE, InvoiceStatus.PAID])(
      'a stale offline edit of a %s invoice is never merged; a current one applies',
      async (status) => {
        const { invoiceId } = await seed(status);
        await invoices.update({ id: invoiceId }, { notes: 'changed on the server' });

        const stale = await push2(tokenA, [change('invoice', invoiceId, 'update', { dueDate: '2026-12-01' }, 1)]);
        expect(stale.body.results[0].status).toBe('conflict');
        expect((await conflicts.findOneByOrFail({ id: stale.body.results[0].conflict_id })).kind).toBe('protected_invoice');
        expect((await invoices.findOneByOrFail({ id: invoiceId })).dueDate).toBeNull();

        // Positive control: no new edit restriction for a current write.
        const current = await push2(tokenA, [change('invoice', invoiceId, 'update', { dueDate: '2026-12-01' }, 2)]);
        expect(current.body.results[0]).toMatchObject({ status: 'applied', revision: 3 });
      },
    );

    it('a stale edit of an item of a paid invoice is a protected conflict', async () => {
      const { invoiceId } = await seed(InvoiceStatus.PAID);
      const itemId = uuidv4();
      // Created by a device that saw the paid invoice (parent_revision current)
      const created = await push2(tokenA, [
        { ...change('invoice_item', itemId, 'create', { invoiceId, description: 'Line', quantity: 1, unitPrice: 100, lineTotal: 100 }), parent_revision: await revisionOf(invoices, invoiceId) },
      ]);
      expect(created.body.results[0].status).toBe('applied');
      await items.update({ id: itemId }, { description: 'Line (server)' });

      const res = await push2(tokenA, [change('invoice_item', itemId, 'update', { quantity: 2 }, 1)]);
      expect(res.body.results[0].status).toBe('conflict');
      expect((await conflicts.findOneByOrFail({ id: res.body.results[0].conflict_id })).kind).toBe('protected_invoice');
      expect(Number((await items.findOneByOrFail({ id: itemId })).quantity)).toBe(1);
    });

    it('an item change made while the invoice was a draft conflicts once the invoice is paid; one that saw it paid applies', async () => {
      const { invoiceId } = await seed();
      const itemId = uuidv4();
      const otherItem = uuidv4();
      await push2(tokenA, [
        { ...change('invoice_item', itemId, 'create', { invoiceId, description: 'Line', quantity: 1, unitPrice: 100, lineTotal: 100 }), parent_revision: 1 },
        { ...change('invoice_item', otherItem, 'create', { invoiceId, description: 'Other', quantity: 1, unitPrice: 5, lineTotal: 5 }), parent_revision: 1 },
      ]);
      // Paid elsewhere: the invoice moves to revision 2; the items do not change.
      await invoices.update({ id: invoiceId }, { status: InvoiceStatus.PAID });
      const paidRevision = await revisionOf(invoices, invoiceId);

      // Offline changes made while it was a draft (item base is still current)
      const stale = await push2(tokenA, [
        { ...change('invoice_item', itemId, 'update', { quantity: 5 }, 1), parent_revision: 1 },
        change('invoice_item', otherItem, 'delete', {}, 1),
        { ...change('invoice_item', uuidv4(), 'create', { invoiceId, description: 'Added offline' }), parent_revision: 1 },
      ]);
      expect(stale.body.results.map((r: any) => r.status)).toEqual(['conflict', 'conflict', 'conflict']);
      expect(Number((await items.findOneByOrFail({ id: itemId })).quantity)).toBe(1);
      expect(await items.existsBy({ id: otherItem })).toBe(true);
      expect(await items.count({ where: { invoiceId } })).toBe(2);
      const kinds = await conflicts.find();
      expect(kinds.every((c) => c.kind === 'protected_invoice')).toBe(true);

      // Positive control: a device that saw the paid invoice can still edit (no new restriction)
      const current = await push2(tokenA, [{ ...change('invoice_item', itemId, 'update', { quantity: 5 }, 1), parent_revision: paidRevision }]);
      expect(current.body.results[0].status).toBe('applied');
      expect(Number((await items.findOneByOrFail({ id: itemId })).quantity)).toBe(5);
    });

    it('moving an item into or out of a paid invoice is a conflict', async () => {
      const draft = await seed();
      const paid = await seed(InvoiceStatus.PAID);
      const itemId = uuidv4();
      await push2(tokenA, [{ ...change('invoice_item', itemId, 'create', { invoiceId: draft.invoiceId, description: 'Line' }), parent_revision: 1 }]);
      const paidRevision = await revisionOf(invoices, paid.invoiceId);
      const move = await push2(tokenA, [
        { ...change('invoice_item', itemId, 'update', { invoiceId: paid.invoiceId }, 1), parent_revision: paidRevision },
      ]);
      expect(move.body.results[0].status).toBe('conflict');
      expect((await items.findOneByOrFail({ id: itemId })).invoiceId).toBe(draft.invoiceId);
    });

    it('a stale delete of a paid invoice is refused (conflict), the invoice stays', async () => {
      const { invoiceId } = await seed(InvoiceStatus.PAID);
      await invoices.update({ id: invoiceId }, { notes: 'later' });
      const res = await push2(tokenA, [change('invoice', invoiceId, 'delete', {}, 1)]);
      expect(res.body.results[0].status).toBe('conflict');
      expect((await invoices.findOneByOrFail({ id: invoiceId })).deletedAt).toBeNull();
    });
  });

  describe('deletes and edits', () => {
    it('delete after a remote edit: the delete wins, the removed version is restorable by the owner', async () => {
      const { clientId } = await seed();
      await push2(tokenA, [change('client', clientId, 'update', { name: 'Edited elsewhere' }, 1)]);

      const del = await push2(tokenA, [change('client', clientId, 'delete', {}, 1)]);
      expect(del.body.results[0]).toMatchObject({ status: 'applied' });
      const conflictId = del.body.results[0].conflict_id;
      expect((await conflicts.findOneByOrFail({ id: conflictId })).kind).toBe('delete_after_edit');
      expect((await clients.findOneByOrFail({ id: clientId })).deletedAt).not.toBeNull();

      const pulled = await http().get('/api/v1/sync/pull').set('Authorization', `Bearer ${tokenA}`).expect(200);
      expect(pulled.body.tombstones).toEqual([expect.objectContaining({ object_type: 'client', object_id: clientId })]);
      expect(pulled.body.clients).toEqual([]);

      const detail = await http().get(`/api/v1/sync/conflicts/${conflictId}`).set('Authorization', `Bearer ${tokenA}`).expect(200);
      expect(detail.body).toMatchObject({ allowed_actions: ['restore', 'dismiss'], current: { deleted: true } });
      await resolve(tokenA, conflictId, { action: 'restore', expected_revision: detail.body.current.revision }).expect(200);
      expect(await clients.findOneByOrFail({ id: clientId })).toMatchObject({ deletedAt: null, name: 'Edited elsewhere' });
      const after = await http().get('/api/v1/sync/pull').set('Authorization', `Bearer ${tokenA}`).expect(200);
      expect(after.body.tombstones).toEqual([]);
    });

    it('edit after delete: the deletion stands, the edit is kept and can be restored with the record', async () => {
      const { clientId } = await seed();
      await push2(tokenA, [change('client', clientId, 'delete', {}, 1)]);

      const edit = await push2(tokenA, [change('client', clientId, 'update', { name: 'Offline edit' }, 1)]);
      expect(edit.body.results[0].status).toBe('conflict');
      expect((await clients.findOneByOrFail({ id: clientId })).deletedAt).not.toBeNull();

      const conflict = await conflicts.findOneByOrFail({ id: edit.body.results[0].conflict_id });
      expect(conflict.kind).toBe('edit_after_delete');
      await resolve(tokenA, conflict.id, { action: 'restore', expected_revision: await revisionOf(clients, clientId) }).expect(200);
      expect(await clients.findOneByOrFail({ id: clientId })).toMatchObject({ deletedAt: null, name: 'Offline edit' });
    });

    it('a deleted item cannot be recreated (by its owner or anyone); restore recreates it explicitly', async () => {
      const { invoiceId } = await seed();
      const itemId = uuidv4();
      const create = change('invoice_item', itemId, 'create', { invoiceId, description: 'Line', quantity: 1, unitPrice: 10, lineTotal: 10 });
      await push2(tokenA, [create]);
      await push2(tokenA, [change('invoice_item', itemId, 'delete', {}, 1)]);

      const again = await push2(tokenA, [{ ...create, change_id: uuidv4() }]);
      expect(again.body.results[0].status).toBe('conflict');
      expect(await items.existsBy({ id: itemId })).toBe(false);

      const other = await push2(tokenB, [change('invoice_item', itemId, 'create', { invoiceId, description: 'x' })]);
      expect(other.body.results[0].status).toBe('failed');

      const conflictId = again.body.results[0].conflict_id;
      const detail = await http().get(`/api/v1/sync/conflicts/${conflictId}`).set('Authorization', `Bearer ${tokenA}`).expect(200);
      await resolve(tokenA, conflictId, { action: 'restore', expected_revision: detail.body.current.revision }).expect(200);
      expect(await items.findOneByOrFail({ id: itemId })).toMatchObject({ invoiceId, description: 'Line' });
    });
  });

  describe('replays and batches', () => {
    it('same change_id and payload: one write; a conflicted change answers the same conflict', async () => {
      const { clientId } = await seed();
      const update = change('client', clientId, 'update', { phone: '1' }, 1);
      expect((await push2(tokenA, [update])).body.results[0].status).toBe('applied');
      expect((await push2(tokenA, [update])).body.results[0].status).toBe('duplicate');
      expect(await revisionOf(clients, clientId)).toBe(2);

      const stale = change('client', clientId, 'update', { phone: '2' }, 1);
      const first = await push2(tokenA, [stale]);
      const second = await push2(tokenA, [stale]);
      expect(first.body.results[0].status).toBe('conflict');
      expect(second.body.results[0]).toMatchObject({ status: 'conflict', conflict_id: first.body.results[0].conflict_id });
      expect(await conflicts.count()).toBe(1);
    });

    it('same change_id with a different payload or base fails and writes nothing', async () => {
      const { clientId } = await seed();
      const update = change('client', clientId, 'update', { phone: '1' }, 1);
      await push2(tokenA, [update]);
      const reused = await push2(tokenA, [{ ...update, data: { phone: '9' } }]);
      expect(reused.body.results[0]).toMatchObject({ status: 'failed', reason: 'change_id_reused' });
      const rebased = await push2(tokenA, [{ ...update, base_revision: 2 }]);
      expect(rebased.body.results[0]).toMatchObject({ status: 'failed', reason: 'change_id_reused' });
      expect((await clients.findOneByOrFail({ id: clientId })).phone).toBe('1');
    });

    it('a partial batch: a change depending on a conflicted one fails, the rest apply, a retry is safe', async () => {
      const { clientId, invoiceId } = await seed();
      await push2(tokenA, [change('invoice', invoiceId, 'delete', {}, 1)]);
      const newInvoice = uuidv4();
      const batch = [
        change('invoice', invoiceId, 'update', { notes: 'offline' }, 1),
        change('invoice_item', uuidv4(), 'create', { invoiceId, description: 'on deleted invoice' }),
        change('client', clientId, 'update', { phone: '7' }, 1),
        change('invoice', newInvoice, 'create', { clientId, number: 'NEW-1', issueDate: '2026-10-02' }),
      ];
      const res = await push2(tokenA, batch);
      expect(res.body.results.map((r: any) => r.status)).toEqual(['conflict', 'failed', 'applied', 'applied']);
      const retry = await push2(tokenA, batch);
      expect(retry.body.results.map((r: any) => r.status)).toEqual(['conflict', 'failed', 'duplicate', 'duplicate']);
      expect(await conflicts.count()).toBe(1);
    });

    it('requires change_id and base_revision in protocol 2', async () => {
      const { clientId } = await seed();
      const withoutId: Record<string, any> = change('client', clientId, 'update', { phone: '1' }, 1);
      delete withoutId.change_id;
      const res = await push2(tokenA, [withoutId, change('client', clientId, 'update', { phone: '1' })]);
      expect(res.body.results.map((r: any) => r.reason)).toEqual(['change_id_required', 'base_revision_required']);
      expect((await clients.findOneByOrFail({ id: clientId })).phone).toBeNull();
    });

    it('concurrent stale writes of one field from two devices: exactly one applies', async () => {
      const { clientId } = await seed();
      const results = await Promise.all(
        ['Device one', 'Device two', 'Device three'].map((name) => push2(tokenA, [change('client', clientId, 'update', { name }, 1)])),
      );
      const statuses = results.map((r) => r.body.results[0].status).sort();
      expect(statuses).toEqual(['applied', 'conflict', 'conflict']);
      expect(await revisionOf(clients, clientId)).toBe(2);
    });
  });

  describe('resolution', () => {
    async function staleConflict() {
      const { clientId } = await seed();
      await push2(tokenA, [change('client', clientId, 'update', { name: 'Server' }, 1)]);
      const res = await push2(tokenA, [change('client', clientId, 'update', { name: 'Mine' }, 1)]);
      return { clientId, conflictId: res.body.results[0].conflict_id as string };
    }

    it('applies the device version only at the reviewed revision, once', async () => {
      const { clientId, conflictId } = await staleConflict();
      const stale = await resolve(tokenA, conflictId, { action: 'apply_client', expected_revision: 1 }).expect(409);
      expect(stale.body.current_revision).toBe(2);
      expect((await clients.findOneByOrFail({ id: clientId })).name).toBe('Server');

      const ok = await resolve(tokenA, conflictId, { action: 'apply_client', expected_revision: 2 }).expect(200);
      expect(ok.body).toMatchObject({ status: 'resolved', resolution: 'apply_client', allowed_actions: [] });
      expect(await clients.findOneByOrFail({ id: clientId })).toMatchObject({ name: 'Mine', revision: 3 });

      await resolve(tokenA, conflictId, { action: 'dismiss' }).expect(409);
    });

    it('concurrent resolutions: exactly one succeeds', async () => {
      const { conflictId } = await staleConflict();
      const codes = (
        await Promise.all([
          resolve(tokenA, conflictId, { action: 'apply_client', expected_revision: 2 }),
          resolve(tokenA, conflictId, { action: 'dismiss' }),
          resolve(tokenA, conflictId, { action: 'apply_client', expected_revision: 2 }),
        ])
      )
        .map((r) => r.status)
        .sort();
      expect(codes).toEqual([200, 409, 409]);
    });

    it('a protected-invoice conflict can only be dismissed', async () => {
      const { invoiceId } = await seed(InvoiceStatus.SENT);
      await invoices.update({ id: invoiceId }, { notes: 'server' });
      const res = await push2(tokenA, [change('invoice', invoiceId, 'update', { notes: 'mine' }, 1)]);
      const id = res.body.results[0].conflict_id;
      await resolve(tokenA, id, { action: 'apply_client', expected_revision: 2 }).expect(400);
      await resolve(tokenA, id, { action: 'dismiss' }).expect(200);
      expect((await invoices.findOneByOrFail({ id: invoiceId })).notes).toBe('server');
    });

    it("another user's conflict is invisible and cannot be resolved; API keys are refused", async () => {
      const { conflictId } = await staleConflict();
      await http().get(`/api/v1/sync/conflicts/${conflictId}`).set('Authorization', `Bearer ${tokenB}`).expect(404);
      await resolve(tokenB, conflictId, { action: 'dismiss' }).expect(404);
      expect((await http().get('/api/v1/sync/conflicts').set('Authorization', `Bearer ${tokenB}`).expect(200)).body).toEqual([]);

      const apiKeys = e2e.moduleFixture.get(ApiKeysService);
      const { key } = await apiKeys.generateApiKey(userA, 'full', ['*']);
      await http().get('/api/v1/sync/conflicts').set('X-API-Key', key).expect(401);
      await http().post(`/api/v1/sync/conflicts/${conflictId}/resolve`).set('X-API-Key', key).send({ action: 'dismiss' }).expect(401);

      // Positive control: the owner sees it.
      const mine = await http().get('/api/v1/sync/conflicts').set('Authorization', `Bearer ${tokenA}`).expect(200);
      expect(mine.body.map((c: any) => c.id)).toEqual([conflictId]);
      expect(mine.body[0]).toMatchObject({ label: 'Client Server', kind: 'stale_edit' }); // server name, not the device's
    });

    it('keeps only allowlisted, size-bounded fields', async () => {
      const { invoiceId } = await seed();
      await invoices.update({ id: invoiceId }, { notes: 'server' });
      const res = await push2(tokenA, [
        change('invoice', invoiceId, 'update', { notes: 'x'.repeat(5000), metadataJson: { card: '4242', secret: 's' } }, 1),
      ]);
      const conflict = await conflicts.findOneByOrFail({ id: res.body.results[0].conflict_id });
      expect(conflict.clientFields.notes.length).toBeLessThan(2100);
      expect(conflict.omittedFields).toEqual(['metadataJson']);
      expect(JSON.stringify(conflict)).not.toContain('4242');
    });
  });

  describe('account deletion', () => {
    it("removes the user's conflicts and item snapshots, keeps tombstone ids; other users untouched", async () => {
      const { clientId, invoiceId } = await seed();
      await push2(tokenA, [change('client', clientId, 'update', { name: 'Server' }, 1)]);
      await push2(tokenA, [change('client', clientId, 'update', { name: 'Mine' }, 1)]);
      const itemId = uuidv4();
      await push2(tokenA, [change('invoice_item', itemId, 'create', { invoiceId, description: 'private line' })]);
      await push2(tokenA, [change('invoice_item', itemId, 'delete', {}, 1)]);

      const other = await push2(tokenB, [change('client', uuidv4(), 'create', { name: 'B' })]);
      expect(other.body.results[0].status).toBe('applied');

      await e2e.moduleFixture.get(GdprService).deleteUserData(userA);
      expect(await conflicts.count({ where: { userId: userA } })).toBe(0);
      const [tomb] = await e2e.dataSource.query('SELECT last_state FROM sync_tombstones WHERE object_id = $1', [itemId]);
      expect(tomb).toEqual({ last_state: null });
      expect(await clients.count()).toBe(2);
    });
  });

  describe('protocol 1 (older apps)', () => {
    it('applies ordinary writes as before (last applied wins)', async () => {
      const { clientId } = await seed();
      await push2(tokenA, [change('client', clientId, 'update', { name: 'Newer' }, 1)]);
      const old: Record<string, any> = change('client', clientId, 'update', { name: 'Older' });
      delete old.change_id; // protocol 1: the released app sends neither change_id nor base_revision
      const res = await push1(tokenA, [old]);
      expect(res.body).toMatchObject({ protocol: 1, synced: 1, failed: 0 });
      expect((await clients.findOneByOrFail({ id: clientId })).name).toBe('Older');
    });

    it('refuses edits that would bypass protected-invoice, deletion or conflict protections', async () => {
      const sent = await seed(InvoiceStatus.SENT);
      const draft = await seed();
      await push2(tokenA, [change('client', draft.clientId, 'update', { name: 'Server' }, 1)]);
      await push2(tokenA, [change('client', draft.clientId, 'update', { name: 'Mine' }, 1)]); // open conflict
      const deletedClient = uuidv4();
      await push2(tokenA, [change('client', deletedClient, 'create', { name: 'Gone' })]);
      await push2(tokenA, [change('client', deletedClient, 'delete', {}, 1)]);

      const res = await push1(tokenA, [
        { object_type: 'invoice', object_id: sent.invoiceId, change_type: 'update', data: { notes: 'x' }, device_id: 'd' },
        { object_type: 'invoice', object_id: sent.invoiceId, change_type: 'delete', data: {}, device_id: 'd' },
        { object_type: 'client', object_id: deletedClient, change_type: 'update', data: { name: 'Back', deletedAt: null }, device_id: 'd' },
        { object_type: 'client', object_id: draft.clientId, change_type: 'update', data: { name: 'Old app' }, device_id: 'd' },
        { object_type: 'client', object_id: uuidv4(), change_type: 'create', data: { name: 'Fresh' }, device_id: 'd' },
      ]);
      expect(res.body.results.map((r: any) => [r.status, r.reason ?? null])).toEqual([
        ['failed', 'client_upgrade_required'],
        ['failed', 'client_upgrade_required'],
        ['failed', 'record_deleted'],
        ['failed', 'open_conflict'],
        ['applied', null],
      ]);
      expect((await invoices.findOneByOrFail({ id: sent.invoiceId })).notes).toBe('first');
      expect((await clients.findOneByOrFail({ id: deletedClient })).deletedAt).not.toBeNull();
    });

    it('refuses item creates in, and item moves into, a sent or paid invoice', async () => {
      const paid = await seed(InvoiceStatus.PAID);
      const draft = await seed();
      const moved = uuidv4();
      await push2(tokenA, [change('invoice_item', moved, 'create', { invoiceId: draft.invoiceId, description: 'Draft line', quantity: 1, unitPrice: 1, lineTotal: 1 })]);

      const res = await push1(tokenA, [
        {
          object_type: 'invoice_item',
          object_id: uuidv4(),
          change_type: 'create',
          data: { invoiceId: paid.invoiceId, description: 'Added offline', quantity: 1, unitPrice: 50, lineTotal: 50 },
          device_id: 'd',
        },
        { object_type: 'invoice_item', object_id: moved, change_type: 'update', data: { invoiceId: paid.invoiceId }, device_id: 'd' },
      ]);
      expect(res.body.results.map((r: any) => [r.status, r.reason ?? null])).toEqual([
        ['failed', 'client_upgrade_required'],
        ['failed', 'client_upgrade_required'],
      ]);
      expect(await items.countBy({ invoiceId: paid.invoiceId })).toBe(0);

      // Protocol 2: a stale move into a paid invoice is a protected conflict, never a merge.
      await items.update({ id: moved }, { description: 'Changed on the server' });
      const stale = await push2(tokenA, [change('invoice_item', moved, 'update', { invoiceId: paid.invoiceId }, 1)]);
      expect(stale.body.results[0].status).toBe('conflict');
      expect((await conflicts.findOneByOrFail({ id: stale.body.results[0].conflict_id })).kind).toBe('protected_invoice');
      expect((await items.findOneByOrFail({ id: moved })).invoiceId).toBe(draft.invoiceId);

      // Positive control: a protocol-1 item create in a draft invoice still applies.
      const ok = await push1(tokenA, [
        { object_type: 'invoice_item', object_id: uuidv4(), change_type: 'create', data: { invoiceId: draft.invoiceId, description: 'Fine', quantity: 1, unitPrice: 1, lineTotal: 1 }, device_id: 'd' },
      ]);
      expect(ok.body.results[0].status).toBe('applied');
    });

    it('after the configured cutoff: every write refused with an upgrade notice; reads still work', async () => {
      const { clientId } = await seed();
      const saved = config.legacyWriteCutoff;
      config.legacyWriteCutoff = new Date(Date.now() - 1000);
      try {
        const res = await push1(tokenA, [
          { object_type: 'client', object_id: clientId, change_type: 'update', data: { name: 'x' }, device_id: 'd' },
        ]);
        expect(res.body).toMatchObject({ synced: 0, failed: 1, notice: 'client_upgrade_required' });
        expect(res.body.results[0].reason).toBe('client_upgrade_required');
        expect((await clients.findOneByOrFail({ id: clientId })).name).toBe('Acme');
        await http().get('/api/v1/sync/pull').set('Authorization', `Bearer ${tokenA}`).expect(200);
        // Positive control: protocol 2 is unaffected.
        expect((await push2(tokenA, [change('client', clientId, 'update', { name: 'y' }, 1)])).body.results[0].status).toBe('applied');
      } finally {
        config.legacyWriteCutoff = saved;
      }
      expect(await changes.count({ where: { deviceId: 'd' } })).toBe(0);
    });
  });

  describe('pull', () => {
    it('returns revisions, item-only changes, open conflicts, and asks for a full resync past retention', async () => {
      const { invoiceId } = await seed();
      const itemId = uuidv4();
      await push2(tokenA, [change('invoice_item', itemId, 'create', { invoiceId, description: 'L' })]);
      const first = await http().get('/api/v1/sync/pull').set('Authorization', `Bearer ${tokenA}`).expect(200);
      expect(first.body.invoices[0]).toMatchObject({ id: invoiceId, revision: 1 });
      expect(first.body).toMatchObject({ protocol: 2, fullResyncRequired: false, openConflicts: 0 });

      await push2(tokenA, [change('invoice_item', itemId, 'update', { description: 'L2' }, 1)]);
      const next = await http()
        .get('/api/v1/sync/pull')
        .query({ since: first.body.lastSyncTimestamp })
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(next.body.invoices).toEqual([]);
      expect(next.body.invoiceItems).toEqual([expect.objectContaining({ id: itemId, description: 'L2', revision: 2 })]);

      const old = await http().get('/api/v1/sync/pull').query({ since: '2000-01-01T00:00:00Z' }).set('Authorization', `Bearer ${tokenA}`).expect(200);
      expect(old.body.fullResyncRequired).toBe(true);
    });
  });
});
