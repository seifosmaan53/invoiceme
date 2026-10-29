/**
 * Temporary failures are reported as `retry_later`, not `rejected`
 * (docs/SYNC-CONTRACT.md "Outcomes"): nothing is applied or recorded, and
 * resending the same change (same change_id) applies it once the database
 * recovers. Real PostgreSQL error: the push's query is cancelled (57014)
 * while it waits for a lock another session holds.
 */
import * as request from 'supertest';
import { Client as PgClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Client } from '../src/entities/client.entity';
import { DeviceChange } from '../src/entities/device-change.entity';
import { isTransientFailure } from '../src/sync/sync.service';
import { createE2eApp, E2eApp } from './e2e-app';

describe('Sync push: temporary failures are retryable (E2E)', () => {
  let e2e: E2eApp;
  let clients: Repository<Client>;
  let changes: Repository<DeviceChange>;
  let token: string;
  let userId: string;
  const sessions: PgClient[] = [];

  beforeAll(async () => {
    e2e = await createE2eApp();
    clients = e2e.moduleFixture.get(getRepositoryToken(Client));
    changes = e2e.moduleFixture.get(getRepositoryToken(DeviceChange));
  });
  afterAll(async () => {
    await e2e.app.close();
  });
  beforeEach(async () => {
    await e2e.truncateAll();
    const a = await e2e.createUser('retry-a@example.test');
    token = a.token;
    userId = a.user.id;
  });
  afterEach(async () => {
    for (const s of sessions.splice(0)) await s.end().catch(() => undefined);
  });

  async function session() {
    const s = new PgClient({
      host: process.env.DB_TEST_HOST || process.env.DB_HOST,
      port: Number(process.env.DB_TEST_PORT || process.env.DB_PORT),
      user: process.env.DB_TEST_USERNAME || process.env.DB_USERNAME,
      password: process.env.DB_TEST_PASSWORD || process.env.DB_PASSWORD,
      database: process.env.DB_TEST_DATABASE,
    });
    await s.connect();
    sessions.push(s);
    return s;
  }

  const push = (list: any[]) =>
    request(e2e.app.getHttpServer())
      .post('/api/v1/sync/push')
      .set('Authorization', `Bearer ${token}`)
      .send({ protocol: 2, deviceId: 'device-r', changes: list });

  it('a push cancelled while waiting for a lock is retry_later; the resend applies it', async () => {
    const client = await clients.save(clients.create({ userId, name: 'before' }));
    const edit = {
      change_id: uuidv4(),
      base_revision: client.revision,
      object_type: 'client',
      object_id: client.id,
      change_type: 'update',
      data: { name: 'after' },
      device_id: 'device-r',
      updated_at: new Date().toISOString(),
    };

    // Another session holds the object's sync lock
    const holder = await session();
    await holder.query('BEGIN');
    await holder.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`sync:client:${client.id}`]);

    const pending = push([edit]).then((r) => r);
    const admin = await session();
    let waiting: number | undefined;
    for (let i = 0; i < 100 && !waiting; i++) {
      const { rows } = await admin.query(
        `SELECT pid FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query LIKE '%pg_advisory_xact_lock%' AND pid <> $1`,
        [(holder as any).processID],
      );
      waiting = rows[0]?.pid;
      if (!waiting) await new Promise((r) => setTimeout(r, 50));
    }
    expect(waiting).toBeDefined();
    await admin.query('SELECT pg_cancel_backend($1)', [waiting]);

    const res = await pending;
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([expect.objectContaining({ status: 'failed', reason: 'retry_later' })]);
    // Nothing applied, nothing recorded: the change_id is still free
    expect((await clients.findOneByOrFail({ id: client.id })).name).toBe('before');
    expect(await changes.countBy({ changeId: edit.change_id } as any)).toBe(0);

    await holder.query('COMMIT');
    const retry = await push([edit]).expect(200);
    expect(retry.body.results).toEqual([expect.objectContaining({ status: 'applied' })]);
    expect((await clients.findOneByOrFail({ id: client.id })).name).toBe('after');
  });

  it('a change the server refuses on its merits stays a permanent failure, not retry_later', async () => {
    const res = await push([
      { change_id: uuidv4(), object_type: 'client', object_id: uuidv4(), change_type: 'update', data: { name: 'x' }, base_revision: 1, updated_at: new Date().toISOString() },
    ]).expect(200);
    expect(res.body.results[0].status).toBe('failed');
    expect(res.body.results[0].reason).not.toBe('retry_later');
  });

  it('classifies database and connection errors', () => {
    for (const code of ['40001', '40P01', '55P03', '57014', '08006', '53300']) {
      expect(isTransientFailure({ driverError: { code } })).toBe(true);
    }
    expect(isTransientFailure({ code: 'ECONNRESET' })).toBe(true);
    // node-postgres errors without a code
    expect(isTransientFailure(new Error('Connection terminated unexpectedly'))).toBe(true);
    expect(isTransientFailure(new Error('timeout exceeded when trying to connect'))).toBe(true);
    expect(isTransientFailure({ message: 'x', driverError: new Error('Connection terminated due to connection timeout') })).toBe(true);
    for (const code of ['23505', '23503', '22P02', '42501', undefined]) {
      expect(isTransientFailure({ driverError: { code } })).toBe(false);
    }
    expect(isTransientFailure(new Error('validation'))).toBe(false);
  });
});
