/**
 * Verifies the parts of a backup that are not in the database.
 *
 *   node dist/ops/verify-files.js <original> <restored>
 *   npm run backup:verify-files -- <original> <restored>   (checkout)
 *
 * - Two directories (e.g. an uploads bucket mirror, a configuration folder):
 *   every file's relative path, size and SHA-256 must match. Prints paths only.
 * - Two .env files (both named .env or *.env, or VERIFY_FILES_MODE=env): the
 *   files are first compared whole (SHA-256). If they differ, the entries are
 *   compared: multi-line quoted values (e.g. PEM keys) are one value; values
 *   are hashed immediately and NEVER printed. A key is named only when it is a
 *   conventional name (UPPER_SNAKE_CASE) present in BOTH files with different
 *   values; missing/extra keys and anything else are counted, not named, so a
 *   fragment of key material can never appear in the output.
 * - Symbolic links inside a directory are reported and count as not verified.
 *
 * Read-only. Exit code: 0 = identical, 1 = differences, 2 = could not run.
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

export interface FileDifference {
  path: string;
  issue: 'missing_in_restore' | 'extra_in_restore' | 'content_differs' | 'symlink_not_verified';
}

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

export const SYMLINK = 'symlink';

export function manifest(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) out.set(path.relative(root, full).split(path.sep).join('/'), SYMLINK);
      else if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const data = fs.readFileSync(full);
        out.set(path.relative(root, full).split(path.sep).join('/'), `${data.length}:${sha256(data)}`);
      }
    }
  };
  walk(root);
  return out;
}

export function compareManifests(a: Map<string, string>, b: Map<string, string>): FileDifference[] {
  const diffs: FileDifference[] = [];
  for (const [p, h] of a) {
    if (h === SYMLINK || b.get(p) === SYMLINK) diffs.push({ path: p, issue: 'symlink_not_verified' });
    else if (!b.has(p)) diffs.push({ path: p, issue: 'missing_in_restore' });
    else if (b.get(p) !== h) diffs.push({ path: p, issue: 'content_differs' });
  }
  for (const [p, h] of b) {
    if (a.has(p)) continue;
    diffs.push({ path: p, issue: h === SYMLINK ? 'symlink_not_verified' : 'extra_in_restore' });
  }
  return diffs.sort((x, y) => x.path.localeCompare(y.path));
}

const KEY_LINE = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s?(.*)$/;
/** Key names that are safe to print: conventional environment variable names. */
export const PRINTABLE_KEY = /^[A-Z][A-Z0-9_]*$/;

export interface EnvDigest {
  /** key -> SHA-256 of the value (values are never kept). */
  entries: Map<string, string>;
  /** SHA-256 of lines that are neither comments nor KEY=VALUE entries. */
  other: string;
}

/**
 * Parses a .env file the way dotenv does for the cases that matter here:
 * KEY=VALUE lines, comments, optional `export`, and quoted values that may span
 * several lines (PEM keys). Values are hashed as soon as they are read.
 */
export function envDigest(text: string): EnvDigest {
  const lines = text.split(/\r?\n/);
  const entries = new Map<string, string>();
  const other: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const m = KEY_LINE.exec(line);
    if (!m) {
      other.push(line);
      continue;
    }
    let value = m[2];
    const q = value[0];
    if (q === '"' || q === "'" || q === '`') {
      const closes = (v: string) => v.length > 1 && v.endsWith(q) && !v.endsWith(`\\${q}`);
      while (!closes(value) && i + 1 < lines.length) value += '\n' + lines[++i];
      if (closes(value)) value = value.slice(1, -1);
    }
    entries.set(m[1], sha256(value));
  }
  return { entries, other: sha256(other.join('\n')) };
}

export interface EnvComparison {
  /** Differences whose key name is safe to print. */
  named: FileDifference[];
  /** Differences in entries with unusual names, or in unparsed lines: counted, never named. */
  unnamed: number;
}

/**
 * Names only keys that exist in BOTH files with different values. A key that
 * exists in one file only may be a fragment of an unquoted multi-line key
 * that happens to look like KEY=VALUE, so it is counted, never named.
 */
export function compareEnv(a: EnvDigest, b: EnvDigest): EnvComparison {
  const all = compareManifests(a.entries, b.entries);
  const named = all.filter((d) => d.issue === 'content_differs' && PRINTABLE_KEY.test(d.path));
  const unnamed = all.length - named.length + (a.other === b.other ? 0 : 1);
  return { named, unnamed };
}

const isEnvFile = (p: string) => /(^|[\\/])\.env$|\.env$/.test(p) || process.env.VERIFY_FILES_MODE === 'env';

function main(argv: string[]): number {
  const [original, restored] = argv;
  if (!original || !restored) {
    console.error('Usage: verify-files <original> <restored>');
    return 2;
  }
  try {
    const a = fs.statSync(original);
    const b = fs.statSync(restored);
    let diffs: FileDifference[];
    let label: string;
    if (a.isDirectory() && b.isDirectory()) {
      const ma = manifest(original);
      diffs = compareManifests(ma, manifest(restored));
      label = `${ma.size} file(s)`;
    } else if (a.isFile() && b.isFile() && isEnvFile(original) && isEnvFile(restored)) {
      const ta = fs.readFileSync(original, 'utf8');
      const tb = fs.readFileSync(restored, 'utf8');
      const ea = envDigest(ta);
      label = `${ea.entries.size} key(s); values compared by hash, never printed`;
      if (sha256(ta) === sha256(tb)) {
        diffs = [];
      } else {
        const c = compareEnv(ea, envDigest(tb));
        diffs = c.named;
        if (c.unnamed > 0) {
          console.log(`[DIFFERS] ${c.unnamed} other difference(s) (missing/extra keys, unusual key names or unparsed lines; names not printed)`);
          diffs = [...diffs, ...Array.from({ length: c.unnamed }, () => ({ path: '', issue: 'content_differs' as const }))];
        }
        if (diffs.length === 0) {
          console.log('[DIFFERS] the files differ only in formatting or comments');
          diffs = [{ path: '', issue: 'content_differs' }];
        }
      }
    } else if (a.isFile() && b.isFile()) {
      diffs = sha256(fs.readFileSync(original)) === sha256(fs.readFileSync(restored))
        ? []
        : [{ path: path.basename(original), issue: 'content_differs' }];
      label = '1 file';
    } else {
      console.error('Both arguments must be directories, or both files.');
      return 2;
    }
    for (const d of diffs) if (d.path) console.log(`[${d.issue.toUpperCase()}] ${d.path}`);
    console.log(diffs.length === 0 ? `OK: identical (${label}).` : `FAILED: ${diffs.length} difference(s) (${label}).`);
    return diffs.length === 0 ? 0 : 1;
  } catch (error) {
    console.error(`File verification failed: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
