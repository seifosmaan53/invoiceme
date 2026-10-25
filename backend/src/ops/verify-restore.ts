/**
 * Restore verification: compares a database restored from a backup with the
 * source it was taken from.
 *
 *   npm run backup:verify-restore          (ts-node, from a checkout)
 *   node dist/ops/verify-restore.js        (compiled / update bundle)
 *
 * Connection: VERIFY_SOURCE_URL and VERIFY_RESTORED_URL (postgres:// URLs).
 * Optional VERIFY_SOURCE_SCHEMA / VERIFY_RESTORED_SCHEMA (default: public).
 *
 * WHAT IT CHECKS, per side inside ONE read-only REPEATABLE READ transaction
 * (a single consistent snapshot), rolled back afterwards:
 *   - table data: every base table's row count and a hash of its rows;
 *   - schema objects: columns (type, nullability, default), constraints,
 *     indexes, sequences INCLUDING their current value, extensions (database
 *     wide), enum types, views, functions and triggers, with the schema name
 *     normalised so two schemas can be compared. CHECK expressions are
 *     compared without casts and parentheses, because a dump round trip may
 *     print the same rule differently.
 *
 * WHAT IT DOES NOT CHECK (verify separately, see
 * docs/operations/customer-update.md): uploaded files (S3/MinIO), the
 * application's .env configuration and keys, database roles and their
 * passwords, object ownership and privileges, and anything outside the
 * compared schema except extensions.
 *
 * QUIET SOURCE: a comparison only proves the backup when the source has not
 * changed since the backup was taken. Stop the application before taking the
 * backup and keep it stopped until verification completes. The tool refuses to
 * report OK while other client sessions are connected to the source database
 * (set VERIFY_ALLOW_SOURCE_SESSIONS=true only when those sessions are known to
 * be read-only, e.g. this report's own monitoring), and fails if the source's
 * write counters change during the run.
 *
 * Exit code: 0 = everything compared matches and the source was quiet;
 * 1 = differences, or the source was not quiet (not proven); 2 = could not run.
 */
import { Client as PgClient } from 'pg';
import { createHash } from 'crypto';

export interface TableDigest {
  rows: number;
  hash: string;
}

export type ObjectCategory =
  | 'columns'
  | 'constraints'
  | 'indexes'
  | 'sequences'
  | 'extensions'
  | 'enum_types'
  | 'views'
  | 'functions'
  | 'triggers';

export const OBJECT_CATEGORIES: ObjectCategory[] = [
  'columns',
  'constraints',
  'indexes',
  'sequences',
  'extensions',
  'enum_types',
  'views',
  'functions',
  'triggers',
];

export interface SchemaSnapshot {
  tables: Map<string, TableDigest>;
  /** Normalised, sorted descriptions of each object in each category. */
  objects: Record<ObjectCategory, string[]>;
}

export interface TableComparison {
  table: string;
  status: 'match' | 'mismatch' | 'missing_in_restore' | 'extra_in_restore';
  source?: TableDigest;
  restored?: TableDigest;
}

export interface ObjectComparison {
  category: ObjectCategory;
  status: 'match' | 'mismatch';
  sourceCount: number;
  restoredCount: number;
  onlyInSource: string[];
  onlyInRestore: string[];
}

export interface RestoreComparison {
  tables: TableComparison[];
  objects: ObjectComparison[];
  ok: boolean;
}

export interface QueryClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

const ident = (name: string) => '"' + name.replace(/"/g, '""') + '"';

/**
 * CHECK expressions are re-parsed when a dump is restored, and PostgreSQL may
 * print the same rule with casts arranged differently (e.g. an IN list on a
 * varchar column). Compare them without type casts and parentheses; the
 * constraint name, table and the remaining expression must still match.
 */
export function normaliseCheck(text: string): string {
  if (!/ CHECK /.test(text)) return text;
  return text
    .replace(/::[a-z_ ]+(\[\])?/gi, '')
    .replace(/[()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Removes the schema qualifier so that objects in two different schemas compare equal. */
export function normaliseSchema(text: string, schema: string): string {
  const quoted = ident(schema).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const plain = schema.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`${quoted}\\.`, 'g'), '').replace(new RegExp(`\\b${plain}\\.`, 'g'), '');
}

const OBJECT_QUERIES: Record<ObjectCategory, string> = {
  columns: `
    SELECT table_name || '.' || column_name || ' ' || udt_name || ' null=' || is_nullable ||
           ' default=' || coalesce(column_default, '') AS d
      FROM information_schema.columns WHERE table_schema = $1`,
  constraints: `
    SELECT cl.relname || ' ' || c.conname || ' ' || pg_get_constraintdef(c.oid) AS d
      FROM pg_constraint c JOIN pg_class cl ON cl.oid = c.conrelid
     WHERE c.connamespace = $1::regnamespace`,
  indexes: `SELECT tablename || ' ' || indexname || ' ' || indexdef AS d FROM pg_indexes WHERE schemaname = $1`,
  sequences: `
    SELECT sequencename || ' start=' || start_value || ' inc=' || increment_by ||
           ' last=' || coalesce(last_value::text, 'unused') AS d
      FROM pg_sequences WHERE schemaname = $1`,
  extensions: `SELECT extname || ' ' || extversion AS d FROM pg_extension`,
  enum_types: `
    SELECT t.typname || ' ' || string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS d
      FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
     WHERE t.typnamespace = $1::regnamespace GROUP BY t.typname`,
  views: `SELECT viewname || ' ' || md5(definition) AS d FROM pg_views WHERE schemaname = $1`,
  functions: `
    SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || pg_get_functiondef(p.oid) AS d
      FROM pg_proc p WHERE p.pronamespace = $1::regnamespace AND p.prokind IN ('f', 'p')`,
  triggers: `
    SELECT cl.relname || ' ' || t.tgname || ' ' || pg_get_triggerdef(t.oid) AS d
      FROM pg_trigger t JOIN pg_class cl ON cl.oid = t.tgrelid
     WHERE NOT t.tgisinternal AND cl.relnamespace = $1::regnamespace`,
};

/** Reads the whole schema from ONE consistent, read-only snapshot. */
export async function snapshotSchema(client: QueryClient, schema: string): Promise<SchemaSnapshot> {
  await client.query('BEGIN');
  try {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const { rows: ro } = await client.query('SHOW transaction_read_only');
    if (ro[0]?.transaction_read_only !== 'on') throw new Error('Refusing to run: the transaction is not read-only');

    const { rows: tables } = await client.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name`,
      [schema],
    );
    const tableDigests = new Map<string, TableDigest>();
    for (const { table_name } of tables) {
      const { rows } = await client.query(
        `SELECT count(*)::int AS n,
                md5(coalesce(string_agg(t::text, E'\\n' ORDER BY t::text), '')) AS h
           FROM ${ident(schema)}.${ident(table_name)} t`,
      );
      tableDigests.set(table_name, { rows: rows[0].n, hash: rows[0].h });
    }

    const objects = {} as Record<ObjectCategory, string[]>;
    for (const category of OBJECT_CATEGORIES) {
      const { rows } = await client.query(OBJECT_QUERIES[category], category === 'extensions' ? [] : [schema]);
      objects[category] = rows
        .map((r: { d: string }) => {
          const normalised = normaliseSchema(r.d, schema);
          const text = category === 'constraints' ? normaliseCheck(normalised) : normalised;
          // Long definitions are compared by hash; the name stays readable.
          return category === 'functions' ? `${text.split(' ')[0]} ${createHash('md5').update(text).digest('hex')}` : text;
        })
        .sort();
    }
    return { tables: tableDigests, objects };
  } finally {
    await client.query('ROLLBACK');
  }
}

export function compareSnapshots(source: SchemaSnapshot, restored: SchemaSnapshot): RestoreComparison {
  const names = [...new Set([...source.tables.keys(), ...restored.tables.keys()])].sort();
  const tables: TableComparison[] = names.map((table) => {
    const s = source.tables.get(table);
    const r = restored.tables.get(table);
    if (!r) return { table, status: 'missing_in_restore', source: s };
    if (!s) return { table, status: 'extra_in_restore', restored: r };
    const status = s.rows === r.rows && s.hash === r.hash ? 'match' : 'mismatch';
    return { table, status, source: s, restored: r };
  });
  const objects: ObjectComparison[] = OBJECT_CATEGORIES.map((category) => {
    const s = new Set(source.objects[category]);
    const r = new Set(restored.objects[category]);
    const onlyInSource = [...s].filter((x) => !r.has(x));
    const onlyInRestore = [...r].filter((x) => !s.has(x));
    return {
      category,
      status: onlyInSource.length === 0 && onlyInRestore.length === 0 ? 'match' : 'mismatch',
      sourceCount: s.size,
      restoredCount: r.size,
      onlyInSource,
      onlyInRestore,
    };
  });
  const ok =
    tables.length > 0 && tables.every((t) => t.status === 'match') && objects.every((o) => o.status === 'match');
  return { tables, objects, ok };
}

export function formatComparison(c: RestoreComparison, quietNote?: string): string {
  const lines = ['Restore verification (read-only, one snapshot per side)', '', 'Table data:'];
  for (const t of c.tables) {
    const s = t.source ? `${t.source.rows} rows` : '-';
    const r = t.restored ? `${t.restored.rows} rows` : '-';
    lines.push(`  [${t.status.toUpperCase()}] ${t.table}: source ${s}, restored ${r}`);
  }
  lines.push('', 'Schema objects:');
  for (const o of c.objects) {
    lines.push(`  [${o.status.toUpperCase()}] ${o.category}: source ${o.sourceCount}, restored ${o.restoredCount}`);
    for (const x of o.onlyInSource.slice(0, 10)) lines.push(`      only in source:  ${x}`);
    for (const x of o.onlyInRestore.slice(0, 10)) lines.push(`      only in restore: ${x}`);
  }
  lines.push('');
  if (quietNote) lines.push(quietNote);
  if (c.tables.length === 0) lines.push('FAILED: no tables found to compare.');
  else if (c.ok && !quietNote) {
    lines.push(`OK: all ${c.tables.length} tables and all schema object categories match.`);
  } else if (!c.ok) lines.push('FAILED: the restore does not match the source.');
  lines.push(
    'Not covered here: uploaded files, .env configuration and keys, database roles, ownership and privileges.',
  );
  return lines.join('\n');
}

/** Other client sessions connected to the current database (excluding this one). */
export async function otherSessions(client: QueryClient): Promise<number> {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend'`,
  );
  return rows[0].n;
}

/** Cumulative row writes recorded for the schema's tables (approximate; statistics are asynchronous). */
export async function writeCounter(client: QueryClient, schema: string): Promise<string> {
  const { rows } = await client.query(
    `SELECT coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0)::text AS n
       FROM pg_stat_user_tables WHERE schemaname = $1`,
    [schema],
  );
  return rows[0].n;
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
    // The restored side connects too; when both are on the same database (test
    // setups) that connection is not "another client" of the source.
    const sameDb = (await identity(source)) === (await identity(restored));
    const sessions = (await otherSessions(source)) - (sameDb ? 1 : 0);
    const before = await writeCounter(source, sourceSchema);
    const result = compareSnapshots(await snapshotSchema(source, sourceSchema), await snapshotSchema(restored, restoredSchema));
    const after = await writeCounter(source, sourceSchema);

    let quietNote: string | undefined;
    if (sessions > 0 && env.VERIFY_ALLOW_SOURCE_SESSIONS !== 'true') {
      quietNote = `NOT PROVEN: ${sessions} other client session(s) are connected to the source database; stop the application and retry.`;
    } else if (before !== after) {
      quietNote = 'NOT PROVEN: the source recorded writes during verification; stop the application and retry.';
    }
    console.log(formatComparison(result, quietNote));
    return result.ok && !quietNote ? 0 : 1;
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
