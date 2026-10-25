import { spawnSync } from 'child_process';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { Client as PgClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { User } from '../src/entities/user.entity';
import { Client } from '../src/entities/client.entity';
import { Invoice, InvoiceType, InvoiceStatus } from '../src/entities/invoice.entity';
import { InvoiceItem } from '../src/entities/invoice-item.entity';
import { Attachment, AttachmentOwnerType } from '../src/entities/attachment.entity';
import { RecurringInvoice, RecurrenceFrequency } from '../src/entities/recurring-invoice.entity';
import { DeviceChange, ChangeType, ChangeObjectType } from '../src/entities/device-change.entity';
import { runIntegrityReport, formatReport, INTEGRITY_CHECKS, connectionConfig, QueryClient, exitCodeFor } from '../src/integrity/integrity-report';

/**
 * The integrity report against the disposable test database, seeded with one
 * malformed row per check. Synthetic users only.
 */

const env = process.env;
const db = {
  host: env.DB_TEST_HOST || env.DB_HOST,
  port: Number(env.DB_TEST_PORT || env.DB_PORT),
  username: env.DB_TEST_USERNAME || env.DB_USERNAME,
  password: env.DB_TEST_PASSWORD || env.DB_PASSWORD,
  database: env.DB_TEST_DATABASE || (env.DB_DATABASE ? env.DB_DATABASE + '_test' : undefined),
};

describe('Integrity report (read-only, E2E)', () => {
  let ds: DataSource;
  let pg: PgClient;
  const ids: Record<string, string> = {};

  // Fingerprint of every table, to prove the report wrote nothing
  const snapshot = async (): Promise<Record<string, string>> => {
    const out: Record<string, string> = {};
    for (const md of ds.entityMetadatas) {
      const [row] = await ds.query(
        `SELECT count(*)::int AS n, md5(coalesce(string_agg(t::text, ',' ORDER BY t::text), '')) AS h FROM "${md.tableName}" t`,
      );
      out[md.tableName] = `${row.n}:${row.h}`;
    }
    return out;
  };

  const truncateAll = () =>
    ds.query('TRUNCATE TABLE ' + ds.entityMetadatas.map((md) => `"${md.tableName}"`).join(', ') + ' RESTART IDENTITY CASCADE');

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      ...db,
      entities: [__dirname + '/../src/entities/**/*.entity.ts'],
      synchronize: env.DB_SYNCHRONIZE === 'true',
      logging: false,
    });
    await ds.initialize();
    pg = new PgClient({ host: db.host, port: db.port, user: db.username, password: db.password, database: db.database });
    await pg.connect();
  });

  afterAll(async () => {
    await pg.end();
    await ds.destroy();
  });

  beforeEach(async () => {
    await truncateAll();
    const save = <T>(entity: new () => T, data: Partial<T>) => ds.getRepository(entity).save(ds.getRepository(entity).create(data as any)) as Promise<T>;
    const invoice = (userId: string, clientId: string, number: string) =>
      save(Invoice, { userId, clientId, number, type: InvoiceType.INVOICE, status: InvoiceStatus.DRAFT, issueDate: new Date(), currency: 'USD' });
    const change = (userId: string, objectType: ChangeObjectType, objectId: string, changeType: ChangeType, changeJson: object, synced = true) =>
      save(DeviceChange, { userId, deviceId: 'legacy', objectType, objectId, changeType, changeJson, synced });

    const a = await save(User, { email: 'report-a@example.test', passwordHash: 'x', name: 'A' });
    const b = await save(User, { email: 'report-b@example.test', passwordHash: 'x', name: 'B' });
    ids.userA = a.id;
    ids.userB = b.id;
    const clientA = await save(Client, { userId: a.id, name: 'A client' });
    const clientB = await save(Client, { userId: b.id, name: 'B client' });
    ids.clientB = clientB.id;

    const invoiceA = await invoice(a.id, clientA.id, 'A-1');
    const invoiceB = await invoice(b.id, clientB.id, 'B-1');
    ids.invoiceBad = (await invoice(a.id, clientB.id, 'A-2')).id; // invoice_foreign_client
    ids.recurringBad = (
      await save(RecurringInvoice, {
        userId: a.id,
        clientId: clientB.id,
        name: 'bad',
        frequency: RecurrenceFrequency.MONTHLY,
        startDate: new Date(),
        nextRunDate: new Date(),
        lineItemsJson: [],
      })
    ).id; // recurring_invoice_foreign_client

    // A injected an item into B's invoice: applied_change_by_other_user
    const injected = await save(InvoiceItem, { invoiceId: invoiceB.id, description: 'injected' });
    ids.injected = injected.id;
    await change(a.id, ChangeObjectType.INVOICE_ITEM, injected.id, ChangeType.CREATE, { invoiceId: invoiceB.id });

    // B created an attachment, A re-pointed it at A's invoice: applied_change_by_other_user
    // (B's create), object_changed_by_several_users, relation_repointed_by_sync
    const moved = await save(Attachment, { ownerType: AttachmentOwnerType.INVOICE, ownerId: invoiceA.id, url: 'u', filename: 'f' });
    ids.moved = moved.id;
    await change(b.id, ChangeObjectType.ATTACHMENT, moved.id, ChangeType.CREATE, { ownerType: 'invoice', ownerId: invoiceB.id });
    await change(a.id, ChangeObjectType.ATTACHMENT, moved.id, ChangeType.UPDATE, { ownerId: invoiceA.id });

    // A took over an invoice by sending userId: owner_field_in_change
    const taken = await invoice(a.id, clientA.id, 'A-3');
    ids.taken = taken.id;
    await change(a.id, ChangeObjectType.INVOICE, taken.id, ChangeType.UPDATE, { userId: a.id });

    // attachment_without_owner
    ids.orphan = (await save(Attachment, { ownerType: AttachmentOwnerType.INVOICE, ownerId: uuidv4(), url: 'u', filename: 'o' })).id;

    // Info only: a rejected attempt, and a delete of something A never created
    const itemB = await save(InvoiceItem, { invoiceId: invoiceB.id, description: 'B line' });
    await change(a.id, ChangeObjectType.INVOICE_ITEM, itemB.id, ChangeType.UPDATE, { description: 'x' }, false);
    ids.deleted = uuidv4();
    await change(a.id, ChangeObjectType.INVOICE_ITEM, ids.deleted, ChangeType.DELETE, {});
  });

  it('reports every seeded cross-owner relationship with its ids', async () => {
    const report = await runIntegrityReport(pg);
    const byId = Object.fromEntries(report.results.map((r) => [r.id, r]));
    expect(report.results.map((r) => r.id)).toEqual(INTEGRITY_CHECKS.map((c) => c.id));

    expect(byId.invoice_foreign_client.rows).toEqual([
      expect.objectContaining({ invoice_id: ids.invoiceBad, invoice_owner: ids.userA, client_id: ids.clientB, client_owner: ids.userB }),
    ]);
    expect(byId.recurring_invoice_foreign_client.rows).toEqual([
      expect.objectContaining({ recurring_invoice_id: ids.recurringBad, client_owner: ids.userB }),
    ]);
    expect(byId.applied_change_by_other_user.rows.map((r) => [r.object_id, r.actor, r.owner])).toEqual([
      [ids.injected, ids.userA, ids.userB],
      [ids.moved, ids.userB, ids.userA],
    ]);
    expect(byId.object_changed_by_several_users.rows).toEqual([
      expect.objectContaining({ object_type: 'attachment', object_id: ids.moved, actors: [ids.userA, ids.userB].sort() }),
    ]);
    expect(byId.owner_field_in_change.rows).toEqual([expect.objectContaining({ object_id: ids.taken, requested_owner: ids.userA })]);
    expect(byId.relation_repointed_by_sync.rows).toEqual([expect.objectContaining({ object_id: ids.moved, keys: ['ownerId'] })]);
    expect(byId.attachment_without_owner.rows).toEqual([expect.objectContaining({ attachment_id: ids.orphan })]);

    expect(byId.rejected_change_by_other_user.count).toBe(1);
    expect(byId.applied_delete_without_create.rows).toEqual([expect.objectContaining({ object_id: ids.deleted })]);
    expect(report.findingCount).toBe(8);

    const text = formatReport(report);
    expect(text).toContain(`[FINDING] invoice_foreign_client: 1`);
    expect(text).toContain(ids.invoiceBad);
  });

  it('writes nothing', async () => {
    const before = await snapshot();
    await runIntegrityReport(pg);
    expect(await snapshot()).toEqual(before);
  });

  it('runs in a read-only transaction: a write inside it is refused, reported NOT CHECKED, and rolled back', async () => {
    const before = await snapshot();
    const report = await runIntegrityReport(pg, [
      { id: 'write', level: 'finding', description: 'write probe', requires: {}, sql: `UPDATE users SET name = 'changed'` },
    ]);
    expect(report.results[0].status).toBe('not_checked');
    expect(report.results[0].reason).toMatch(/read-only transaction/);
    // A refused check never counts towards a clean result.
    expect(exitCodeFor(report)).toBe(3);
    expect(await snapshot()).toEqual(before);
    // the connection is usable again (the failed transaction was rolled back)
    expect((await pg.query('SELECT 1 AS one')).rows[0].one).toBe(1);
  });

  it('its connection defaults every transaction to read-only (second guard)', async () => {
    const before = await snapshot();
    const ro = new PgClient(
      connectionConfig({ DB_HOST: db.host, DB_PORT: String(db.port), DB_USERNAME: db.username, DB_PASSWORD: db.password, DB_DATABASE: db.database }),
    );
    await ro.connect();
    try {
      expect((await ro.query('SHOW default_transaction_read_only')).rows[0].default_transaction_read_only).toBe('on');
      await expect(ro.query(`UPDATE users SET name = 'changed'`)).rejects.toThrow(/read-only transaction/);
    } finally {
      await ro.end();
    }
    expect(await snapshot()).toEqual(before);
  });

  it('refuses to run any check when the transaction does not report read-only, and rolls back', async () => {
    const sent: string[] = [];
    const fake: QueryClient = {
      query: async (sql: string) => {
        sent.push(sql);
        return { rows: sql === 'SHOW transaction_read_only' ? [{ transaction_read_only: 'off' }] : [] };
      },
    };
    await expect(runIntegrityReport(fake)).rejects.toThrow(/not read-only/);
    expect(sent).toEqual(['BEGIN', 'SET TRANSACTION READ ONLY', 'SHOW transaction_read_only', 'ROLLBACK']);
  });

  it('npm run integrity:report exits 2 when it cannot run, without printing the password', () => {
    const secret = 'integrity-secret-do-not-print';
    const res = spawnSync('npm', ['run', '-s', 'integrity:report'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...env,
        INTEGRITY_DATABASE_URL: `postgres://${db.username}:${secret}@${db.host}:${db.port}/integrity_missing_db_${Date.now()}`,
      },
      encoding: 'utf8',
    });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('Integrity report failed');
    expect(res.stdout + res.stderr).not.toContain(secret);
  }, 60000);

  it('npm run integrity:report exits 1 with findings and 0 on a clean database', async () => {
    const run = () =>
      spawnSync('npm', ['run', '-s', 'integrity:report'], {
        cwd: path.join(__dirname, '..'),
        env: {
          ...env,
          DB_HOST: db.host,
          DB_PORT: String(db.port),
          DB_USERNAME: db.username,
          DB_PASSWORD: db.password,
          DB_DATABASE: db.database,
          INTEGRITY_DATABASE_URL: '',
        },
        encoding: 'utf8',
      });

    const dirty = run();
    expect(dirty.stdout).toContain(ids.invoiceBad);
    expect(dirty.stdout).toContain('8 finding row(s) need operator review. Nothing was changed.');
    expect(dirty.status).toBe(1);

    await truncateAll();
    const clean = run();
    expect(clean.stdout).toContain('No findings; every check ran. Nothing was changed.');
    expect(clean.status).toBe(0);
  }, 120000);
});
