/**
 * Restore verification: proves a backup restored correctly by comparing the
 * restored database with the source, table by table (row count + content hash).
 *
 *   npm run backup:verify-restore          (ts-node, from a checkout)
 *   npm run backup:verify-restore:prod     (compiled)
 *
 * Connection: VERIFY_SOURCE_URL and VERIFY_RESTORED_URL (postgres:// URLs).
 * Optional VERIFY_SOURCE_SCHEMA / VERIFY_RESTORED_SCHEMA (default: public).
 *
 * Read-only on both sides: every transaction defaults to read-only and the
 * comparison runs inside READ ONLY transactions that are rolled back. It
 * refuses to compare a database/schema with itself.
 *
 * Hashing reads every row of every table (md5 of the rows' text, ordered), so
 * run it against the scratch restore and, for the source, ideally a quiet
 * period: rows written to the source after the backup was taken show up as
 * expected differences. Compare against the source at backup time, or stop
 * the application first.
 *
 * Exit code: 0 = every table matches; 1 = differences; 2 = could not run.
 */
import { Client as PgClient } from 'pg';

export interface TableDigest {
  rows: number;
  hash: string;
}

export interface TableComparison {
  table: string;
  status: 'match' | 'mismatch' | 'missing_in_restore' | 'extra_in_restore';
  source?: TableDigest;
  restored?: TableDigest;
}

export interface RestoreComparison {
  tables: TableComparison[];
  ok: boolean;
}

export interface QueryClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

const ident = (name: string) => '"' + name.replace(/"/g, '""') + '"';

export async function digestSchema(client: QueryClient, schema: string): Promise<Map<string, TableDigest>> {
  await client.query('BEGIN');
  try {
    await client.query('SET TRANSACTION READ ONLY');
    const { rows: tables } = await client.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name`,
      [schema],
    );
    const out = new Map<string, TableDigest>();
    for (const { table_name } of tables) {
      const { rows } = await client.query(
        `SELECT count(*)::int AS n,
                md5(coalesce(string_agg(t::text, E'\\n' ORDER BY t::text), '')) AS h
           FROM ${ident(schema)}.${ident(table_name)} t`,
      );
      out.set(table_name, { rows: rows[0].n, hash: rows[0].h });
    }
    return out;
  } finally {
    await client.query('ROLLBACK');
  }
}

export function compareDigests(source: Map<string, TableDigest>, restored: Map<string, TableDigest>): RestoreComparison {
  const names = [...new Set([...source.keys(), ...restored.keys()])].sort();
  const tables: TableComparison[] = names.map((table) => {
    const s = source.get(table);
    const r = restored.get(table);
    if (!r) return { table, status: 'missing_in_restore', source: s };
    if (!s) return { table, status: 'extra_in_restore', restored: r };
    const status = s.rows === r.rows && s.hash === r.hash ? 'match' : 'mismatch';
    return { table, status, source: s, restored: r };
  });
  return { tables, ok: tables.length > 0 && tables.every((t) => t.status === 'match') };
}

export function formatComparison(c: RestoreComparison): string {
  const lines = ['Restore verification (read-only)', ''];
  for (const t of c.tables) {
    const s = t.source ? `${t.source.rows} rows` : '-';
    const r = t.restored ? `${t.restored.rows} rows` : '-';
    lines.push(`[${t.status.toUpperCase()}] ${t.table}: source ${s}, restored ${r}`);
  }
  lines.push('');
  if (c.tables.length === 0) lines.push('FAILED: no tables found to compare.');
  else lines.push(c.ok ? `OK: all ${c.tables.length} tables match.` : 'FAILED: the restore does not match the source.');
  return lines.join('\n');
}

async function identity(client: QueryClient): Promise<string> {
  const { rows } = await client.query(
    `SELECT current_database() AS db, coalesce(inet_server_addr()::text, 'local') AS addr,
            inet_server_port() AS port, pg_postmaster_start_time()::text AS started`,
  );
  return JSON.stringify(rows[0]);
}

async function main(): Promise<number> {
  const env = process.env;
  if (!env.VERIFY_SOURCE_URL || !env.VERIFY_RESTORED_URL) {
    console.error('Set VERIFY_SOURCE_URL and VERIFY_RESTORED_URL.');
    return 2;
  }
  const options = '-c default_transaction_read_only=on';
  const source = new PgClient({ connectionString: env.VERIFY_SOURCE_URL, options, application_name: 'invoiceme-verify-restore' });
  const restored = new PgClient({ connectionString: env.VERIFY_RESTORED_URL, options, application_name: 'invoiceme-verify-restore' });
  const sourceSchema = env.VERIFY_SOURCE_SCHEMA || 'public';
  const restoredSchema = env.VERIFY_RESTORED_SCHEMA || 'public';
  try {
    await source.connect();
    await restored.connect();
    if ((await identity(source)) === (await identity(restored)) && sourceSchema === restoredSchema) {
      console.error('Refusing to run: the source and the restored database are the same database and schema.');
      return 2;
    }
    const result = compareDigests(await digestSchema(source, sourceSchema), await digestSchema(restored, restoredSchema));
    console.log(formatComparison(result));
    return result.ok ? 0 : 1;
  } catch (error) {
    console.error(`Restore verification failed: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  } finally {
    await source.end().catch(() => undefined);
    await restored.end().catch(() => undefined);
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code));
}
