import * as fs from 'fs';
import * as path from 'path';
import { ServiceUnavailableException } from '@nestjs/common';
import { SYNC_REQUIRED_TRIGGERS, SYNC_SCHEMA_SQL } from '../src/sync/sync-schema';
import { SyncSchemaService } from '../src/sync/sync-schema.service';
import { readSyncConfig } from '../src/sync/sync-config';

describe('sync schema (migration 019)', () => {
  it('the migration file carries exactly the DDL the server installs and checks', () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '019_sync_revisions_conflicts.sql'), 'utf8');
    const block = sql.split('-- BEGIN SYNC SCHEMA (identical to backend/src/sync/sync-schema.ts)')[1]?.split('-- END SYNC SCHEMA')[0];
    expect(block).toBe(SYNC_SCHEMA_SQL);
    for (const { table, name } of SYNC_REQUIRED_TRIGGERS) {
      expect(SYNC_SCHEMA_SQL).toContain(`CREATE TRIGGER ${name}`);
      expect(SYNC_SCHEMA_SQL).toMatch(new RegExp(`CREATE TRIGGER ${name} [A-Za-z_ ]+ON ${table}\\b`));
    }
  });

  const service = (rows: Array<{ table: string; name: string }>, synchronize = false) => {
    const query = jest.fn(async (sql: string) => (sql.includes('pg_trigger') ? rows : []));
    const svc = new SyncSchemaService({ query } as any, { get: () => (synchronize ? 'true' : undefined) } as any);
    return { svc, query };
  };

  it('refuses sync writes (503) when a trigger is missing, and does not install anything', async () => {
    const { svc, query } = service(SYNC_REQUIRED_TRIGGERS.slice(1));
    await svc.onApplicationBootstrap();
    await expect(svc.assertReady()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(query.mock.calls.some(([sql]) => sql === SYNC_SCHEMA_SQL)).toBe(false);
  });

  it('is ready when every trigger exists; installs them itself only with DB_SYNCHRONIZE', async () => {
    const all = service([...SYNC_REQUIRED_TRIGGERS]);
    await all.svc.onApplicationBootstrap();
    await expect(all.svc.assertReady()).resolves.toBeUndefined();
    expect(all.query.mock.calls.some(([sql]) => sql === SYNC_SCHEMA_SQL)).toBe(false);

    const synced = service([...SYNC_REQUIRED_TRIGGERS], true);
    await synced.svc.onApplicationBootstrap();
    expect(synced.query.mock.calls[0][0]).toBe(SYNC_SCHEMA_SQL);
  });
});

describe('sync configuration', () => {
  it('defaults: no legacy cutoff, 400-day retention, 180-day resolved conflicts', () => {
    expect(readSyncConfig({})).toEqual({ legacyWriteCutoff: null, retentionDays: 400, conflictRetentionDays: 180 });
  });

  it('reads a cutoff date as UTC midnight, or a full timestamp', () => {
    expect(readSyncConfig({ SYNC_LEGACY_WRITE_CUTOFF: '2027-03-01' }).legacyWriteCutoff?.toISOString()).toBe('2027-03-01T00:00:00.000Z');
    expect(readSyncConfig({ SYNC_LEGACY_WRITE_CUTOFF: '2027-03-01T12:00:00-05:00' }).legacyWriteCutoff?.toISOString()).toBe(
      '2027-03-01T17:00:00.000Z',
    );
  });

  it.each([
    ['SYNC_LEGACY_WRITE_CUTOFF', 'soon'],
    ['SYNC_LEGACY_WRITE_CUTOFF', '01/03/2027'],
    ['SYNC_RETENTION_DAYS', '30'],
    ['SYNC_RETENTION_DAYS', 'forever'],
    ['SYNC_CONFLICT_RETENTION_DAYS', '1'],
  ])('rejects %s=%s at startup', (name, value) => {
    expect(() => readSyncConfig({ [name]: value })).toThrow(name);
  });
});
