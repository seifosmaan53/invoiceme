import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, ValidationPipeOptions } from '@nestjs/common';
import * as request from 'supertest';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { AppModule } from '../src/app.module';
import { User } from '../src/entities/user.entity';
import { Client } from '../src/entities/client.entity';
import { Invoice, InvoiceType, InvoiceStatus } from '../src/entities/invoice.entity';
import { InvoiceItem } from '../src/entities/invoice-item.entity';
import { DeviceChange, ChangeType, ChangeObjectType } from '../src/entities/device-change.entity';

/**
 * The /api/v1/sync/push delivery contract (docs/SYNC-CONTRACT.md): replays,
 * per-change results, retry after a partial failure, ordering, deletion and
 * concurrent writes. Real PostgreSQL (the disposable test database), synthetic
 * users only. Every push goes through the production ValidationPipe options
 * (whitelist + forbidNonWhitelisted), so new request fields must be accepted
 * there and old clients that omit them keep working.
 */

// Copy of the global pipe options in src/main.ts (production bootstrap).
const PRODUCTION_PIPE: ValidationPipeOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
  forbidUnknownValues: true,
  validateCustomDecorators: true,
  stopAtFirstError: false,
};

describe('Sync push contract (E2E)', () => {
  let app: INestApplication;
  let moduleFixture: TestingModule;
  let userRepository: Repository<User>;
  let clientRepository: Repository<Client>;
  let invoiceRepository: Repository<Invoice>;
  let invoiceItemRepository: Repository<InvoiceItem>;
  let deviceChangeRepository: Repository<DeviceChange>;

  let userA: User;
  let userB: User;
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    moduleFixture = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.test', '.env'] }), AppModule],
    })
      .overrideModule(TypeOrmModule)
      .useModule(
        TypeOrmModule.forRootAsync({
          imports: [ConfigModule],
          useFactory: (configService: ConfigService) => ({
            type: 'postgres',
            host: configService.get('DB_TEST_HOST') || configService.get('DB_HOST'),
            port: configService.get('DB_TEST_PORT') || configService.get('DB_PORT'),
            username: configService.get('DB_TEST_USERNAME') || configService.get('DB_USERNAME'),
            password: configService.get('DB_TEST_PASSWORD') || configService.get('DB_PASSWORD'),
            database: configService.get('DB_TEST_DATABASE') || configService.get('DB_DATABASE') + '_test',
            entities: [__dirname + '/../src/entities/**/*.entity.ts'],
            synchronize: false,
            logging: false,
          }),
          inject: [ConfigService],
        }),
      )
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe(PRODUCTION_PIPE));
    app.setGlobalPrefix('api');
    await app.init();

    userRepository = moduleFixture.get(getRepositoryToken(User));
    clientRepository = moduleFixture.get(getRepositoryToken(Client));
    invoiceRepository = moduleFixture.get(getRepositoryToken(Invoice));
    invoiceItemRepository = moduleFixture.get(getRepositoryToken(InvoiceItem));
    deviceChangeRepository = moduleFixture.get(getRepositoryToken(DeviceChange));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const ds = userRepository.manager.connection;
    await ds.query(
      'TRUNCATE TABLE ' + ds.entityMetadatas.map((m) => `"${m.tableName}"`).join(', ') + ' RESTART IDENTITY CASCADE',
    );
    const passwordHash = await bcrypt.hash('password123', 4);
    userA = await userRepository.save(
      userRepository.create({ email: 'sync-a@example.test', passwordHash, name: 'User A', companyName: 'A Co' }),
    );
    userB = await userRepository.save(
      userRepository.create({ email: 'sync-b@example.test', passwordHash, name: 'User B', companyName: 'B Co' }),
    );
    const jwt = moduleFixture.get(JwtService);
    const secret = moduleFixture.get(ConfigService).get('JWT_SECRET');
    tokenA = jwt.sign({ sub: userA.id, email: userA.email }, { secret, expiresIn: '15m' });
    tokenB = jwt.sign({ sub: userB.id, email: userB.email }, { secret, expiresIn: '15m' });
  });

  /** A change as the current mobile client sends it, optionally with a change_id. */
  const change = (
    objectType: ChangeObjectType,
    objectId: string,
    changeType: ChangeType,
    data: Record<string, any> = {},
    changeId?: string,
  ) => ({
    ...(changeId ? { change_id: changeId } : {}),
    object_type: objectType,
    object_id: objectId,
    change_type: changeType,
    data,
    device_id: 'device-test',
    updated_at: new Date().toISOString(),
  });

  const push = (token: string, changes: any[]) =>
    request(app.getHttpServer())
      .post('/api/v1/sync/push')
      .set('Authorization', `Bearer ${token}`)
      .send({ deviceId: 'device-test', changes })
      .expect(200);

  /** Protocol 2 push (revisions and conflicts). */
  const push2 = (token: string, changes: any[]) =>
    request(app.getHttpServer())
      .post('/api/v1/sync/push')
      .set('Authorization', `Bearer ${token}`)
      .send({ protocol: 2, deviceId: 'device-test', changes })
      .expect(200);

  const invoiceData = (clientId: string, number: string) => ({
    clientId,
    type: InvoiceType.INVOICE,
    number,
    issueDate: '2026-10-01',
    dueDate: '2026-10-31',
    currency: 'USD',
    subtotal: 100,
    taxTotal: 0,
    discountTotal: 0,
    total: 100,
    status: InvoiceStatus.DRAFT,
  });

  const changeRows = (userId: string) => deviceChangeRepository.find({ where: { userId } });

  describe('replayed operations (change_id)', () => {
    it('a retry of the same batch is answered as duplicate and applied once', async () => {
      const clientId = uuidv4();
      const invoiceId = uuidv4();
      const batch = [
        change(ChangeObjectType.CLIENT, clientId, ChangeType.CREATE, { name: 'Acme' }, uuidv4()),
        change(ChangeObjectType.INVOICE, invoiceId, ChangeType.CREATE, invoiceData(clientId, 'A-1'), uuidv4()),
      ];

      const first = await push(tokenA, batch);
      expect(first.body).toMatchObject({ synced: 2, failed: 0 });
      expect(first.body.results.map((r: any) => r.status)).toEqual(['applied', 'applied']);
      const before = await clientRepository.findOneByOrFail({ id: clientId });

      // Same batch again, as after a lost response.
      const retry = await push(tokenA, batch);
      expect(retry.body).toMatchObject({ synced: 2, failed: 0 });
      expect(retry.body.results.map((r: any) => r.status)).toEqual(['duplicate', 'duplicate']);
      expect(retry.body.results.map((r: any) => r.change_id)).toEqual(batch.map((c) => c.change_id));

      expect(await clientRepository.countBy({ userId: userA.id })).toBe(1);
      expect(await invoiceRepository.countBy({ userId: userA.id })).toBe(1);
      expect(await changeRows(userA.id)).toHaveLength(2);
      // Not re-applied: the record was not touched again.
      expect((await clientRepository.findOneByOrFail({ id: clientId })).updatedAt).toEqual(before.updatedAt);
    });

    it('a replayed old update does not overwrite a newer one', async () => {
      const clientId = uuidv4();
      const oldUpdate = change(ChangeObjectType.CLIENT, clientId, ChangeType.UPDATE, { name: 'v1' }, uuidv4());
      await push(tokenA, [change(ChangeObjectType.CLIENT, clientId, ChangeType.CREATE, { name: 'v0' }, uuidv4())]);
      await push(tokenA, [oldUpdate]);
      await push(tokenA, [change(ChangeObjectType.CLIENT, clientId, ChangeType.UPDATE, { name: 'v2' }, uuidv4())]);

      const replay = await push(tokenA, [oldUpdate]);
      expect(replay.body.results[0].status).toBe('duplicate');
      expect((await clientRepository.findOneByOrFail({ id: clientId })).name).toBe('v2');
    });

    it('a replayed create does not resurrect a deleted invoice item', async () => {
      const clientId = uuidv4();
      const invoiceId = uuidv4();
      const itemId = uuidv4();
      const createItem = change(
        ChangeObjectType.INVOICE_ITEM,
        itemId,
        ChangeType.CREATE,
        { invoiceId, description: 'Line', quantity: 1, unitPrice: 10, lineTotal: 10 },
        uuidv4(),
      );
      await push(tokenA, [
        change(ChangeObjectType.CLIENT, clientId, ChangeType.CREATE, { name: 'Acme' }, uuidv4()),
        change(ChangeObjectType.INVOICE, invoiceId, ChangeType.CREATE, invoiceData(clientId, 'A-1'), uuidv4()),
        createItem,
      ]);
      await push(tokenA, [change(ChangeObjectType.INVOICE_ITEM, itemId, ChangeType.DELETE, {}, uuidv4())]);
      expect(await invoiceItemRepository.existsBy({ id: itemId })).toBe(false);

      const replay = await push(tokenA, [createItem]);
      expect(replay.body.results[0].status).toBe('duplicate');
      expect(await invoiceItemRepository.existsBy({ id: itemId })).toBe(false);
    });

    it('reusing a change_id for a different change fails and applies nothing', async () => {
      const changeId = uuidv4();
      const clientId = uuidv4();
      await push(tokenA, [change(ChangeObjectType.CLIENT, clientId, ChangeType.CREATE, { name: 'Acme' }, changeId)]);

      const reuse = await push(tokenA, [
        change(ChangeObjectType.CLIENT, clientId, ChangeType.UPDATE, { name: 'Changed' }, changeId),
      ]);
      expect(reuse.body).toMatchObject({ synced: 0, failed: 1 });
      expect(reuse.body.results[0].status).toBe('failed');
      expect((await clientRepository.findOneByOrFail({ id: clientId })).name).toBe('Acme');
      // Positive control: the same update with a fresh change_id applies.
      const fresh = await push(tokenA, [
        change(ChangeObjectType.CLIENT, clientId, ChangeType.UPDATE, { name: 'Changed' }, uuidv4()),
      ]);
      expect(fresh.body.results[0].status).toBe('applied');
      expect((await clientRepository.findOneByOrFail({ id: clientId })).name).toBe('Changed');
    });

    it('reusing a change_id for the same object and type with different data fails and applies nothing', async () => {
      const changeId = uuidv4();
      const clientId = uuidv4();
      await push(tokenA, [change(ChangeObjectType.CLIENT, clientId, ChangeType.CREATE, { name: 'Acme' }, uuidv4())]);
      const first = await push(tokenA, [change(ChangeObjectType.CLIENT, clientId, ChangeType.UPDATE, { name: 'First' }, changeId)]);
      expect(first.body.results[0].status).toBe('applied');

      const reuse = await push(tokenA, [change(ChangeObjectType.CLIENT, clientId, ChangeType.UPDATE, { name: 'Second' }, changeId)]);
      expect(reuse.body.results[0].status).toBe('failed');
      expect((await clientRepository.findOneByOrFail({ id: clientId })).name).toBe('First');

      // Positive control: the identical change is a duplicate, not a failure
      const replay = await push(tokenA, [change(ChangeObjectType.CLIENT, clientId, ChangeType.UPDATE, { name: 'First' }, changeId)]);
      expect(replay.body.results[0].status).toBe('duplicate');
    });

    it('change_ids are scoped per user: another user’s identical change_id is a separate change', async () => {
      const changeId = uuidv4();
      const clientA = uuidv4();
      const clientB = uuidv4();
      const a = await push(tokenA, [change(ChangeObjectType.CLIENT, clientA, ChangeType.CREATE, { name: 'A' }, changeId)]);
      const b = await push(tokenB, [change(ChangeObjectType.CLIENT, clientB, ChangeType.CREATE, { name: 'B' }, changeId)]);
      expect(a.body.results[0].status).toBe('applied');
      expect(b.body.results[0].status).toBe('applied');
      expect((await clientRepository.findOneByOrFail({ id: clientB })).userId).toBe(userB.id);
      expect(await changeRows(userA.id)).toHaveLength(1);
      expect(await changeRows(userB.id)).toHaveLength(1);
    });

    it('concurrent deliveries of the same change apply it once', async () => {
      const clientId = uuidv4();
      const batch = [
        change(ChangeObjectType.CLIENT, clientId, ChangeType.CREATE, { name: 'Acme' }, uuidv4()),
        change(ChangeObjectType.CLIENT, clientId, ChangeType.UPDATE, { email: 'a@example.test' }, uuidv4()),
      ];
      const responses = await Promise.all([push(tokenA, batch), push(tokenA, batch), push(tokenA, batch)]);

      for (const res of responses) expect(res.body).toMatchObject({ synced: 2, failed: 0 });
      const statuses = responses.flatMap((r) => r.body.results.map((x: any) => x.status));
      expect(statuses.filter((s) => s === 'applied')).toHaveLength(2);
      expect(statuses.filter((s) => s === 'duplicate')).toHaveLength(4);
      expect(await changeRows(userA.id)).toHaveLength(2);
      expect(await clientRepository.findOneByOrFail({ id: clientId })).toMatchObject({
        name: 'Acme',
        email: 'a@example.test',
      });
    });
  });

  describe('acknowledgements', () => {
    it('reports which change failed, so a failure in the middle is not acknowledged as applied', async () => {
      const ok1 = uuidv4();
      const ok2 = uuidv4();
      const res = await push(tokenA, [
        change(ChangeObjectType.CLIENT, ok1, ChangeType.CREATE, { name: 'First' }, uuidv4()),
        // References a client that does not exist: fails.
        change(ChangeObjectType.INVOICE, uuidv4(), ChangeType.CREATE, invoiceData(uuidv4(), 'A-1'), uuidv4()),
        change(ChangeObjectType.CLIENT, ok2, ChangeType.CREATE, { name: 'Third' }, uuidv4()),
      ]);

      expect(res.body).toMatchObject({ synced: 2, failed: 1 });
      expect(res.body.results.map((r: any) => [r.index, r.status])).toEqual([
        [0, 'applied'],
        [1, 'failed'],
        [2, 'applied'],
      ]);
      // The counts alone would make a client that marks the first `synced`
      // changes acknowledge index 1 and resend index 2.
      const rows = await changeRows(userA.id);
      expect(rows.filter((r) => r.synced)).toHaveLength(2);
      expect(rows.filter((r) => !r.synced).map((r) => r.objectType)).toEqual([ChangeObjectType.INVOICE]);
    });

    it('identifies changes without a change_id by index and object (old clients)', async () => {
      const res = await push(tokenA, [
        change(ChangeObjectType.CLIENT, uuidv4(), ChangeType.CREATE, { name: 'Legacy' }),
        change(ChangeObjectType.INVOICE, uuidv4(), ChangeType.CREATE, invoiceData(uuidv4(), 'A-1')),
      ]);
      expect(res.body).toMatchObject({ synced: 1, failed: 1 });
      expect(res.body.results.map((r: any) => [r.index, r.change_id, r.status])).toEqual([
        [0, null, 'applied'],
        [1, null, 'failed'],
      ]);
    });
  });

  describe('retry after a partial batch failure', () => {
    it('retrying the same batch applies the failed change and does not re-apply the others', async () => {
      const clientId = uuidv4();
      const invoiceId = uuidv4();
      // Child before parent: the invoice fails because its client does not exist yet.
      const batch = [
        change(ChangeObjectType.INVOICE, invoiceId, ChangeType.CREATE, invoiceData(clientId, 'A-1'), uuidv4()),
        change(ChangeObjectType.CLIENT, clientId, ChangeType.CREATE, { name: 'Acme' }, uuidv4()),
      ];
      const first = await push(tokenA, batch);
      expect(first.body.results.map((r: any) => r.status)).toEqual(['failed', 'applied']);
      expect(await invoiceRepository.existsBy({ id: invoiceId })).toBe(false);

      // The client changed the record between the attempts; the replayed create must not undo that.
      await push(tokenA, [change(ChangeObjectType.CLIENT, clientId, ChangeType.UPDATE, { name: 'Acme Ltd' }, uuidv4())]);

      const retry = await push(tokenA, batch);
      expect(retry.body).toMatchObject({ synced: 2, failed: 0 });
      expect(retry.body.results.map((r: any) => r.status)).toEqual(['applied', 'duplicate']);
      expect(await invoiceRepository.findOneByOrFail({ id: invoiceId })).toMatchObject({ userId: userA.id, clientId });
      expect((await clientRepository.findOneByOrFail({ id: clientId })).name).toBe('Acme Ltd');

      // One audit row per change_id, all applied now.
      const rows = await changeRows(userA.id);
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.synced)).toBe(true);
    });

    it('a change that keeps failing stays failed on every retry and does not block the rest', async () => {
      const clientId = uuidv4();
      const batch = [
        change(ChangeObjectType.INVOICE, uuidv4(), ChangeType.CREATE, invoiceData(uuidv4(), 'A-1'), uuidv4()),
        change(ChangeObjectType.CLIENT, clientId, ChangeType.CREATE, { name: 'Acme' }, uuidv4()),
      ];
      await push(tokenA, batch);
      const retry = await push(tokenA, batch);
      expect(retry.body.results.map((r: any) => r.status)).toEqual(['failed', 'duplicate']);
      expect(await changeRows(userA.id)).toHaveLength(2);
    });

    it('a failed change leaves no partial write behind', async () => {
      const clientId = uuidv4();
      await push(tokenA, [change(ChangeObjectType.CLIENT, clientId, ChangeType.CREATE, { name: 'Acme' }, uuidv4())]);
      // name is NOT NULL: the update fails in the database.
      const changeId = uuidv4();
      const res = await push(tokenA, [
        change(ChangeObjectType.CLIENT, clientId, ChangeType.UPDATE, { name: null, email: 'x@example.test' }, changeId),
      ]);
      expect(res.body.results[0].status).toBe('failed');
      expect(await clientRepository.findOneByOrFail({ id: clientId })).toMatchObject({ name: 'Acme', email: null });
      // The failed change is still recorded, unapplied, for the audit log and a later retry.
      expect(await deviceChangeRepository.findOneByOrFail({ userId: userA.id, changeId })).toMatchObject({
        synced: false,
      });
    });
  });

  describe('deletion, recreation and stale edits across users', () => {
    it('another user cannot take over a soft-deleted client by recreating its id; the owner restores it only explicitly', async () => {
      const clientId = uuidv4();
      await push(tokenA, [change(ChangeObjectType.CLIENT, clientId, ChangeType.CREATE, { name: 'Mine' }, uuidv4())]);
      await push(tokenA, [change(ChangeObjectType.CLIENT, clientId, ChangeType.DELETE, {}, uuidv4())]);

      const takeover = await push(tokenB, [
        change(ChangeObjectType.CLIENT, clientId, ChangeType.CREATE, { name: 'Taken', deletedAt: null }, uuidv4()),
      ]);
      expect(takeover.body.results[0].status).toBe('failed');
      const row = await clientRepository.findOneByOrFail({ id: clientId });
      expect(row).toMatchObject({ userId: userA.id, name: 'Mine' });
      expect(row.deletedAt).not.toBeNull();

      // Sync no longer un-deletes: deletedAt is not writable, and an edit of a deleted record is refused.
      const legacy = await push(tokenA, [
        change(ChangeObjectType.CLIENT, clientId, ChangeType.UPDATE, { deletedAt: null, name: 'Edited' }, uuidv4()),
      ]);
      expect(legacy.body.results[0]).toMatchObject({ status: 'failed', reason: 'record_deleted' });
      expect((await clientRepository.findOneByOrFail({ id: clientId })).deletedAt).not.toBeNull();

      // Positive control: the owner's protocol-2 edit becomes a conflict, and restoring it is explicit.
      const deletedRevision = (await clientRepository.findOneByOrFail({ id: clientId })).revision;
      const edit = await push2(tokenA, [
        { ...change(ChangeObjectType.CLIENT, clientId, ChangeType.UPDATE, { name: 'Edited' }, uuidv4()), base_revision: 1 },
      ]);
      expect(edit.body.results[0]).toMatchObject({ status: 'conflict' });
      await request(app.getHttpServer())
        .post(`/api/v1/sync/conflicts/${edit.body.results[0].conflict_id}/resolve`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ action: 'restore', expected_revision: deletedRevision })
        .expect(200);
      expect(await clientRepository.findOneByOrFail({ id: clientId })).toMatchObject({ deletedAt: null, name: 'Edited' });
    });

    it('a deleted item id stays reserved: another user cannot take it, and a stale edit changes nothing', async () => {
      // A creates and deletes an item; its tombstone keeps the id reserved for A.
      const clientA = uuidv4();
      const invoiceA = uuidv4();
      const itemId = uuidv4();
      await push(tokenA, [
        change(ChangeObjectType.CLIENT, clientA, ChangeType.CREATE, { name: 'A' }, uuidv4()),
        change(ChangeObjectType.INVOICE, invoiceA, ChangeType.CREATE, invoiceData(clientA, 'A-1'), uuidv4()),
        change(ChangeObjectType.INVOICE_ITEM, itemId, ChangeType.CREATE, { invoiceId: invoiceA, description: 'A line' }, uuidv4()),
      ]);
      await push(tokenA, [change(ChangeObjectType.INVOICE_ITEM, itemId, ChangeType.DELETE, {}, uuidv4())]);

      // B now owns a record with that id.
      const clientB = uuidv4();
      const invoiceB = uuidv4();
      const created = await push(tokenB, [
        change(ChangeObjectType.CLIENT, clientB, ChangeType.CREATE, { name: 'B' }, uuidv4()),
        change(ChangeObjectType.INVOICE, invoiceB, ChangeType.CREATE, invoiceData(clientB, 'B-1'), uuidv4()),
        change(ChangeObjectType.INVOICE_ITEM, itemId, ChangeType.CREATE, { invoiceId: invoiceB, description: 'B line' }, uuidv4()),
      ]);
      expect(created.body.results.map((r: any) => r.status)).toEqual(['applied', 'applied', 'failed']);
      expect(await invoiceItemRepository.existsBy({ id: itemId })).toBe(false);

      // A's offline device later sends an edit and a delete for its old item: no record comes back.
      const stale = await push(tokenA, [
        change(ChangeObjectType.INVOICE_ITEM, itemId, ChangeType.UPDATE, { description: 'stale', invoiceId: invoiceA }, uuidv4()),
        change(ChangeObjectType.INVOICE_ITEM, itemId, ChangeType.DELETE, {}, uuidv4()),
      ]);
      expect(stale.body.results.map((r: any) => r.status)).toEqual(['failed', 'applied']);
      expect(stale.body.results[0].reason).toBe('record_deleted');
      expect(await invoiceItemRepository.existsBy({ id: itemId })).toBe(false);

      // Positive control: B's own new item with a fresh id is created.
      const fresh = await push(tokenB, [
        change(ChangeObjectType.INVOICE_ITEM, uuidv4(), ChangeType.CREATE, { invoiceId: invoiceB, description: 'B line' }, uuidv4()),
      ]);
      expect(fresh.body.results[0].status).toBe('applied');
    });
  });

  describe('concurrent updates and timestamps', () => {
    it('concurrent updates of different fields of one record are both kept', async () => {
      // Repeated, because a lost update is a race.
      for (let round = 0; round < 8; round++) {
        const clientId = uuidv4();
        await push(tokenA, [change(ChangeObjectType.CLIENT, clientId, ChangeType.CREATE, { name: 'n0' }, uuidv4())]);
        await Promise.all([
          push(tokenA, [change(ChangeObjectType.CLIENT, clientId, ChangeType.UPDATE, { name: `n${round}` }, uuidv4())]),
          push(tokenA, [change(ChangeObjectType.CLIENT, clientId, ChangeType.UPDATE, { email: `e${round}@example.test` }, uuidv4())]),
          push(tokenA, [change(ChangeObjectType.CLIENT, clientId, ChangeType.UPDATE, { phone: `+100${round}` }, uuidv4())]),
        ]);
        expect(await clientRepository.findOneByOrFail({ id: clientId })).toMatchObject({
          name: `n${round}`,
          email: `e${round}@example.test`,
          phone: `+100${round}`,
        });
      }
    });

    it('concurrent updates of the same field: both are applied in some order and the last applied value remains', async () => {
      const clientId = uuidv4();
      await push(tokenA, [change(ChangeObjectType.CLIENT, clientId, ChangeType.CREATE, { name: 'n0' }, uuidv4())]);
      const [r1, r2] = await Promise.all([
        push(tokenA, [change(ChangeObjectType.CLIENT, clientId, ChangeType.UPDATE, { name: 'left', email: 'left@example.test' }, uuidv4())]),
        push(tokenA, [change(ChangeObjectType.CLIENT, clientId, ChangeType.UPDATE, { name: 'right', email: 'right@example.test' }, uuidv4())]),
      ]);
      expect(r1.body.results[0].status).toBe('applied');
      expect(r2.body.results[0].status).toBe('applied');
      // Whole-change serialization: never name from one and email from the other.
      const row = await clientRepository.findOneByOrFail({ id: clientId });
      expect([
        ['left', 'left@example.test'],
        ['right', 'right@example.test'],
      ]).toContainEqual([row.name, row.email]);
    });

    it('device timestamps are not authority: the change that arrives last wins', async () => {
      const clientId = uuidv4();
      await push(tokenA, [change(ChangeObjectType.CLIENT, clientId, ChangeType.CREATE, { name: 'n0' }, uuidv4())]);
      await push(tokenA, [
        { ...change(ChangeObjectType.CLIENT, clientId, ChangeType.UPDATE, { name: 'future' }, uuidv4()), updated_at: '2099-01-01T00:00:00Z' },
      ]);
      await push(tokenA, [
        { ...change(ChangeObjectType.CLIENT, clientId, ChangeType.UPDATE, { name: 'past' }, uuidv4()), updated_at: '2000-01-01T00:00:00Z' },
      ]);
      const row = await clientRepository.findOneByOrFail({ id: clientId });
      expect(row.name).toBe('past');
      expect(row.updatedAt.getTime()).toBeLessThan(new Date('2099-01-01').getTime());
    });
  });

  describe('old clients without change_id (documented limitation)', () => {
    // Without an idempotency key the server cannot tell a replay from a new
    // change. These pin the documented behaviour; they are why the mobile
    // client should send change_id.
    it('a replayed create no longer re-creates a deleted invoice item (tombstone)', async () => {
      const clientId = uuidv4();
      const invoiceId = uuidv4();
      const itemId = uuidv4();
      const createItem = change(ChangeObjectType.INVOICE_ITEM, itemId, ChangeType.CREATE, {
        invoiceId,
        description: 'Line',
      });
      await push(tokenA, [
        change(ChangeObjectType.CLIENT, clientId, ChangeType.CREATE, { name: 'Acme' }),
        change(ChangeObjectType.INVOICE, invoiceId, ChangeType.CREATE, invoiceData(clientId, 'A-1')),
        createItem,
      ]);
      await push(tokenA, [change(ChangeObjectType.INVOICE_ITEM, itemId, ChangeType.DELETE, {})]);

      const replay = await push(tokenA, [createItem]);
      expect(replay.body.results[0]).toMatchObject({ change_id: null, status: 'failed', reason: 'record_deleted' });
      expect(await invoiceItemRepository.existsBy({ id: itemId })).toBe(false);
    });

    it('a replayed old update overwrites a newer one', async () => {
      const clientId = uuidv4();
      const oldUpdate = change(ChangeObjectType.CLIENT, clientId, ChangeType.UPDATE, { name: 'v1' });
      await push(tokenA, [change(ChangeObjectType.CLIENT, clientId, ChangeType.CREATE, { name: 'v0' })]);
      await push(tokenA, [oldUpdate]);
      await push(tokenA, [change(ChangeObjectType.CLIENT, clientId, ChangeType.UPDATE, { name: 'v2' })]);
      await push(tokenA, [oldUpdate]);
      expect((await clientRepository.findOneByOrFail({ id: clientId })).name).toBe('v1');
      expect(await changeRows(userA.id)).toHaveLength(4);
    });
  });

  describe('request format compatibility', () => {
    it('accepts the current mobile client payload (no change_id) unchanged', async () => {
      const res = await push(tokenA, [change(ChangeObjectType.CLIENT, uuidv4(), ChangeType.CREATE, { name: 'Legacy' })]);
      expect(res.body).toMatchObject({ synced: 1, failed: 0 });
    });

    it('rejects a change_id that is not a UUID with 400 and applies nothing', async () => {
      const clientId = uuidv4();
      await request(app.getHttpServer())
        .post('/api/v1/sync/push')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ deviceId: 'd', changes: [change(ChangeObjectType.CLIENT, clientId, ChangeType.CREATE, { name: 'x' }, 'not-a-uuid')] })
        .expect(400);
      expect(await clientRepository.existsBy({ id: clientId })).toBe(false);
    });
  });
});
