import * as fs from 'fs';
import * as path from 'path';
import { Client as PgClient } from 'pg';
import { randomBytes } from 'crypto';
import {
  snapshotSchema,
  compareSnapshots,
  formatComparison,
  otherSessions,
  normaliseSchema,
  identity,
} from '../src/ops/verify-restore';

/**
 * Restore verification against two throwaway schemas in the disposable test
 * database, both built from the repository's SQL migrations and filled with the
 * same synthetic rows: a "source" and a stand-in for a restored backup. Each
 * test breaks one thing in the copy and expects the comparison to catch it.
 * Both schemas are dropped afterwards.
 */
const env = process.env;
const db = {
  host: env.DB_TEST_HOST || env.DB_HOST,
  port: Number(env.DB_TEST_PORT || env.DB_PORT),
  user: env.DB_TEST_USERNAME || env.DB_USERNAME,
  password: env.DB_TEST_PASSWORD || env.DB_PASSWORD,
  database: env.DB_TEST_DATABASE || (env.DB_DATABASE ? env.DB_DATABASE + '_test' : undefined),
};
const MIGRATIONS = path.join(__dirname, '..', 'migrations');
const migrationSql = fs
  .readdirSync(MIGRATIONS)
  .filter((f) => /^\d{3}_.*\.sql$/.test(f))
  .sort()
  .map((f) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'));

describe('Restore verification (read-only, E2E)', () => {
  const suffix = randomBytes(4).toString('hex');
  const src = `verify_src_${suffix}`;
  const copy = `verify_copy_${suffix}`;
  let admin: PgClient;
  let ro: PgClient;

  const build = async (schema: string) => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`SET search_path TO ${schema}, public`);
    for (const sql of migrationSql) await admin.query(sql);
    await admin.query(`CREATE SEQUENCE ${schema}.receipt_no`);
    await admin.query(`SELECT nextval('${schema}.receipt_no')`);
    await admin.query('SET search_path TO public');
  };
  const compare = async () => compareSnapshots(await snapshotSchema(ro, src), await snapshotSchema(ro, copy));
  const objectStatus = (c: Awaited<ReturnType<typeof compare>>, cat: string) => c.objects.find((o) => o.category === cat)!;

  beforeAll(async () => {
    admin = new PgClient(db);
    await admin.connect();
    await admin.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public');
    await build(src);
    await build(copy);
    // Synthetic rows in the source; the "restore" receives an exact copy of them.
    await admin.query(`INSERT INTO ${src}.users (id, email, password_hash, name) VALUES ('11111111-1111-1111-1111-111111111111','owner@verify.invalid','x','Demo Owner')`);
    await admin.query(`INSERT INTO ${src}.clients (id, user_id, name, email) VALUES ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','Fictional Supplies Ltd','ap@verify.invalid')`);
    for (const t of ['users', 'clients']) await admin.query(`INSERT INTO ${copy}.${t} SELECT * FROM ${src}.${t}`);
    ro = new PgClient({ ...db, options: '-c default_transaction_read_only=on' });
    await ro.connect();
  });

  afterAll(async () => {
    await ro.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${src} CASCADE`);
    await admin.query(`DROP SCHEMA IF EXISTS ${copy} CASCADE`);
    await admin.end();
  });

  it('an identical restore matches: table data and every schema object category', async () => {
    const c = await compare();
    expect(c.ok).toBe(true);
    expect(c.tables.length).toBeGreaterThanOrEqual(15);
    for (const o of c.objects) expect([o.category, o.status]).toEqual([o.category, 'match']);
    expect(objectStatus(c, 'indexes').sourceCount).toBeGreaterThan(10);
    expect(objectStatus(c, 'enum_types').sourceCount).toBeGreaterThan(0);
    expect(formatComparison(c)).toContain('OK: all');
    expect(formatComparison(c)).toContain('Not covered here: uploaded files');
  });

  it('a changed value with the same row count is a data mismatch', async () => {
    // Without the sync triggers (migration 019) for this session: they would
    // also bump the revision, and the revert below must restore the row exactly.
    await admin.query('SET session_replication_role = replica');
    await admin.query(`UPDATE ${copy}.clients SET name = 'Tampered' WHERE id = '22222222-2222-2222-2222-222222222222'`);
    try {
      const c = await compare();
      expect(c.ok).toBe(false);
      expect(c.tables.find((t) => t.table === 'clients')!.status).toBe('mismatch');
    } finally {
      await admin.query(`UPDATE ${copy}.clients SET name = 'Fictional Supplies Ltd' WHERE id = '22222222-2222-2222-2222-222222222222'`);
      await admin.query('SET session_replication_role = origin');
    }
  });

  it('a missing index fails even though every row matches', async () => {
    await admin.query(`DROP INDEX ${copy}.idx_invoices_user_due_date`);
    const c = await compare();
    expect(c.tables.every((t) => t.status === 'match')).toBe(true);
    expect(c.ok).toBe(false);
    expect(objectStatus(c, 'indexes').onlyInSource.join('\n')).toMatch(/idx_invoices_user_due_date/);
    await admin.query(`CREATE INDEX idx_invoices_user_due_date ON ${copy}.invoices(user_id, due_date) WHERE deleted_at IS NULL AND status IN ('sent', 'overdue')`);
    expect((await compare()).ok).toBe(true);
  });

  it('a sequence behind the source fails (new ids would collide)', async () => {
    await admin.query(`SELECT nextval('${src}.receipt_no')`);
    const c = await compare();
    expect(c.ok).toBe(false);
    expect(objectStatus(c, 'sequences').status).toBe('mismatch');
    await admin.query(`SELECT nextval('${copy}.receipt_no')`);
    expect((await compare()).ok).toBe(true);
  });

  it('a table missing from the restore fails verification', async () => {
    await admin.query(`ALTER TABLE ${copy}.feedback RENAME TO feedback_gone`);
    try {
      const c = await compare();
      expect(c.ok).toBe(false);
      expect(c.tables.find((t) => t.table === 'feedback')!.status).toBe('missing_in_restore');
    } finally {
      await admin.query(`ALTER TABLE ${copy}.feedback_gone RENAME TO feedback`);
    }
  });

  it('detects other client sessions on the source database', async () => {
    const extra = new PgClient(db);
    await extra.connect();
    try {
      expect(await otherSessions(ro)).toBeGreaterThanOrEqual(2); // admin + extra
    } finally {
      await extra.end();
    }
  });

  it('reports NOT PROVEN instead of OK when the source was not quiet', async () => {
    const text = formatComparison(await compare(), 'NOT PROVEN: 1 other client session(s) are connected to the source database; stop the application and retry.');
    expect(text).toContain('NOT PROVEN');
    expect(text).not.toContain('OK: all');
  });

  it('reads inside a read-only transaction', async () => {
    await expect(ro.query(`INSERT INTO ${src}.feedback (id) VALUES (gen_random_uuid())`)).rejects.toThrow(/read-only transaction/);
  });

  it('a session with different output settings (timezone, date style) still matches', async () => {
    const tokyo = new PgClient({ ...db, options: '-c default_transaction_read_only=on -c timezone=Asia/Tokyo -c datestyle=SQL,DMY' });
    await tokyo.connect();
    try {
      const c = compareSnapshots(await snapshotSchema(ro, src), await snapshotSchema(tokyo, copy));
      expect(c.tables.find((t) => t.table === 'users')!.status).toBe('match');
      expect(c.ok).toBe(true);
    } finally {
      await tokyo.end();
    }
  });

  it('a role that cannot read a sequence or a table gets NOT PROVEN, not a silent pass', async () => {
    const role = `verify_ro_${suffix}`;
    await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD 'test-only-${suffix}'`);
    try {
      await admin.query(`GRANT USAGE ON SCHEMA ${src} TO ${role}`);
      await admin.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${src} TO ${role}`);
      await admin.query(`REVOKE SELECT ON ${src}.feedback FROM ${role}`);
      const limited = new PgClient({ ...db, user: role, password: `test-only-${suffix}`, options: '-c default_transaction_read_only=on' });
      await limited.connect();
      try {
        const snapLimited = await snapshotSchema(limited, src);
        expect(snapLimited.unreadable).toEqual(expect.arrayContaining(['table feedback', 'sequence receipt_no']));
        const c = compareSnapshots(snapLimited, await snapshotSchema(ro, copy));
        expect(c.ok).toBe(false);
        expect(formatComparison(c)).toMatch(/NOT PROVEN: the role cannot read/);
      } finally {
        await limited.end();
      }
    } finally {
      await admin.query(`DROP OWNED BY ${role}`);
      await admin.query(`DROP ROLE ${role}`);
    }
  });

  it('identifies the same database however it is reached (so it is never compared with itself)', async () => {
    const other = new PgClient({ ...db, host: db.host === 'localhost' ? '127.0.0.1' : 'localhost' });
    await other.connect();
    try {
      expect(await identity(other)).toBe(await identity(ro));
    } finally {
      await other.end();
    }
  });

  const socketDir = ['/tmp', '/var/run/postgresql'].find((d) => fs.existsSync(path.join(d, `.s.PGSQL.${db.port}`)));
  (socketDir ? it : it.skip)('identifies the same database over a Unix socket and over TCP', async () => {
    const viaSocket = new PgClient({ ...db, host: socketDir });
    await viaSocket.connect();
    try {
      expect(await identity(viaSocket)).toBe(await identity(ro));
    } finally {
      await viaSocket.end();
    }
  });

  it('normalises the schema qualifier, quoted or not', () => {
    expect(normaliseSchema('CREATE INDEX x ON verify_a.invoices USING btree (id)', 'verify_a')).toBe('CREATE INDEX x ON invoices USING btree (id)');
    expect(normaliseSchema('nextval(\'"verify_a".seq\')', 'verify_a')).toBe("nextval('seq')");
  });
});
