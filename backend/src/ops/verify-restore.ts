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
 * WHAT IT CHECKS, per side inside one read-only REPEATABLE READ transaction
 * (table data comes from one MVCC snapshot; sequence positions and object
 * definitions are read from the catalog and assume a QUIET source), with the
 * session's output settings pinned (UTC, ISO dates, full float precision, hex
 * bytea) so servers with different defaults compare correctly:
 *   - table data: every table's row count and a hash of its rows (each row is
 *     hashed, then the sorted row hashes; no table-size limit);
 *   - schema objects: columns (type, nullability, default), constraints,
 *     indexes, sequences INCLUDING their current value, extensions (database
 *     wide), enum types, views, functions and triggers, with the schema name
 *     normalised so two schemas can be compared. A constraint whose text
 *     differs only in casts or redundant parentheses (a dump round trip may
 *     re-print a CHECK rule) is reported as EQUIVALENT and listed for review.
 *   - completeness: any table or sequence the connecting role cannot read
 *     makes the result NOT PROVEN (grant SELECT on tables AND sequences).
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
 * 1 = differences, or not proven (source not quiet, unreadable objects);
 * 2 = could not run; 4 = matches except constraint definitions that differ
 * only in text casts/redundant parentheses: a person must review the listed
 * pairs, then rerun with VERIFY_ACCEPT_EQUIVALENT=true to get exit 0.
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
  /** Objects the role could not read; any entry means the result is not proven. */
  unreadable: string[];
}

export interface TableComparison {
  table: string;
  status: 'match' | 'mismatch' | 'missing_in_restore' | 'extra_in_restore';
  source?: TableDigest;
  restored?: TableDigest;
}

export interface ObjectComparison {
  category: ObjectCategory;
  /** 'equivalent': differs only in casts/redundant parentheses (see equivalent). */
  status: 'match' | 'equivalent' | 'mismatch';
  sourceCount: number;
  restoredCount: number;
  onlyInSource: string[];
  onlyInRestore: string[];
  /** Pairs [source, restored] that are textually different but equivalent. */
  equivalent: [string, string][];
}

export interface RestoreComparison {
  tables: TableComparison[];
  objects: ObjectComparison[];
  /** Unreadable objects on either side (the comparison is then incomplete). */
  unreadable: string[];
  ok: boolean;
}

export interface QueryClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

const ident = (name: string) => '"' + name.replace(/"/g, '""') + '"';

/** Only casts to text types: those are what a dump round trip rearranges. Casts to other types are kept. */
const TEXT_CAST = /::(?:text|character varying|varchar|bpchar)(?:\(\d+\))?(?:\[\])?(?![a-z0-9_])/gi;
const ATOM_PARENS = /(?<![A-Za-z0-9_\]"])\(('(?:[^']|'')*'|[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?)\)/g;

/** Index of the matching ")" for each "(" (string literals skipped). */
function matchParens(s: string): Map<number, number> {
  const pairs = new Map<number, number>();
  const stack: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'") {
      i++;
      while (i < s.length && !(s[i] === "'" && s[i + 1] !== "'")) i += s[i] === "'" ? 2 : 1;
    } else if (ch === '(') stack.push(i);
    else if (ch === ')' && stack.length) pairs.set(stack.pop()!, i);
  }
  return pairs;
}

/** Removes one pair of parentheses that directly wraps another pair's entire content: "((x))" -> "(x)". */
function dropDoubledParens(s: string): string {
  const pairs = matchParens(s);
  for (const [open, close] of pairs) {
    if (s[open + 1] === '(' && pairs.get(open + 1) === close - 1) {
      return s.slice(0, open + 1) + s.slice(open + 2, close - 1) + s.slice(close);
    }
  }
  return s;
}

/**
 * A constraint definition with text casts and REDUNDANT parentheses removed:
 * parentheses around a single literal/identifier/number (not function calls)
 * and doubled parentheses. Parentheses that group operators are kept, so
 * operator precedence still distinguishes two rules, and casts to non-text
 * types are kept. String literals are swapped for opaque placeholders first,
 * so their contents are never changed.
 */
export function normaliseCheck(text: string): string {
  const literals: string[] = [];
  let out = text.replace(/'(?:[^']|'')*'/g, (lit) => `L${literals.push(lit) - 1}L`);
  out = out.replace(TEXT_CAST, '');
  let prev: string;
  do {
    prev = out;
    out = out.replace(ATOM_PARENS, '$1');
    out = dropDoubledParens(out);
  } while (out !== prev);
  out = out.replace(/\s+/g, ' ').trim();
  return out.replace(/L(\d+)L/g, (_m, i) => literals[Number(i)]);
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
      FROM pg_sequences
     WHERE schemaname = $1 AND has_sequence_privilege(format('%I.%I', schemaname, sequencename), 'SELECT')`,
  extensions: `SELECT extname || ' ' || extversion AS d FROM pg_extension`,
  enum_types: `
    SELECT t.typname || ' ' || string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS d
      FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
     WHERE t.typnamespace = $1::regnamespace GROUP BY t.typname`,
  views: `SELECT viewname || ' ' || definition AS d FROM pg_views WHERE schemaname = $1`,
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
    // Row text depends on these settings; pin them so different servers agree.
    for (const setting of [
      "SET LOCAL timezone = 'UTC'",
      "SET LOCAL datestyle = 'ISO, YMD'",
      "SET LOCAL intervalstyle = 'postgres'",
      'SET LOCAL extra_float_digits = 3',
      "SET LOCAL lc_monetary = 'C'",
      "SET LOCAL bytea_output = 'hex'",
    ]) {
      await client.query(setting);
    }

    // pg_class, not information_schema: tables the role cannot read must not silently disappear.
    const { rows: tables } = await client.query(
      `SELECT c.relname AS table_name, has_table_privilege(c.oid, 'SELECT') AS readable
         FROM pg_class c
        WHERE c.relnamespace = $1::regnamespace AND c.relkind IN ('r', 'p')
        ORDER BY c.relname`,
      [schema],
    );
    const unreadable: string[] = [];
    const tableDigests = new Map<string, TableDigest>();
    for (const { table_name, readable } of tables) {
      if (!readable) {
        unreadable.push(`table ${table_name}`);
        continue;
      }
      // Hash each row, then the sorted row hashes: no single huge value, no collation dependence.
      const { rows } = await client.query(
        `SELECT count(*)::int AS n,
                md5(coalesce(string_agg(h, '' ORDER BY h), '')) AS h
           FROM (SELECT md5(t::text) AS h FROM ${ident(schema)}.${ident(table_name)} t) r`,
      );
      tableDigests.set(table_name, { rows: rows[0].n, hash: rows[0].h });
    }
    const { rows: hiddenSeq } = await client.query(
      `SELECT sequencename FROM pg_sequences
        WHERE schemaname = $1 AND NOT has_sequence_privilege(format('%I.%I', schemaname, sequencename), 'SELECT')`,
      [schema],
    );
    for (const { sequencename } of hiddenSeq) unreadable.push(`sequence ${sequencename}`);

    const objects = {} as Record<ObjectCategory, string[]>;
    for (const category of OBJECT_CATEGORIES) {
      const { rows } = await client.query(OBJECT_QUERIES[category], category === 'extensions' ? [] : [schema]);
      objects[category] = rows
        .map((r: { d: string }) => {
          const normalised = normaliseSchema(r.d, schema);
          // Long definitions are compared by hash after normalisation; the name stays readable.
          return category === 'functions' || category === 'views'
            ? `${normalised.split(' ')[0]} ${createHash('md5').update(normalised).digest('hex')}`
            : normalised;
        })
        .sort();
    }
    return { tables: tableDigests, objects, unreadable };
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
    let onlyInSource = [...s].filter((x) => !r.has(x));
    let onlyInRestore = [...r].filter((x) => !s.has(x));
    const equivalent: [string, string][] = [];
    if (category === 'constraints') {
      // Exact text first; only then try the narrow normalisation, and report it as such.
      for (const a of [...onlyInSource]) {
        const b = onlyInRestore.find((x) => normaliseCheck(x) === normaliseCheck(a));
        if (b !== undefined) {
          equivalent.push([a, b]);
          onlyInSource = onlyInSource.filter((x) => x !== a);
          onlyInRestore = onlyInRestore.filter((x) => x !== b);
        }
      }
    }
    const status: ObjectComparison['status'] =
      onlyInSource.length > 0 || onlyInRestore.length > 0 ? 'mismatch' : equivalent.length > 0 ? 'equivalent' : 'match';
    return { category, status, sourceCount: s.size, restoredCount: r.size, onlyInSource, onlyInRestore, equivalent };
  });
  const unreadable = [
    ...source.unreadable.map((x) => `source: ${x}`),
    ...restored.unreadable.map((x) => `restore: ${x}`),
  ];
  const ok =
    tables.length > 0 &&
    unreadable.length === 0 &&
    tables.every((t) => t.status === 'match') &&
    objects.every((o) => o.status !== 'mismatch');
  return { tables, objects, unreadable, ok };
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
    for (const [a, b] of o.equivalent) {
      lines.push(`      equivalent, review: source  ${a}`);
      lines.push(`                          restore ${b}`);
    }
  }
  lines.push('');
  for (const u of c.unreadable) lines.push(`NOT READABLE by this role: ${u}`);
  if (c.unreadable.length) lines.push('NOT PROVEN: the role cannot read every table and sequence (grant SELECT on both).');
  if (quietNote) lines.push(quietNote);
  const equivalents = c.objects.reduce((n, o) => n + o.equivalent.length, 0);
  if (c.tables.length === 0) lines.push('FAILED: no tables found to compare.');
  else if (c.ok && !quietNote) {
    lines.push(
      `OK: all ${c.tables.length} tables and all schema object categories match` +
        (equivalents ? ` (${equivalents} constraint definition(s) differ only in casts/parentheses; review them above).` : '.'),
    );
  } else if (!c.ok && !c.unreadable.length) lines.push('FAILED: the restore does not match the source.');
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

/**
 * Identifies a database independently of how we connected (Unix socket,
 * localhost, 127.0.0.1): the server's start time, its configured port
 * (current_setting, also set on socket connections) and the database's oid. Two
 * different servers practically never share a start time to the microsecond.
 */
export async function identity(client: QueryClient): Promise<string> {
  const { rows } = await client.query(
    `SELECT d.oid::text AS db_oid, current_setting('port') AS port, pg_postmaster_start_time()::text AS started
       FROM pg_database d WHERE d.datname = current_database()`,
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
    const sameDb = (await identity(source)) === (await identity(restored));
    if (sameDb && sourceSchema === restoredSchema) {
      console.error('Refusing to run: the source and the restored database are the same database and schema.');
      return 2;
    }
    // The restored side connects too; when both are on the same database (test
    // setups) that connection is not "another client" of the source.
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
    if (!result.ok || quietNote) return 1;
    const equivalents = result.objects.reduce((n, o) => n + o.equivalent.length, 0);
    if (equivalents > 0 && env.VERIFY_ACCEPT_EQUIVALENT !== 'true') {
      console.log(
        `REVIEW NEEDED: ${equivalents} EQUIVALENT definition(s) listed above. After a person has confirmed them, ` +
          'rerun with VERIFY_ACCEPT_EQUIVALENT=true (exit 4 until then).',
      );
      return 4;
    }
    return 0;
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
