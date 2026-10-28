/**
 * Removes historical Stripe client_secret values from payments.metadata_json.
 *
 *   npm run payments:scrub-secrets                 (ts-node, from a checkout)
 *   npm run payments:scrub-secrets:prod            (compiled, node dist/ops/scrub-payment-secrets.js)
 *   node dist/ops/scrub-payment-secrets.js         (update bundle / container)
 *
 * Before the fix that stopped storing it, POST /invoices/:id/pay saved the
 * PaymentIntent's client_secret in metadata_json, and the Stripe webhook merged
 * the whole PaymentIntent into it. This tool deletes every key named
 * `client_secret` or `clientSecret`, at any depth of nested objects and arrays,
 * from rows whose metadata_json is a JSON object. Nothing else changes: other
 * keys and values stay exactly as stored (the keys are deleted in SQL with
 * `#-`, the JSON is never re-encoded), no other column or table is written, and
 * no audit_logs row is created.
 *
 * Options:
 *   (none)                        dry run: counts only, read-only session
 *   --apply                       write; requires --i-have-a-verified-backup
 *   --i-have-a-verified-backup    confirms a backup verified with
 *                                 `npm run backup:verify-restore`
 *                                 (docs/operations/customer-update.md, 6.2-6.3)
 *   --batch-size N                rows per batch/transaction (default 500)
 *   --list-ids                    also print the affected payment ids
 *
 * Connection: DB_HOST / DB_PORT / DB_USERNAME / DB_PASSWORD / DB_DATABASE (the
 * app's variables). Set DB_SSL=true for TLS.
 *
 * Output: counts, plus payment ids with --list-ids. The secret values and the
 * metadata of affected rows are never printed, logged or written to a file.
 * There is no rollback file: removed values cannot be restored by this tool
 * (restore from the backup if they are ever needed). Database backups, dumps,
 * WAL archives, replicas and retained logs taken before the run still contain
 * the old values; this tool does not erase those copies.
 *
 * Apply: batches of --batch-size rows, each in its own transaction, selected
 * with FOR UPDATE SKIP LOCKED (a row another session is writing is skipped,
 * not waited for) and re-checked inside the transaction. Each batch commits on
 * its own, so an interrupted run is resumed by running it again; a second run
 * finds nothing to do. Rows that were skipped as locked are counted at the end.
 *
 * Rows whose metadata_json is not a JSON object (NULL, a string, an array, a
 * number...) are never changed; they are counted, and those whose text
 * mentions a secret key name are counted separately for manual review.
 *
 * Exit code: 0 = nothing to do, or applied and none remain; 1 = error, refused
 * (missing flag, bad option), or rows still contain a secret after --apply
 * (locked by another session; run again); 2 = dry run found rows to clean.
 */
import { Client as PgClient, ClientConfig } from 'pg';

export const SECRET_KEYS = ['client_secret', 'clientSecret'];
export const DEFAULT_BATCH_SIZE = 500;

export interface QueryClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

export interface ScrubOptions {
  apply: boolean;
  verifiedBackup: boolean;
  batchSize: number;
  listIds: boolean;
}

export interface ScrubResult {
  scanned: number;
  /** Object rows containing at least one secret key (before any change). */
  rowsWithSecret: number;
  secretFields: number;
  /** Rows whose metadata_json is NULL or not a JSON object; never changed. */
  nonObject: number;
  /** Of those, rows whose text mentions a secret key name (manual review). */
  nonObjectMentioningSecret: number;
  rowsChanged: number;
  fieldsRemoved: number;
  /** Object rows still containing a secret after --apply (e.g. locked). */
  remaining: number;
  ids: string[];
  nonObjectIds: string[];
}

/** JSON-object rows that contain a secret key at any depth. */
const HAS_SECRET = `jsonb_typeof(metadata_json) = 'object' AND (${SECRET_KEYS.map(
  (k) => `jsonb_path_exists(metadata_json, 'strict $.**.${k}')`,
).join(' OR ')})`;
const NOT_OBJECT = `(metadata_json IS NULL OR jsonb_typeof(metadata_json) <> 'object')`;
const MENTIONS_SECRET = `(${SECRET_KEYS.map((k) => `strpos(metadata_json::text, '${k}') > 0`).join(' OR ')})`;

/**
 * The paths (for the jsonb `#-` operator) of every secret key in a parsed
 * JSON value. Only object keys are removed, never array elements, so deleting
 * one path never shifts another.
 */
export function secretPaths(value: unknown, prefix: string[] = []): string[][] {
  const out: string[][] = [];
  if (Array.isArray(value)) {
    value.forEach((item, i) => out.push(...secretPaths(item, [...prefix, String(i)])));
  } else if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      const path = [...prefix, key];
      if (SECRET_KEYS.includes(key)) out.push(path);
      else out.push(...secretPaths((value as Record<string, unknown>)[key], path));
    }
  }
  return out;
}

/** JSON.parse without echoing the input: V8's error messages quote part of it. */
function parseMetadata(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('metadata_json could not be parsed');
  }
}

export function parseArgs(argv: string[]): ScrubOptions {
  const opts: ScrubOptions = { apply: false, verifiedBackup: false, batchSize: DEFAULT_BATCH_SIZE, listIds: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') opts.apply = true;
    else if (arg === '--i-have-a-verified-backup') opts.verifiedBackup = true;
    else if (arg === '--list-ids') opts.listIds = true;
    else if (arg === '--batch-size' || arg.startsWith('--batch-size=')) {
      const raw = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[++i];
      if (!raw || !/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 100000) {
        throw new Error('--batch-size must be a whole number from 1 to 100000');
      }
      opts.batchSize = Number(raw);
    } else throw new Error(`Unknown option: ${arg}`);
  }
  return opts;
}

/** Counts and ids, read-only. Object rows are read in keyset batches; their metadata never leaves this function. */
async function survey(client: QueryClient, batchSize: number) {
  const { rows: totals } = await client.query(
    `SELECT count(*)::int AS scanned,
            count(*) FILTER (WHERE ${NOT_OBJECT})::int AS non_object
       FROM payments`,
  );
  const { rows: odd } = await client.query(
    `SELECT id::text AS id FROM payments WHERE ${NOT_OBJECT} AND metadata_json IS NOT NULL AND ${MENTIONS_SECRET} ORDER BY id`,
  );
  const ids: string[] = [];
  let fields = 0;
  let last: string | null = null;
  for (;;) {
    const { rows } = await client.query(
      `SELECT id::text AS id, metadata_json::text AS m FROM payments
        WHERE ${HAS_SECRET} AND ($1::uuid IS NULL OR id > $1::uuid)
        ORDER BY id LIMIT $2`,
      [last, batchSize],
    );
    for (const row of rows) {
      ids.push(row.id);
      fields += secretPaths(parseMetadata(row.m)).length;
    }
    if (rows.length < batchSize) break;
    last = rows[rows.length - 1].id;
  }
  return {
    scanned: totals[0].scanned as number,
    nonObject: totals[0].non_object as number,
    nonObjectIds: odd.map((r) => r.id as string),
    ids,
    fields,
  };
}

/** One batch in its own transaction: lock what is free, re-check, delete the secret keys. */
async function applyBatch(client: QueryClient, after: string | null, batchSize: number) {
  await client.query('BEGIN');
  try {
    // HAS_SECRET is re-evaluated on the locked row version, so a row cleaned
    // concurrently is not selected; secretPaths re-checks the locked value.
    const { rows } = await client.query(
      `SELECT id::text AS id, metadata_json::text AS m FROM payments
        WHERE ${HAS_SECRET} AND ($1::uuid IS NULL OR id > $1::uuid)
        ORDER BY id LIMIT $2
        FOR UPDATE SKIP LOCKED`,
      [after, batchSize],
    );
    const changed: string[] = [];
    let fields = 0;
    for (const row of rows) {
      const paths = secretPaths(parseMetadata(row.m));
      if (paths.length === 0) continue;
      const expr = paths.map((_p, i) => ` #- $${i + 2}::text[]`).join('');
      await client.query(`UPDATE payments SET metadata_json = metadata_json${expr} WHERE id = $1::uuid`, [row.id, ...paths]);
      changed.push(row.id);
      fields += paths.length;
    }
    await client.query('COMMIT');
    return { selected: rows.length, last: rows.length ? (rows[rows.length - 1].id as string) : after, changed, fields };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

export async function scrubPaymentSecrets(client: QueryClient, opts: ScrubOptions): Promise<ScrubResult> {
  const before = await survey(client, opts.batchSize);
  const result: ScrubResult = {
    scanned: before.scanned,
    rowsWithSecret: before.ids.length,
    secretFields: before.fields,
    nonObject: before.nonObject,
    nonObjectMentioningSecret: before.nonObjectIds.length,
    rowsChanged: 0,
    fieldsRemoved: 0,
    remaining: before.ids.length,
    ids: before.ids,
    nonObjectIds: before.nonObjectIds,
  };
  if (!opts.apply || before.ids.length === 0) return result;

  const changed: string[] = [];
  let last: string | null = null;
  for (;;) {
    const batch = await applyBatch(client, last, opts.batchSize);
    changed.push(...batch.changed);
    result.fieldsRemoved += batch.fields;
    if (batch.selected < opts.batchSize) break;
    last = batch.last;
  }
  result.rowsChanged = changed.length;
  result.ids = changed;
  const { rows } = await client.query(`SELECT count(*)::int AS n FROM payments WHERE ${HAS_SECRET}`);
  result.remaining = rows[0].n;
  return result;
}

export function formatResult(r: ScrubResult, opts: ScrubOptions): string {
  const row = (label: string, n: number) => `  ${(label + ':').padEnd(40)}${n}`;
  const lines = [
    `payments.metadata_json secret scrub (${opts.apply ? 'APPLY' : 'dry run, nothing written'})`,
    row('rows scanned', r.scanned),
    row('rows containing a secret field', r.rowsWithSecret),
    row('secret fields found', r.secretFields),
    row('rows skipped (metadata not an object)', r.nonObject),
    row('  of which mention a secret key name', r.nonObjectMentioningSecret),
  ];
  if (opts.apply) {
    lines.push(row('rows changed', r.rowsChanged));
    lines.push(row('secret fields removed', r.fieldsRemoved));
    lines.push(row('rows still containing a secret', r.remaining));
  }
  if (opts.listIds) {
    for (const id of r.ids) lines.push(`  ${opts.apply ? 'changed' : 'contains secret'}: ${id}`);
    for (const id of r.nonObjectIds) lines.push(`  not an object, mentions secret key (review by hand): ${id}`);
  }
  if (r.nonObjectMentioningSecret > 0) {
    lines.push('Rows whose metadata is not a JSON object are never changed; review the ones counted above by hand.');
  }
  if (!opts.apply) {
    lines.push(
      r.rowsWithSecret > 0
        ? 'Rows need cleaning. Re-run with --apply --i-have-a-verified-backup after a verified backup.'
        : 'Nothing to do.',
    );
  } else if (r.remaining > 0) {
    lines.push('Some rows still contain a secret (probably locked by another session). Run the tool again.');
  } else {
    lines.push('Done. Earlier backups, dumps, WAL archives, replicas and logs may still contain the removed values.');
  }
  return lines.join('\n');
}

export function exitCodeFor(r: ScrubResult, opts: ScrubOptions): number {
  if (!opts.apply) return r.rowsWithSecret > 0 ? 2 : 0;
  return r.remaining > 0 ? 1 : 0;
}

export const BACKUP_PREREQUISITE =
  'Prerequisite: a fresh backup of this database, restored and verified with `npm run backup:verify-restore` ' +
  '(docs/operations/customer-update.md, section 6 steps 2-3). Removed values cannot be restored by this tool.';

export function connectionConfig(env: NodeJS.ProcessEnv = process.env, readOnly = true): ClientConfig {
  return {
    host: env.DB_HOST,
    port: env.DB_PORT ? Number(env.DB_PORT) : undefined,
    user: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    database: env.DB_DATABASE,
    ssl: env.DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
    // A dry run cannot write even by mistake.
    options: readOnly ? '-c default_transaction_read_only=on' : undefined,
    application_name: 'invoiceme-scrub-payment-secrets',
  };
}

export async function main(argv: string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): Promise<number> {
  let opts: ScrubOptions;
  try {
    opts = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  if (opts.apply) {
    console.log(BACKUP_PREREQUISITE);
    if (!opts.verifiedBackup) {
      console.error('Refusing to apply without --i-have-a-verified-backup. Nothing was changed.');
      return 1;
    }
  }
  const client = new PgClient(connectionConfig(env, !opts.apply));
  try {
    await client.connect();
    // Never wait long for a table lock; row locks are skipped, not waited for.
    await client.query("SET lock_timeout = '5s'");
    const result = await scrubPaymentSecrets(client, opts);
    console.log(formatResult(result, opts));
    return exitCodeFor(result, opts);
  } catch (error) {
    // Only the message: driver error details can quote row contents.
    console.error(`Payment secret scrub failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code));
}
