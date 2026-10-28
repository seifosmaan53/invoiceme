import { spawnSync } from 'child_process';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { Client as PgClient } from 'pg';
import { User } from '../src/entities/user.entity';
import { Client } from '../src/entities/client.entity';
import { Invoice, InvoiceType, InvoiceStatus } from '../src/entities/invoice.entity';
import { secretPaths, parseArgs } from '../src/ops/scrub-payment-secrets';

/**
 * payments:scrub-secrets against the disposable test database, run as a child
 * process. Synthetic payment rows are inserted directly; every "secret" is a
 * made-up marker string that must never appear in the tool's output.
 */
const env = process.env;
const db = {
  host: env.DB_TEST_HOST || env.DB_HOST,
  port: Number(env.DB_TEST_PORT || env.DB_PORT),
  username: env.DB_TEST_USERNAME || env.DB_USERNAME,
  password: env.DB_TEST_PASSWORD || env.DB_PASSWORD,
  database: env.DB_TEST_DATABASE || (env.DB_DATABASE ? env.DB_DATABASE + '_test' : undefined),
};
const BACKEND = path.join(__dirname, '..');
const TOOL = path.join(BACKEND, 'src', 'ops', 'scrub-payment-secrets.ts');

const S = (n: number) => `SYNTHETIC_SECRET_${n}_pi_test_do_not_print`;
const ALL_SECRETS = [1, 2, 3, 4, 5, 6, 7, 8].map(S);

/** name -> [metadata_json literal or null, expected metadata_json after apply] */
const ROWS: Record<string, [string | null, string | null]> = {
  top: [
    `{"payment_intent_id":"pi_1","client_secret":"${S(1)}","status":"requires_payment_method","amount":1.10,"big":12345678901234567890123}`,
    `{"payment_intent_id":"pi_1","status":"requires_payment_method","amount":1.10,"big":12345678901234567890123}`,
  ],
  nested: [
    `{"payment_intent":{"id":"pi_2","client_secret":"${S(2)}","x":1},"charges":[{"clientSecret":"${S(3)}","a":1},{"b":[{"client_secret":"${S(4)}"}]}],"keep":"client_secret"}`,
    `{"payment_intent":{"id":"pi_2","x":1},"charges":[{"a":1},{"b":[{}]}],"keep":"client_secret"}`,
  ],
  camel: [`{"clientSecret":"${S(5)}","note":"n"}`, `{"note":"n"}`],
  nullValue: [`{"client_secret":null,"id":"pi_3"}`, `{"id":"pi_3"}`],
  clean: [
    `{"payment_intent_id":"pi_4","amount":2.50,"nested":{"a":[1,2.500,{"b":null}]},"text":"é ✓ \\n","clientsecret":"not a secret key"}`,
    null, // unchanged
  ],
  sqlNull: [null, null],
  jsonNull: ['null', null],
  jsonString: [JSON.stringify(JSON.stringify({ client_secret: S(6) })), null],
  jsonArray: [`[{"client_secret":"${S(7)}"}]`, null],
  jsonNumber: ['42', null],
};

describe('payments:scrub-secrets (E2E, real PostgreSQL)', () => {
  let ds: DataSource;
  let pg: PgClient;
  let invoiceId: string;
  const ids: Record<string, string> = {};

  const toolEnv = () => ({
    ...env,
    DB_HOST: db.host,
    DB_PORT: String(db.port),
    DB_USERNAME: db.username,
    DB_PASSWORD: db.password,
    DB_DATABASE: db.database,
  });
  const run = (...args: string[]) => {
    const res = spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', TOOL, ...args], {
      cwd: BACKEND,
      env: toolEnv(),
      encoding: 'utf8',
    });
    const out = res.stdout + res.stderr;
    for (const secret of ALL_SECRETS) expect(out).not.toContain(secret);
    return { status: res.status, out };
  };
  /** Every payments row (metadata_json and all other columns) plus audit_logs, as text. */
  const snapshot = async () => {
    const { rows } = await pg.query(`SELECT id::text, (to_jsonb(t) - 'metadata_json')::text AS other, metadata_json::text AS m FROM payments t ORDER BY id`);
    const { rows: audit } = await pg.query(`SELECT count(*)::int AS n, md5(coalesce(string_agg(t::text, ',' ORDER BY t::text), '')) AS h FROM audit_logs t`);
    return { rows, audit: audit[0] };
  };
  const metadata = async (id: string) =>
    (await pg.query(`SELECT metadata_json::text AS m FROM payments WHERE id = $1`, [id])).rows[0].m as string | null;
  const asStored = async (literal: string) => (await pg.query(`SELECT $1::jsonb::text AS m`, [literal])).rows[0].m as string;
  const insert = async (meta: string | null) =>
    (
      await pg.query(
        `INSERT INTO payments (invoice_id, provider_payment_id, amount, metadata_json) VALUES ($1, 'pi_synthetic', 10.00, $2::jsonb) RETURNING id::text`,
        [invoiceId, meta],
      )
    ).rows[0].id as string;

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
    await ds.query('TRUNCATE TABLE ' + ds.entityMetadatas.map((md) => `"${md.tableName}"`).join(', ') + ' RESTART IDENTITY CASCADE');
    const save = <T>(entity: new () => T, data: Partial<T>) => ds.getRepository(entity).save(ds.getRepository(entity).create(data as any)) as Promise<T>;
    const user = await save(User, { email: 'scrub@example.test', passwordHash: 'x', name: 'Synthetic' });
    const client = await save(Client, { userId: user.id, name: 'Synthetic client' });
    invoiceId = (await save(Invoice, { userId: user.id, clientId: client.id, number: 'S-1', type: InvoiceType.INVOICE, status: InvoiceStatus.SENT, issueDate: new Date(), currency: 'USD' })).id;
    for (const [name, [meta]] of Object.entries(ROWS)) ids[name] = await insert(meta);
  });

  it('dry run reports counts only, changes nothing and exits 2', async () => {
    const before = await snapshot();
    const res = run();
    expect(res.status).toBe(2);
    expect(res.out).toMatch(/rows scanned:\s+10\n/);
    expect(res.out).toMatch(/rows containing a secret field:\s+4\n/);
    expect(res.out).toMatch(/secret fields found:\s+6\n/);
    expect(res.out).toMatch(/rows skipped \(metadata not an object\):\s+5\n/);
    expect(res.out).toMatch(/of which mention a secret key name:\s+2\n/);
    expect(res.out).not.toContain(ids.top); // ids only with --list-ids
    expect(res.out).not.toContain('payment_intent');
    expect(await snapshot()).toEqual(before);
  }, 60000);

  it('--list-ids prints payment ids only', () => {
    const res = run('--list-ids');
    expect(res.status).toBe(2);
    for (const name of ['top', 'nested', 'camel', 'nullValue']) expect(res.out).toContain(`contains secret: ${ids[name]}`);
    for (const name of ['jsonString', 'jsonArray']) expect(res.out).toContain(`review by hand): ${ids[name]}`);
    expect(res.out).not.toContain(ids.clean);
  }, 60000);

  it('--apply without --i-have-a-verified-backup prints the prerequisite, refuses and changes nothing', async () => {
    const before = await snapshot();
    const res = run('--apply');
    expect(res.status).toBe(1);
    expect(res.out).toContain('npm run backup:verify-restore');
    expect(res.out).toContain('Refusing to apply without --i-have-a-verified-backup');
    expect(await snapshot()).toEqual(before);
  }, 60000);

  it('apply removes only the secret fields; everything else is byte-equal; a second run finds 0', async () => {
    const before = await snapshot();
    const res = run('--apply', '--i-have-a-verified-backup');
    expect(res.status).toBe(0);
    expect(res.out).toContain('npm run backup:verify-restore');
    expect(res.out).toMatch(/rows changed:\s+4\n/);
    expect(res.out).toMatch(/secret fields removed:\s+6\n/);
    expect(res.out).toMatch(/rows still containing a secret:\s+0\n/);

    for (const [name, [meta, expected]] of Object.entries(ROWS)) {
      const now = await metadata(ids[name]);
      if (expected === null) expect([name, now]).toEqual([name, meta === null ? null : await asStored(meta)]);
      else expect([name, now]).toEqual([name, await asStored(expected)]);
    }
    // No other column of any row, and no audit row, changed.
    const after = await snapshot();
    expect(after.audit).toEqual(before.audit);
    expect(after.rows.map((r) => [r.id, r.other])).toEqual(before.rows.map((r) => [r.id, r.other]));

    const again = run('--apply', '--i-have-a-verified-backup');
    expect(again.status).toBe(0);
    expect(again.out).toMatch(/rows containing a secret field:\s+0\n/);
    expect(again.out).toMatch(/rows changed:\s+0\n/);
    expect(await snapshot()).toEqual(after);
    expect(run().status).toBe(0);
  }, 90000);

  it('works with a batch size smaller than the number of rows', async () => {
    for (let i = 0; i < 7; i++) await insert(`{"client_secret":"${S(8)}","n":${i}}`);
    const res = run('--apply', '--i-have-a-verified-backup', '--batch-size', '2');
    expect(res.status).toBe(0);
    expect(res.out).toMatch(/rows changed:\s+11\n/);
    const { rows } = await pg.query(`SELECT count(*)::int AS n FROM payments WHERE metadata_json::text LIKE '%SYNTHETIC_SECRET%'`);
    expect(rows[0].n).toBe(2); // the JSON string and the array: not objects, never changed
    expect(run('--batch-size=3').status).toBe(0);
  }, 60000);

  it('skips a row locked by another session instead of waiting, and a later run finishes it', async () => {
    const other = new PgClient({ host: db.host, port: db.port, user: db.username, password: db.password, database: db.database });
    await other.connect();
    try {
      await other.query('BEGIN');
      await other.query('SELECT 1 FROM payments WHERE id = $1 FOR UPDATE', [ids.top]);
      const started = Date.now();
      const res = run('--apply', '--i-have-a-verified-backup', '--batch-size', '1');
      expect(Date.now() - started).toBeLessThan(20000);
      expect(res.status).toBe(1);
      expect(res.out).toMatch(/rows changed:\s+3\n/);
      expect(res.out).toMatch(/rows still containing a secret:\s+1\n/);
      expect(res.out).toContain('Run the tool again');
      await other.query('COMMIT');
      const rerun = run('--apply', '--i-have-a-verified-backup');
      expect(rerun.status).toBe(0);
      expect(rerun.out).toMatch(/rows changed:\s+1\n/);
      expect(await metadata(ids.top)).toEqual(await asStored(ROWS.top[1]!));
    } finally {
      await other.end();
    }
  }, 90000);

  it('npm run payments:scrub-secrets exits 1 when it cannot connect, without printing the password', () => {
    const secret = 'scrub-db-password-do-not-print';
    const res = spawnSync('npm', ['run', '-s', 'payments:scrub-secrets'], {
      cwd: BACKEND,
      env: { ...toolEnv(), DB_PASSWORD: secret, DB_DATABASE: `scrub_missing_db_${Date.now()}` },
      encoding: 'utf8',
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Payment secret scrub failed');
    expect(res.stdout + res.stderr).not.toContain(secret);
  }, 60000);

  it('rejects unknown options and bad batch sizes', () => {
    expect(() => parseArgs(['--aply'])).toThrow(/Unknown option/);
    expect(() => parseArgs(['--batch-size', '0'])).toThrow(/batch-size/);
    expect(() => parseArgs(['--batch-size'])).toThrow(/batch-size/);
    expect(parseArgs(['--batch-size=7']).batchSize).toBe(7);
    expect(run('--batch-size', 'x').status).toBe(1);
  }, 60000);

  it('secretPaths finds both key spellings at any depth and nothing else', () => {
    expect(secretPaths({ a: [{ client_secret: 1 }, { b: { clientSecret: 2 } }], client_secret: { client_secret: 3 }, s: 'client_secret' })).toEqual([
      ['a', '0', 'client_secret'],
      ['a', '1', 'b', 'clientSecret'],
      ['client_secret'],
    ]);
    expect(secretPaths('client_secret')).toEqual([]);
    expect(secretPaths(null)).toEqual([]);
  });
});
