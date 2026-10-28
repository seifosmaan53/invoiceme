/**
 * Read-only integrity report for cross-owner relationships.
 *
 *   npm run integrity:report          (ts-node, from a checkout)
 *   npm run integrity:report:prod     (compiled, node dist/integrity/integrity-report.js)
 *
 * Connection: INTEGRITY_DATABASE_URL, or DB_HOST / DB_PORT / DB_USERNAME /
 * DB_PASSWORD / DB_DATABASE (the app's variables). Set INTEGRITY_DB_SSL=true
 * for TLS. Use a role that only has SELECT.
 *
 * It never writes: the session defaults to read-only, every check runs inside
 * one transaction opened with SET TRANSACTION READ ONLY (verified before any
 * check runs), and the transaction is always rolled back.
 *
 * Schema-aware: each check declares the tables and columns it needs. Before
 * running, the report reads the live schema (information_schema, read-only)
 * and marks any check whose requirements are missing as NOT CHECKED. A check
 * whose query fails is also NOT CHECKED (each check runs under a savepoint).
 * A database is only reported clean when every finding check actually ran.
 * The output also includes a schema fingerprint (markers for SQL migrations
 * 001-019, origin guessed from index names). These are diagnostic clues, not a
 * migration history: never decide which migrations to apply from them alone
 * (see scripts/schema-review.sh and docs/operations/customer-update.md).
 *
 * Exit code: 0 = every check ran, no findings; 1 = findings that need operator
 * review; 2 = the report could not run at all; 3 = no findings among the checks
 * that ran, but at least one finding check could NOT run on this schema, so
 * the database has NOT been verified clean.
 *
 * See docs/security/2026-10-25-historical-cross-owner.md.
 */
import { Client as PgClient, ClientConfig } from 'pg';

export type CheckLevel = 'finding' | 'info';

/** Tables and the columns of each that a check reads. */
export type SchemaRequirements = Record<string, string[]>;

export interface IntegrityCheck {
  id: string;
  level: CheckLevel;
  description: string;
  requires: SchemaRequirements;
  sql: string;
}

export interface CheckResult {
  id: string;
  level: CheckLevel;
  description: string;
  status: 'checked' | 'not_checked';
  /** Why the check did not run (missing tables/columns, or the query error). */
  reason?: string;
  count: number;
  rows: Record<string, unknown>[];
}

export interface SchemaFingerprint {
  /** Migration id (001-019) -> whether its marker is present. */
  migrations: Record<string, boolean>;
  /**
   * How the schema appears to have been created, from index naming: the SQL
   * migrations create lowercase idx_* indexes; TypeORM synchronize creates
   * IDX_<hash> indexes. 'unknown' when neither is seen.
   */
  origin: 'sql-migrations' | 'typeorm-synchronize' | 'mixed' | 'unknown';
  /** Present when the schema does not look like InvoiceMe's (e.g. another app's database). */
  warning?: string;
}

export interface IntegrityReport {
  results: CheckResult[];
  findingCount: number;
  /** Finding-level checks that could not run. When > 0 the database is not verified clean. */
  notCheckedCount: number;
  schema: SchemaFingerprint;
}

/** Live schema: table -> set of column names, plus index names. */
export interface LiveSchema {
  columns: Map<string, Set<string>>;
  indexes: Set<string>;
}

/** Markers for the repository's SQL migrations (backend/migrations/001-019). */
export const SCHEMA_MARKERS: { migration: string; table: string; column?: string; index?: string }[] = [
  { migration: '001', table: 'users' },
  { migration: '002', table: 'clients' },
  { migration: '003', table: 'invoices' },
  { migration: '004', table: 'invoice_items' },
  { migration: '005', table: 'attachments' },
  { migration: '006', table: 'payments' },
  { migration: '007', table: 'device_changes' },
  { migration: '008', table: 'refresh_tokens' },
  { migration: '009', table: 'password_reset_tokens' },
  { migration: '010', table: 'audit_logs' },
  { migration: '011', table: 'clients', column: 'tags_json' },
  { migration: '012', table: 'invoices', index: 'idx_invoices_issue_date' },
  { migration: '013', table: 'users', column: 'totp_secret' },
  { migration: '014', table: 'users', column: 'invoice_number_format' },
  { migration: '015', table: 'feedback' },
  { migration: '016', table: 'recurring_invoices' },
  { migration: '017', table: 'user_settings', column: 'pdf_layout' },
  { migration: '018', table: 'device_changes', column: 'change_id' },
  // Marks the tables only; the server itself checks the triggers (sync-schema.service.ts).
  { migration: '019', table: 'sync_conflicts' },
];

export function missingRequirements(requires: SchemaRequirements, live: LiveSchema): string[] {
  const missing: string[] = [];
  for (const [table, columns] of Object.entries(requires)) {
    const have = live.columns.get(table);
    if (!have) {
      missing.push(`table ${table}`);
      continue;
    }
    for (const column of columns) {
      if (!have.has(column)) missing.push(`${table}.${column}`);
    }
  }
  return missing;
}

export function fingerprintSchema(live: LiveSchema): SchemaFingerprint {
  const migrations: Record<string, boolean> = {};
  for (const m of SCHEMA_MARKERS) {
    const cols = live.columns.get(m.table);
    let present = !!cols;
    if (present && m.column) present = cols!.has(m.column);
    if (present && m.index) present = live.indexes.has(m.index);
    migrations[m.migration] = present;
  }
  const sqlIdx = live.indexes.has('idx_users_email') || live.indexes.has('idx_clients_user_id');
  const ormIdx = [...live.indexes].some((n) => /^IDX_[0-9a-f]{20,}$/.test(n));
  const origin = sqlIdx && ormIdx ? 'mixed' : sqlIdx ? 'sql-migrations' : ormIdx ? 'typeorm-synchronize' : 'unknown';
  const fp: SchemaFingerprint = { migrations, origin };
  const invoices = live.columns.get('invoices');
  if (invoices && !invoices.has('user_id') && invoices.has('userId')) {
    fp.warning = 'invoices uses camelCase columns ("userId"): this does not look like an InvoiceMe schema (another application\'s database?)';
  } else if (!invoices && !live.columns.get('users')) {
    fp.warning = 'no InvoiceMe tables found in the current schema';
  }
  return fp;
}

async function readLiveSchema(client: QueryClient): Promise<LiveSchema> {
  const cols = await client.query(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema()`,
  );
  const columns = new Map<string, Set<string>>();
  for (const r of cols.rows) {
    if (!columns.has(r.table_name)) columns.set(r.table_name, new Set());
    columns.get(r.table_name)!.add(r.column_name);
  }
  const idx = await client.query(`SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()`);
  return { columns, indexes: new Set(idx.rows.map((r: any) => r.indexname)) };
}

/** Minimal client surface, so tests can pass a pg.Client. */
export interface QueryClient {
  query(sql: string): Promise<{ rows: any[] }>;
}

// Current owner of the record a device_changes row refers to (NULL when the
// record no longer exists). Items and attachments have no owner column: their
// owner is the owner of the invoice/client they belong to.
const CHANGE_OWNERS = `
  SELECT dc.id::text          AS change_id,
         dc.object_type::text AS object_type,
         dc.object_id::text   AS object_id,
         dc.change_type::text AS change_type,
         dc.user_id::text     AS actor,
         dc.synced            AS synced,
         dc.created_at        AS created_at,
         COALESCE(c.user_id, i.user_id, ii_inv.user_id, a_inv.user_id, a_cli.user_id)::text AS owner
    FROM device_changes dc
    LEFT JOIN clients c        ON dc.object_type::text = 'client'       AND c.id::text = dc.object_id::text
    LEFT JOIN invoices i       ON dc.object_type::text = 'invoice'      AND i.id::text = dc.object_id::text
    LEFT JOIN invoice_items ii ON dc.object_type::text = 'invoice_item' AND ii.id::text = dc.object_id::text
    LEFT JOIN invoices ii_inv  ON ii_inv.id::text = ii.invoice_id::text
    LEFT JOIN attachments a    ON dc.object_type::text = 'attachment'   AND a.id::text = dc.object_id::text
    LEFT JOIN invoices a_inv   ON a.owner_type::text = 'invoice' AND a_inv.id::text = a.owner_id::text
    LEFT JOIN clients a_cli    ON a.owner_type::text = 'client'  AND a_cli.id::text = a.owner_id::text`;

const CHANGE_OWNERS_REQUIRES: SchemaRequirements = {
      device_changes: ['id', 'object_type', 'object_id', 'change_type', 'user_id', 'synced', 'created_at'],
      clients: ['id', 'user_id'],
      invoices: ['id', 'user_id'],
      invoice_items: ['id', 'invoice_id'],
      attachments: ['id', 'owner_type', 'owner_id'],
    };

export const INTEGRITY_CHECKS: IntegrityCheck[] = [
  {
    id: 'invoice_foreign_client',
    requires: { invoices: ['id', 'user_id', 'client_id', 'created_at'], clients: ['id', 'user_id', 'created_at'] },
    level: 'finding',
    description: "Invoices whose client belongs to a different user",
    sql: `
      SELECT i.id::text AS invoice_id, i.user_id::text AS invoice_owner,
             c.id::text AS client_id, c.user_id::text AS client_owner,
             i.created_at AS invoice_created_at, c.created_at AS client_created_at
        FROM invoices i
        JOIN clients c ON c.id::text = i.client_id::text
       WHERE i.user_id::text <> c.user_id::text
       ORDER BY i.created_at, i.id`,
  },
  {
    id: 'recurring_invoice_foreign_client',
    requires: { recurring_invoices: ['id', 'user_id', 'client_id', 'created_at'], clients: ['id', 'user_id'] },
    level: 'finding',
    description: "Recurring invoices whose client belongs to a different user",
    sql: `
      SELECT r.id::text AS recurring_invoice_id, r.user_id::text AS recurring_owner,
             c.id::text AS client_id, c.user_id::text AS client_owner
        FROM recurring_invoices r
        JOIN clients c ON c.id::text = r.client_id::text
       WHERE r.user_id::text <> c.user_id::text
       ORDER BY r.created_at, r.id`,
  },
  {
    id: 'applied_change_by_other_user',
    requires: CHANGE_OWNERS_REQUIRES,
    level: 'finding',
    description: 'Applied sync changes (synced = true) made by one user to a record now owned by another user',
    sql: `
      SELECT change_id, object_type, object_id, change_type, actor, owner, created_at
        FROM (${CHANGE_OWNERS}) o
       WHERE o.synced = true AND o.owner IS NOT NULL AND o.owner <> o.actor
       ORDER BY created_at, change_id`,
  },
  {
    id: 'object_changed_by_several_users',
    requires: CHANGE_OWNERS_REQUIRES,
    level: 'finding',
    description: 'Records (existing or deleted) with applied sync changes from more than one user',
    sql: `
      SELECT object_type::text AS object_type, object_id::text AS object_id,
             array_agg(DISTINCT user_id::text ORDER BY user_id::text) AS actors,
             MIN(created_at) AS first_change, MAX(created_at) AS last_change
        FROM device_changes
       WHERE synced = true
       GROUP BY object_type, object_id
      HAVING COUNT(DISTINCT user_id) > 1
       ORDER BY MIN(created_at), object_id`,
  },
  {
    id: 'owner_field_in_change',
    requires: { device_changes: ['id', 'object_type', 'object_id', 'change_type', 'user_id', 'change_json', 'synced', 'created_at'] },
    level: 'finding',
    description:
      'Sync changes that carried a userId (owner) field; before the ownership fix this moved or planted records',
    sql: `
      SELECT dc.id::text AS change_id, dc.object_type::text AS object_type, dc.object_id::text AS object_id,
             dc.change_type::text AS change_type, dc.user_id::text AS actor,
             dc.change_json->>'userId' AS requested_owner, dc.synced, dc.created_at
        FROM device_changes dc
       WHERE dc.change_json ? 'userId'
       ORDER BY dc.created_at, dc.id`,
  },
  {
    id: 'relation_repointed_by_sync',
    requires: { device_changes: ['id', 'object_type', 'object_id', 'change_type', 'user_id', 'change_json', 'synced', 'created_at'] },
    level: 'finding',
    description:
      'Applied sync updates that rewrote a foreign key (clientId, invoiceId, ownerId, ownerType); the previous value is not recorded',
    sql: `
      SELECT dc.id::text AS change_id, dc.object_type::text AS object_type, dc.object_id::text AS object_id,
             dc.user_id::text AS actor,
             (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(dc.change_json) k
               WHERE k IN ('clientId', 'invoiceId', 'ownerId', 'ownerType')) AS keys,
             dc.created_at
        FROM device_changes dc
       WHERE dc.synced = true
         AND dc.change_type::text = 'update'
         AND dc.change_json ?| array['clientId', 'invoiceId', 'ownerId', 'ownerType']
       ORDER BY dc.created_at, dc.id`,
  },
  {
    id: 'attachment_without_owner',
    requires: { attachments: ['id', 'owner_type', 'owner_id', 'created_at'], invoices: ['id'], clients: ['id'] },
    level: 'finding',
    description: 'Attachments whose owner_id matches no invoice/client of its owner_type (owner cannot be determined)',
    sql: `
      SELECT a.id::text AS attachment_id, a.owner_type::text AS owner_type, a.owner_id::text AS owner_id, a.created_at
        FROM attachments a
        LEFT JOIN invoices i ON a.owner_type::text = 'invoice' AND i.id::text = a.owner_id::text
        LEFT JOIN clients c  ON a.owner_type::text = 'client'  AND c.id::text = a.owner_id::text
       WHERE i.id IS NULL AND c.id IS NULL
       ORDER BY a.created_at, a.id`,
  },
  {
    id: 'rejected_change_by_other_user',
    requires: CHANGE_OWNERS_REQUIRES,
    level: 'info',
    description: 'Rejected sync changes (synced = false) aimed at a record owned by another user: attempts, no data changed',
    sql: `
      SELECT change_id, object_type, object_id, change_type, actor, owner, created_at
        FROM (${CHANGE_OWNERS}) o
       WHERE o.synced = false AND o.owner IS NOT NULL AND o.owner <> o.actor
       ORDER BY created_at, change_id`,
  },
  {
    id: 'applied_delete_without_create',
    requires: CHANGE_OWNERS_REQUIRES,
    level: 'info',
    description:
      'Applied sync deletes of records that no longer exist and that the actor never created through sync (owner unknown)',
    sql: `
      SELECT o.change_id, o.object_type, o.object_id, o.actor, o.created_at
        FROM (${CHANGE_OWNERS}) o
       WHERE o.synced = true AND o.change_type = 'delete' AND o.owner IS NULL
         AND o.object_type IN ('invoice_item', 'attachment')
         AND NOT EXISTS (
               SELECT 1 FROM device_changes c2
                WHERE c2.object_id::text = o.object_id AND c2.user_id::text = o.actor
                  AND c2.change_type::text = 'create' AND c2.synced = true)
       ORDER BY o.created_at, o.change_id`,
  },
  {
    id: 'encrypted_client_fields',
    level: 'info',
    description:
      'Clients whose email, phone or notes look encrypted (CryptoJS "U2FsdGVkX1" prefix): if any exist, ENCRYPTION_KEY is needed to read them and must be preserved',
    requires: { clients: ['id', 'email', 'phone', 'notes'] },
    sql: `
      SELECT id::text AS client_id
        FROM clients
       WHERE email LIKE 'U2FsdGVkX1%' OR phone LIKE 'U2FsdGVkX1%' OR notes LIKE 'U2FsdGVkX1%'
       ORDER BY id`,
  },
];

/**
 * Runs the checks inside a single read-only transaction and always rolls it
 * back. Throws before running any check if the transaction is not read-only.
 */
export async function runIntegrityReport(
  client: QueryClient,
  checks: IntegrityCheck[] = INTEGRITY_CHECKS,
): Promise<IntegrityReport> {
  await client.query('BEGIN');
  try {
    await client.query('SET TRANSACTION READ ONLY');
    const { rows } = await client.query('SHOW transaction_read_only');
    if (rows[0]?.transaction_read_only !== 'on') {
      throw new Error('Refusing to run: the transaction is not read-only');
    }

    const live = await readLiveSchema(client);
    const schema = fingerprintSchema(live);

    const results: CheckResult[] = [];
    for (const check of checks) {
      const base = { id: check.id, level: check.level, description: check.description };
      const missing = missingRequirements(check.requires, live);
      if (missing.length > 0) {
        results.push({ ...base, status: 'not_checked', reason: `missing ${missing.join(', ')}`, count: 0, rows: [] });
        continue;
      }
      // A failed query aborts a PostgreSQL transaction; the savepoint keeps the
      // remaining checks running inside the same read-only transaction.
      await client.query('SAVEPOINT integrity_check');
      try {
        const res = await client.query(check.sql);
        await client.query('RELEASE SAVEPOINT integrity_check');
        results.push({ ...base, status: 'checked', count: res.rows.length, rows: res.rows });
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT integrity_check');
        const message = error instanceof Error ? error.message : String(error);
        results.push({ ...base, status: 'not_checked', reason: `query failed: ${message}`, count: 0, rows: [] });
      }
    }
    const checked = results.filter((r) => r.status === 'checked');
    const findingCount = checked.filter((r) => r.level === 'finding').reduce((n, r) => n + r.count, 0);
    const notCheckedCount = results.filter((r) => r.level === 'finding' && r.status === 'not_checked').length;
    return { results, findingCount, notCheckedCount, schema };
  } finally {
    await client.query('ROLLBACK');
  }
}

export function formatReport(report: IntegrityReport): string {
  const lines: string[] = ['Cross-owner integrity report (read-only)', ''];
  const present = Object.entries(report.schema.migrations).filter(([, ok]) => ok).map(([m]) => m);
  const absent = Object.entries(report.schema.migrations).filter(([, ok]) => !ok).map(([m]) => m);
  lines.push('Schema fingerprint (diagnostic clues only, NOT a migration history; review the actual schema before any change):');
  lines.push(`Schema markers present: ${present.join(' ') || 'none'}`);
  lines.push(`Schema markers absent:  ${absent.join(' ') || 'none'}`);
  lines.push(`Schema origin (from index names): ${report.schema.origin}` +
    (report.schema.origin === 'typeorm-synchronize' ? ' (marker 012 is index-only and is never present in such schemas)' : ''));
  if (report.schema.warning) lines.push(`WARNING: ${report.schema.warning}`);
  lines.push('');
  for (const r of report.results) {
    if (r.status === 'not_checked') {
      lines.push(`[NOT CHECKED] ${r.id} - ${r.description} (${r.reason})`);
      continue;
    }
    const tag = r.level === 'finding' ? 'FINDING' : 'INFO';
    lines.push(`[${r.count > 0 ? tag : 'OK'}] ${r.id}: ${r.count} - ${r.description}`);
    for (const row of r.rows) {
      lines.push(`    ${JSON.stringify(row)}`);
    }
  }
  lines.push('');
  if (report.findingCount > 0) {
    lines.push(`${report.findingCount} finding row(s) need operator review. Nothing was changed.`);
  }
  if (report.notCheckedCount > 0) {
    lines.push(
      `INCOMPLETE: ${report.notCheckedCount} finding check(s) could not run on this schema. ` +
        'This database has NOT been verified clean. Nothing was changed.',
    );
  }
  if (report.findingCount === 0 && report.notCheckedCount === 0) {
    lines.push('No findings; every check ran. Nothing was changed.');
  }
  return lines.join('\n');
}

/** 1 = findings, 3 = nothing found but not every finding check ran, 0 = verified clean. */
export function exitCodeFor(report: IntegrityReport): number {
  if (report.findingCount > 0) return 1;
  if (report.notCheckedCount > 0) return 3;
  return 0;
}

export function connectionConfig(env: NodeJS.ProcessEnv = process.env): ClientConfig {
  const base: ClientConfig = env.INTEGRITY_DATABASE_URL
    ? { connectionString: env.INTEGRITY_DATABASE_URL }
    : {
        host: env.DB_HOST,
        port: env.DB_PORT ? Number(env.DB_PORT) : undefined,
        user: env.DB_USERNAME,
        password: env.DB_PASSWORD,
        database: env.DB_DATABASE,
      };
  return {
    ...base,
    ssl: env.INTEGRITY_DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
    // Second guard: every transaction in this session defaults to read-only.
    options: '-c default_transaction_read_only=on',
    application_name: 'invoiceme-integrity-report',
  };
}

async function main(): Promise<number> {
  const client = new PgClient(connectionConfig());
  try {
    await client.connect();
    const report = await runIntegrityReport(client);
    console.log(formatReport(report));
    return exitCodeFor(report);
  } catch (error) {
    console.error(`Integrity report failed: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  } finally {
    await client.end().catch(() => undefined);
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code));
}
