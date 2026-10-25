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
 * Exit code: 0 = no findings, 1 = findings that need operator review,
 * 2 = the report could not run.
 *
 * See docs/security/2026-10-25-historical-cross-owner.md.
 */
import { Client as PgClient, ClientConfig } from 'pg';

export type CheckLevel = 'finding' | 'info';

export interface IntegrityCheck {
  id: string;
  level: CheckLevel;
  description: string;
  sql: string;
}

export interface CheckResult {
  id: string;
  level: CheckLevel;
  description: string;
  count: number;
  rows: Record<string, unknown>[];
}

export interface IntegrityReport {
  results: CheckResult[];
  findingCount: number;
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

export const INTEGRITY_CHECKS: IntegrityCheck[] = [
  {
    id: 'invoice_foreign_client',
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

    const results: CheckResult[] = [];
    for (const check of checks) {
      const res = await client.query(check.sql);
      results.push({ id: check.id, level: check.level, description: check.description, count: res.rows.length, rows: res.rows });
    }
    const findingCount = results.filter((r) => r.level === 'finding').reduce((n, r) => n + r.count, 0);
    return { results, findingCount };
  } finally {
    await client.query('ROLLBACK');
  }
}

export function formatReport(report: IntegrityReport): string {
  const lines: string[] = ['Cross-owner integrity report (read-only)', ''];
  for (const r of report.results) {
    const tag = r.level === 'finding' ? 'FINDING' : 'INFO';
    lines.push(`[${r.count > 0 ? tag : 'OK'}] ${r.id}: ${r.count} - ${r.description}`);
    for (const row of r.rows) {
      lines.push(`    ${JSON.stringify(row)}`);
    }
  }
  lines.push('');
  lines.push(
    report.findingCount > 0
      ? `${report.findingCount} finding row(s) need operator review. Nothing was changed.`
      : 'No findings. Nothing was changed.',
  );
  return lines.join('\n');
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
    return report.findingCount > 0 ? 1 : 0;
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
