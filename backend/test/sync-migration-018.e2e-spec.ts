import * as fs from 'fs';
import * as path from 'path';
import { Client as PgClient } from 'pg';
import { randomBytes } from 'crypto';

/**
 * Migration 018 (device_changes.change_id + partial unique index), run against
 * throwaway schemas inside the disposable test database built from the real
 * SQL migrations. It must be idempotent and must refuse, without changing any
 * data, when duplicate (user_id, change_id) pairs already exist.
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
const migrationFile = (n: string) => {
  const file = fs.readdirSync(MIGRATIONS).find((f) => f.startsWith(`${n}_`) && f.endsWith('.sql'));
  if (!file) throw new Error(`migration ${n} not found`);
  return fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
};
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => String(from + i).padStart(3, '0'));

describe('Migration 018: device_changes.change_id (E2E)', () => {
  const created: string[] = [];
  let admin: PgClient;

  /** A fresh schema with migrations 001-017 applied; `admin` keeps its search_path on it. */
  const schemaUpTo017 = async (): Promise<string> => {
    const name = `sync_m018_${randomBytes(4).toString('hex')}`;
    await admin.query(`CREATE SCHEMA ${name}`);
    created.push(name);
    await admin.query(`SET search_path TO ${name}, public`);
    for (const m of range(1, 17)) await admin.query(migrationFile(m));
    return name;
  };

  const insertUser = async (email: string): Promise<string> =>
    (await admin.query(`INSERT INTO users (email, password_hash, name) VALUES ($1, 'x', 'Synthetic') RETURNING id`, [email]))
      .rows[0].id;

  const insertChange = (userId: string, changeId: string | null) =>
    admin.query(
      `INSERT INTO device_changes (user_id, device_id, object_type, object_id, change_json, change_type, change_id)
       VALUES ($1, 'dev', 'client', uuid_generate_v4(), '{}', 'create', $2)`,
      [userId, changeId],
    );

  beforeAll(async () => {
    admin = new PgClient(db);
    await admin.connect();
    await admin.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public');
  });

  afterEach(async () => {
    await admin.query('SET search_path TO public');
  });

  afterAll(async () => {
    for (const name of created) await admin.query(`DROP SCHEMA IF EXISTS ${name} CASCADE`);
    await admin.end();
  });

  it('adds the column and a partial unique index, and can be run again', async () => {
    await schemaUpTo017();
    await admin.query(migrationFile('018'));
    await admin.query(migrationFile('018'));

    const index = await admin.query(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'idx_device_changes_user_change_id'`,
    );
    expect(index.rows[0].indexdef).toMatch(/UNIQUE INDEX .* \(user_id, change_id\) WHERE \(change_id IS NOT NULL\)/);

    const userA = await insertUser('a@example.test');
    const userB = await insertUser('b@example.test');
    const changeId = '11111111-1111-4111-8111-111111111111';
    await insertChange(userA, changeId);
    await insertChange(userB, changeId); // per user
    await insertChange(userA, null);
    await insertChange(userA, null); // old clients: unconstrained
    await expect(insertChange(userA, changeId)).rejects.toThrow(/idx_device_changes_user_change_id/);
  });

  it('keeps existing device_changes rows unchanged', async () => {
    await schemaUpTo017();
    const user = await insertUser('a@example.test');
    await admin.query(
      `INSERT INTO device_changes (user_id, device_id, object_type, object_id, change_json, change_type, synced)
       VALUES ($1, 'dev', 'invoice', uuid_generate_v4(), '{"n":1}', 'update', true)`,
      [user],
    );
    const before = (await admin.query('SELECT * FROM device_changes')).rows;
    await admin.query(migrationFile('018'));
    const after = (await admin.query('SELECT * FROM device_changes')).rows;
    expect(after).toEqual(before.map((row) => ({ ...row, change_id: null })));
  });

  it('stops with the duplicate count and changes nothing when duplicates already exist', async () => {
    const schema = await schemaUpTo017();
    // A column added earlier without the index (by hand, or TypeORM synchronize).
    await admin.query('ALTER TABLE device_changes ADD COLUMN change_id UUID');
    const userA = await insertUser('a@example.test');
    const userB = await insertUser('b@example.test');
    const dupA = '22222222-2222-4222-8222-222222222222';
    const dupB = '33333333-3333-4333-8333-333333333333';
    await insertChange(userA, dupA);
    await insertChange(userA, dupA);
    await insertChange(userB, dupB);
    await insertChange(userB, dupB);
    await insertChange(userB, dupB);
    await insertChange(userA, dupB); // not a duplicate: different user
    const before = (await admin.query('SELECT * FROM device_changes ORDER BY id')).rows;

    await expect(admin.query(migrationFile('018'))).rejects.toThrow(
      /migration 018: device_changes has 2 duplicate \(user_id, change_id\) group\(s\); unique index not created and no data changed/,
    );

    expect((await admin.query('SELECT * FROM device_changes ORDER BY id')).rows).toEqual(before);
    const index = await admin.query(
      `SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = 'idx_device_changes_user_change_id'`,
      [schema],
    );
    expect(index.rowCount).toBe(0);
  });
});
