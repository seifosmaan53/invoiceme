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
  const run = (x: string, y: string) =>
    spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', path.join(__dirname, 'verify-files.ts'), x, y], { encoding: 'utf8' });

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

  it('directories: a symbolic link is reported as not verified instead of being skipped', () => {
    write('orig/a.txt', 'A');
    write('copy/a.txt', 'A');
    fs.symlinkSync(path.join(tmp, 'orig/a.txt'), path.join(tmp, 'orig/link.txt'));
    fs.symlinkSync(path.join(tmp, 'copy/a.txt'), path.join(tmp, 'copy/link.txt'));
    expect(compareManifests(manifest(path.join(tmp, 'orig')), manifest(path.join(tmp, 'copy')))).toEqual([
      { path: 'link.txt', issue: 'symlink_not_verified' },
    ]);
  });

  it('env files: compares key sets and values without keeping values', () => {
    const a = envDigest('# config\nDB_PASSWORD=s3cret\nJWT_SECRET="abc"\nexport ENCRYPTION_KEY=k1\n');
    expect([...a.entries.keys()].sort()).toEqual(['DB_PASSWORD', 'ENCRYPTION_KEY', 'JWT_SECRET']);
    expect([...a.entries.values()].join()).not.toMatch(/s3cret|abc|k1/);
    expect(compareEnv(a, envDigest('DB_PASSWORD=s3cret\nJWT_SECRET=abc\nENCRYPTION_KEY=k1'))).toEqual({ named: [], unnamed: 0 });
    // A changed key present in both files is named; a missing key is counted, not named.
    expect(compareEnv(a, envDigest('DB_PASSWORD=s3cret\nJWT_SECRET=changed\n'))).toEqual({
      named: [{ path: 'JWT_SECRET', issue: 'content_differs' }],
      unnamed: 1,
    });
  });

  it('env files: a multi-line quoted value (PEM key) is one value, so a changed key body is detected', () => {
    const pem = (body: string) => `JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----"\nPORT=3000\n`;
    const a = envDigest(pem('MIIEvQIBADANBgkqhkiG9w0BAQEFAASC'));
    const b = envDigest(pem('MIIEvQIBADANBgkqhkiG9w0BAQEFAASD'));
    expect([...a.entries.keys()].sort()).toEqual(['JWT_PRIVATE_KEY', 'PORT']);
    expect(compareEnv(a, b).named).toEqual([{ path: 'JWT_PRIVATE_KEY', issue: 'content_differs' }]);
    const r = run(write('a/.env', pem('MIIEvQIBADANBgkqhkiG9w0BAQEFAASC')), write('b/.env', pem('MIIEvQIBADANBgkqhkiG9w0BAQEFAASD')));
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).not.toMatch(/MIIEvQ/);
  });

  it('never names an all-uppercase fragment of an unquoted multi-line key', () => {
    const a = envDigest('SIGNING_KEY=-----BEGIN-----\nSECRETTAIL0KEYMATERIAL==\n');
    const b = envDigest('SIGNING_KEY=-----BEGIN-----\nOTHERTAILKEYMATERIAL==\n');
    const c = compareEnv(a, b);
    expect(c.named).toEqual([]);
    expect(c.unnamed).toBe(2);
  });

  it('CLI never prints values or key material, even a fragment shaped like KEY=VALUE', () => {
    // An unquoted multi-line key: its last line looks like an assignment.
    const orig = write('a/.env', 'JWT_SECRET=very-secret-value\nSIGNING_KEY=-----BEGIN-----\nSecretTail0KeyMaterial==\n');
    const changed = write('c/.env', 'JWT_SECRET=other\nSIGNING_KEY=-----BEGIN-----\nDifferentTailMaterial==\n');
    const same = write('b/.env', 'JWT_SECRET=very-secret-value\nSIGNING_KEY=-----BEGIN-----\nSecretTail0KeyMaterial==\n');
    expect(run(orig, same).status).toBe(0);
    const bad = run(orig, changed);
    expect(bad.status).toBe(1);
    const out = bad.stdout + bad.stderr;
    expect(out).toMatch(/JWT_SECRET/);
    expect(out).toMatch(/other difference\(s\)/);
    expect(out).not.toMatch(/very-secret-value|other\b(?! difference)|SecretTail|DifferentTail|Material/);
  });
});
