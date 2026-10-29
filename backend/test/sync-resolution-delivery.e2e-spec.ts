/**
 * After a conflict is resolved, the record is delivered again by the next
 * protocol-2 pull, whatever the resolution wrote (docs/SYNC-CONTRACT.md
 * "Delivery guarantee").
 *
 * The device holds back server rows of records it has a pending change for
 * and, after "use my version", drops the held row and waits for the server's
 * new revision. When the device's fields already equal the server's, that
 * resolution writes nothing and the revision does not move; without a
 * re-delivery the server's other changes (here: email) would never arrive.
 */
import * as request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Client } from '../src/entities/client.entity';
import { createE2eApp, E2eApp } from './e2e-app';

describe('Conflict resolution re-delivers the record (E2E)', () => {
  let e2e: E2eApp;
  let clients: Repository<Client>;
  let token: string;

  beforeAll(async () => {
    e2e = await createE2eApp();
    clients = e2e.moduleFixture.get(getRepositoryToken(Client));
  });
  afterAll(async () => {
    await e2e.app.close();
  });
  beforeEach(async () => {
    await e2e.truncateAll();
    token = (await e2e.createUser('resolution-delivery@example.test')).token;
  });

  const http = () => request(e2e.app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  async function pullAll(cursor?: string) {
    const clientsSeen: any[] = [];
    for (;;) {
      const res = await http()
        .get('/api/v1/sync/pull')
        .query({ protocol: '2', ...(cursor ? { cursor } : {}) })
        .set(auth())
        .expect(200);
      clientsSeen.push(...res.body.clients);
      cursor = res.body.cursor;
      if (!res.body.hasMore) return { clients: clientsSeen, cursor: cursor as string };
    }
  }

  const push = (changes: any[]) =>
    http().post('/api/v1/sync/push').set(auth()).send({ protocol: 2, deviceId: 'phone', changes }).expect(200);

  /** A stale phone edit of `name` that conflicts with a web edit of `name`; returns the conflict and the cursor after the web edit was delivered. */
  async function conflictWithHeldServerRow() {
    const id = uuidv4();
    await push([{ change_id: uuidv4(), object_type: 'client', object_id: id, change_type: 'create', data: { name: 'Original', email: 'old@example.test' } }]);
    const base = await pullAll();

    // Web edit (revision 2), delivered to the device while its own change is pending: the device holds it back
    await clients.update({ id }, { name: 'Web' });
    const held = await pullAll(base.cursor);
    expect(held.clients.map((c) => [c.id, c.revision])).toEqual([[id, 2]]);

    const res = await push([{ change_id: uuidv4(), base_revision: 1, object_type: 'client', object_id: id, change_type: 'update', data: { name: 'Phone' } }]);
    expect(res.body.results[0].status).toBe('conflict');
    return { id, conflictId: res.body.results[0].conflict_id as string, cursor: held.cursor };
  }

  const resolve = (conflictId: string, body: Record<string, any>) =>
    http().post(`/api/v1/sync/conflicts/${conflictId}/resolve`).set(auth()).send(body).expect(200);

  it('"use my version" that writes nothing new (the server already has the phone\'s value) still re-delivers the record', async () => {
    const { id, conflictId, cursor } = await conflictWithHeldServerRow();
    // Another web edit makes the server agree with the phone on name, and changes email
    await clients.update({ id }, { name: 'Phone', email: 'new@example.test' });
    const between = await pullAll(cursor); // delivered while the conflict is open: held again on the device
    const revision = (await clients.findOneByOrFail({ id })).revision;

    await resolve(conflictId, { action: 'apply_client', expected_revision: revision });
    expect((await clients.findOneByOrFail({ id })).revision).toBe(revision); // a no-op write: revision unchanged

    const after = await pullAll(between.cursor);
    expect(after.clients.map((c) => [c.id, c.name, c.email, c.revision])).toEqual([[id, 'Phone', 'new@example.test', revision]]);
  });

  it.each(['apply_client', 'dismiss'])('every resolution (%s) re-delivers the record once', async (action) => {
    const { id, conflictId, cursor } = await conflictWithHeldServerRow();
    const revision = (await clients.findOneByOrFail({ id })).revision;
    await resolve(conflictId, { action, expected_revision: revision });
    const after = await pullAll(cursor);
    expect(after.clients.map((c) => c.id)).toEqual([id]);
    const quiet = await pullAll(after.cursor);
    expect(quiet.clients).toEqual([]);
  });
});
