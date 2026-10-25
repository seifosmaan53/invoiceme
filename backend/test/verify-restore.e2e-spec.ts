import { Client as PgClient } from 'pg';
import { randomBytes } from 'crypto';
import { digestSchema, compareDigests, formatComparison } from '../src/ops/verify-restore';

/**
 * Restore verification against two throwaway schemas in the disposable test
 * database: a "source" with synthetic rows and a copy standing in for a
 * restored backup. Both are dropped afterwards.
 */
const env = process.env;
const db = {
  host: env.DB_TEST_HOST || env.DB_HOST,
  port: Number(env.DB_TEST_PORT || env.DB_PORT),
  user: env.DB_TEST_USERNAME || env.DB_USERNAME,
  password: env.DB_TEST_PASSWORD || env.DB_PASSWORD,
  database: env.DB_TEST_DATABASE || (env.DB_DATABASE ? env.DB_DATABASE + '_test' : undefined),
};

describe('Restore verification (read-only, E2E)', () => {
  const suffix = randomBytes(4).toString('hex');
  const src = `verify_src_${suffix}`;
  const copy = `verify_copy_${suffix}`;
  let admin: PgClient;
  let ro: PgClient;

  beforeAll(async () => {
    admin = new PgClient(db);
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${src}`);
    await admin.query(`CREATE TABLE ${src}.clients (id int PRIMARY KEY, name text, email text)`);
    await admin.query(`CREATE TABLE ${src}.invoices (id int PRIMARY KEY, client_id int, total numeric(12,2))`);
    await admin.query(`INSERT INTO ${src}.clients VALUES (1,'Fictional Supplies Ltd','ap@verify.invalid'),(2,'Sample Traders','x@verify.invalid')`);
    await admin.query(`INSERT INTO ${src}.invoices VALUES (10,1,125.50),(11,2,9.99)`);
    await admin.query(`CREATE SCHEMA ${copy}`);
    for (const t of ['clients', 'invoices']) await admin.query(`CREATE TABLE ${copy}.${t} AS TABLE ${src}.${t}`);
    ro = new PgClient({ ...db, options: '-c default_transaction_read_only=on' });
    await ro.connect();
  });

  afterAll(async () => {
    await ro.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${src} CASCADE`);
    await admin.query(`DROP SCHEMA IF EXISTS ${copy} CASCADE`);
    await admin.end();
  });

  it('an identical restore matches table by table', async () => {
    const result = compareDigests(await digestSchema(ro, src), await digestSchema(ro, copy));
    expect(result.ok).toBe(true);
    expect(result.tables.map((t) => [t.table, t.status, t.source?.rows])).toEqual([
      ['clients', 'match', 2],
      ['invoices', 'match', 2],
    ]);
    expect(formatComparison(result)).toContain('OK: all 2 tables match.');
  });

  it('a changed value with the same row count is a mismatch', async () => {
    await admin.query(`UPDATE ${copy}.invoices SET total = 125.51 WHERE id = 10`);
    const result = compareDigests(await digestSchema(ro, src), await digestSchema(ro, copy));
    expect(result.ok).toBe(false);
    expect(result.tables.find((t) => t.table === 'invoices')!.status).toBe('mismatch');
    expect(result.tables.find((t) => t.table === 'clients')!.status).toBe('match');
    await admin.query(`UPDATE ${copy}.invoices SET total = 125.50 WHERE id = 10`);
  });

  it('a table missing from the restore fails verification', async () => {
    await admin.query(`ALTER TABLE ${copy}.clients RENAME TO clients_gone`);
    try {
      const result = compareDigests(await digestSchema(ro, src), await digestSchema(ro, copy));
      expect(result.ok).toBe(false);
      expect(result.tables.find((t) => t.table === 'clients')!.status).toBe('missing_in_restore');
    } finally {
      await admin.query(`ALTER TABLE ${copy}.clients_gone RENAME TO clients`);
    }
  });

  it('an empty comparison is never OK', () => {
    expect(compareDigests(new Map(), new Map()).ok).toBe(false);
  });

  it('reads inside a read-only transaction', async () => {
    await expect(ro.query(`INSERT INTO ${src}.clients VALUES (3,'x','y')`)).rejects.toThrow(/read-only transaction/);
  });
});
