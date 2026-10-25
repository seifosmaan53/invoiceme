/**
 * Verifies the parts of a backup that are not in the database.
 *
 *   node dist/ops/verify-files.js <original> <restored>
 *   npm run backup:verify-files -- <original> <restored>   (checkout)
 *
 * - Two directories (e.g. an uploads bucket mirror, a configuration folder):
 *   every file's relative path, size and SHA-256 must match. Prints paths only.
 * - Two .env files (both named .env or *.env, or VERIFY_FILES_MODE=env): the
 *   set of keys must match and every value must be identical. Values are
 *   compared by hash and NEVER printed; only key names appear in the output.
 *
 * Read-only. Exit code: 0 = identical, 1 = differences, 2 = could not run.
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

export interface FileDifference {
  path: string;
  issue: 'missing_in_restore' | 'extra_in_restore' | 'content_differs';
}

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

export function manifest(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
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
    if (!b.has(p)) diffs.push({ path: p, issue: 'missing_in_restore' });
    else if (b.get(p) !== h) diffs.push({ path: p, issue: 'content_differs' });
  }
  for (const p of b.keys()) if (!a.has(p)) diffs.push({ path: p, issue: 'extra_in_restore' });
  return diffs.sort((x, y) => x.path.localeCompare(y.path));
}

/** Parses KEY=VALUE lines (comments and blank lines ignored, optional quotes stripped). Values are hashed immediately. */
export function envDigest(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out.set(m[1], sha256(value));
  }
  return out;
}

export function compareEnv(a: Map<string, string>, b: Map<string, string>): FileDifference[] {
  // For env files the "path" is the key name; values never leave this function.
  return compareManifests(a, b);
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
      const ea = envDigest(fs.readFileSync(original, 'utf8'));
      diffs = compareEnv(ea, envDigest(fs.readFileSync(restored, 'utf8')));
      label = `${ea.size} key(s); values compared by hash, not printed`;
    } else if (a.isFile() && b.isFile()) {
      diffs = sha256(fs.readFileSync(original)) === sha256(fs.readFileSync(restored))
        ? []
        : [{ path: path.basename(original), issue: 'content_differs' }];
      label = '1 file';
    } else {
      console.error('Both arguments must be directories, or both files.');
      return 2;
    }
    for (const d of diffs) console.log(`[${d.issue.toUpperCase()}] ${d.path}`);
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
