import * as fs from 'fs';
import * as path from 'path';
import { Client as PgClient } from 'pg';
import { randomBytes } from 'crypto';
import { runIntegrityReport, formatReport, exitCodeFor, INTEGRITY_CHECKS } from '../src/integrity/integrity-report';

/**
 * Schema compatibility of the integrity report. Each test builds its own
 * throwaway PostgreSQL schema inside the disposable test database from the
 * repository's real SQL migrations (backend/migrations/0NN_*.sql), points the
 * session's search_path at it, and drops it afterwards. No application data is
 * involved. A schema the report cannot fully inspect must never be reported
 * clean.
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

describe('Integrity report: schema compatibility (E2E)', () => {
  const created: string[] = [];
  let admin: PgClient;

  /** A fresh schema with the given SQL migrations applied, and a client whose search_path is that schema. */
  const schemaWith = async (migrations: string[]): Promise<{ name: string; client: PgClient }> => {
    const name = `integrity_compat_${randomBytes(4).toString('hex')}`;
    await admin.query(`CREATE SCHEMA ${name}`);
    created.push(name);
    await admin.query(`SET search_path TO ${name}, public`);
    for (const m of migrations) await admin.query(migrationFile(m));
    await admin.query('SET search_path TO public');
    const client = new PgClient({ ...db, options: `-c search_path=${name},public -c default_transaction_read_only=on` });
    await client.connect();
    return { name, client };
  };

  beforeAll(async () => {
    admin = new PgClient(db);
    await admin.connect();
    // Migration 001 runs CREATE EXTENSION IF NOT EXISTS "uuid-ossp", which
    // would otherwise land in the first throwaway schema and vanish with it.
    await admin.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public');
  });

  afterAll(async () => {
    for (const name of created) await admin.query(`DROP SCHEMA IF EXISTS ${name} CASCADE`);
    await admin.end();
  });

  it('an older install (migrations 001-010) is INCOMPLETE, never clean: the check that needs a missing table is NOT CHECKED', async () => {
    const { client } = await schemaWith(range(1, 10));
    try {
      const report = await runIntegrityReport(client);
      const byId = Object.fromEntries(report.results.map((r) => [r.id, r]));
      expect(byId.recurring_invoice_foreign_client.status).toBe('not_checked');
      expect(byId.recurring_invoice_foreign_client.reason).toContain('table recurring_invoices');
      expect(byId.invoice_foreign_client.status).toBe('checked');
      expect(report.notCheckedCount).toBe(1);
      expect(exitCodeFor(report)).toBe(3);
      const text = formatReport(report);
      expect(text).toContain('INCOMPLETE');
      expect(text).toContain('NOT been verified clean');
      expect(text).not.toContain('every check ran');
      expect(report.schema.origin).toBe('sql-migrations');
      expect(report.schema.migrations['010']).toBe(true);
      expect(report.schema.migrations['016']).toBe(false);
    } finally {
      await client.end();
    }
  });

  it('the SQL migration chain 001-018 applies cleanly to a fresh schema', async () => {
    // Regression: 012 used an invoice_status value ('unpaid') that does not
    // exist, so the chain stopped there on every fresh database.
    const { client } = await schemaWith(range(1, 18));
    await client.end();
  });

  it('a full install (migrations 001-018) runs every check and is reported clean', async () => {
    const { client } = await schemaWith(range(1, 18));
    try {
      const report = await runIntegrityReport(client);
      expect(report.results.every((r) => r.status === 'checked')).toBe(true);
      expect(report.results).toHaveLength(INTEGRITY_CHECKS.length);
      expect(report.notCheckedCount).toBe(0);
      expect(exitCodeFor(report)).toBe(0);
      expect(Object.values(report.schema.migrations).every(Boolean)).toBe(true);
      expect(formatReport(report)).toContain('No findings; every check ran');
    } finally {
      await client.end();
    }
  });

  it('lists clients whose fields look encrypted, as information only', async () => {
    const { name, client } = await schemaWith(range(1, 18));
    await admin.query(`INSERT INTO ${name}.users (id, email, password_hash, name) VALUES ('11111111-1111-1111-1111-111111111111','o@enc.invalid','x','Owner')`);
    await admin.query(`INSERT INTO ${name}.clients (id, user_id, name, email) VALUES
      ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','Plain Ltd','plain@enc.invalid'),
      ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','Cipher Ltd','U2FsdGVkX1+fakeciphertext')`);
    try {
      const report = await runIntegrityReport(client);
      const enc = report.results.find((r) => r.id === 'encrypted_client_fields')!;
      expect(enc.level).toBe('info');
      expect(enc.rows).toEqual([{ client_id: '33333333-3333-3333-3333-333333333333' }]);
      expect(report.findingCount).toBe(0);
      expect(exitCodeFor(report)).toBe(0);
    } finally {
      await client.end();
    }
  });

  it('a check whose query fails is NOT CHECKED, the remaining checks still run, and the transaction stays read-only', async () => {
    const { name, client } = await schemaWith(range(1, 18));
    // Same column, incompatible type: the ->> operator in two checks fails on text.
    await admin.query(`ALTER TABLE ${name}.device_changes ALTER COLUMN change_json TYPE text USING change_json::text`);
    try {
      const report = await runIntegrityReport(client);
      const byId = Object.fromEntries(report.results.map((r) => [r.id, r]));
      expect(byId.owner_field_in_change.status).toBe('not_checked');
      expect(byId.owner_field_in_change.reason).toMatch(/^query failed:/);
      // Checks after the failing one still ran inside the same transaction.
      expect(byId.attachment_without_owner.status).toBe('checked');
      expect(byId.applied_delete_without_create.status).toBe('checked');
      expect(exitCodeFor(report)).toBe(3);
      const { rows } = await client.query('SHOW transaction_read_only');
      expect(rows[0].transaction_read_only).toBe('on');
    } finally {
      await client.end();
    }
  });

  it('a database that is not InvoiceMe\'s (camelCase columns) is flagged and its checks are NOT CHECKED', async () => {
    const name = `integrity_compat_${randomBytes(4).toString('hex')}`;
    await admin.query(`CREATE SCHEMA ${name}`);
    created.push(name);
    await admin.query(`CREATE TABLE ${name}.users (id uuid PRIMARY KEY)`);
    await admin.query(`CREATE TABLE ${name}.clients (id uuid PRIMARY KEY, "userId" uuid)`);
    await admin.query(`CREATE TABLE ${name}.invoices (id uuid PRIMARY KEY, "userId" uuid, "clientId" uuid)`);
    const client = new PgClient({ ...db, options: `-c search_path=${name} -c default_transaction_read_only=on` });
    await client.connect();
    try {
      const report = await runIntegrityReport(client);
      expect(report.schema.warning).toMatch(/camelCase/);
      expect(report.results.filter((r) => r.level === 'finding').every((r) => r.status === 'not_checked')).toBe(true);
      expect(exitCodeFor(report)).toBe(3);
    } finally {
      await client.end();
    }
  });
});
