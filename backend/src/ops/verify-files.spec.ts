import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { manifest, compareManifests, envDigest, compareEnv } from './verify-files';

describe('verify-files', () => {
  let tmp: string;
  const write = (rel: string, data: string) => {
    const p = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, data);
    return p;
  };

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-files-'));
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('directories: identical trees match; a changed, missing or extra file is reported by path', () => {
    write('orig/invoices/a.pdf', 'AAA');
    write('orig/logo.png', 'LOGO');
    write('copy/invoices/a.pdf', 'AAA');
    write('copy/logo.png', 'LOGO');
    const o = manifest(path.join(tmp, 'orig'));
    expect(compareManifests(o, manifest(path.join(tmp, 'copy')))).toEqual([]);

    write('copy/invoices/a.pdf', 'AAB');
    fs.rmSync(path.join(tmp, 'copy/logo.png'));
    write('copy/stray.txt', 'x');
    expect(compareManifests(o, manifest(path.join(tmp, 'copy')))).toEqual([
      { path: 'invoices/a.pdf', issue: 'content_differs' },
      { path: 'logo.png', issue: 'missing_in_restore' },
      { path: 'stray.txt', issue: 'extra_in_restore' },
    ]);
  });

  it('env files: compares key sets and values without exposing values', () => {
    const a = envDigest('# config\nDB_PASSWORD=s3cret\nJWT_SECRET="abc"\nexport ENCRYPTION_KEY=k1\n');
    expect([...a.keys()].sort()).toEqual(['DB_PASSWORD', 'ENCRYPTION_KEY', 'JWT_SECRET']);
    expect([...a.values()].join()).not.toMatch(/s3cret|abc|k1/);
    expect(compareEnv(a, envDigest('DB_PASSWORD=s3cret\nJWT_SECRET=abc\nENCRYPTION_KEY=k1'))).toEqual([]);
    expect(compareEnv(a, envDigest('DB_PASSWORD=s3cret\nJWT_SECRET=changed\n'))).toEqual([
      { path: 'ENCRYPTION_KEY', issue: 'missing_in_restore' },
      { path: 'JWT_SECRET', issue: 'content_differs' },
    ]);
  });

  it('CLI never prints env values and exits 1 on differences, 0 when identical', () => {
    const orig = write('a/.env', 'JWT_SECRET=very-secret-value\nENCRYPTION_KEY=another-secret\n');
    const same = write('b/.env', 'JWT_SECRET=very-secret-value\nENCRYPTION_KEY=another-secret\n');
    const diff = write('c/.env', 'JWT_SECRET=other\n');
    const run = (x: string, y: string) =>
      spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', path.join(__dirname, 'verify-files.ts'), x, y], { encoding: 'utf8' });
    const ok = run(orig, same);
    expect(ok.status).toBe(0);
    const bad = run(orig, diff);
    expect(bad.status).toBe(1);
    const out = bad.stdout + bad.stderr;
    expect(out).toMatch(/JWT_SECRET/);
    expect(out).not.toMatch(/very-secret-value|another-secret|other\b/);
  });
});
