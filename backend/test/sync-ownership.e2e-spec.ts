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
import { Attachment, AttachmentOwnerType } from '../src/entities/attachment.entity';
import { ChangeType, ChangeObjectType } from '../src/entities/device-change.entity';

/**
 * Regression tests for cross-account access through /api/v1/sync.
 *
 * User A ("attacker") and user B ("victim") are synthetic users in the
 * disposable test database. Every denied cross-account operation has a
 * positive control showing the legitimate owner can do the same thing.
 */

// Same pipe as the existing sync E2E suite.
const E2E_PIPE: ValidationPipeOptions = { transform: true, transformOptions: { enableImplicitConversion: true } };

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

async function createApp(pipeOptions: ValidationPipeOptions): Promise<{ app: INestApplication; moduleFixture: TestingModule }> {
  const moduleFixture = await Test.createTestingModule({
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

  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(new ValidationPipe(pipeOptions));
  app.setGlobalPrefix('api');
  await app.init();
  return { app, moduleFixture };
}

describe('Sync ownership enforcement (E2E)', () => {
  let app: INestApplication;
  let prodApp: INestApplication;
  let userRepository: Repository<User>;
  let clientRepository: Repository<Client>;
  let invoiceRepository: Repository<Invoice>;
  let invoiceItemRepository: Repository<InvoiceItem>;
  let attachmentRepository: Repository<Attachment>;
  let jwtService: JwtService;
  let configService: ConfigService;

  let userA: User;
  let userB: User;
  let tokenA: string;
  let tokenB: string;

  // Victim (user B) fixtures, recreated before every test
  let clientB: Client;
  let invoiceB: Invoice;
  let itemB: InvoiceItem;
  let attachmentB: Attachment;
  // Attacker's own fixtures
  let clientA: Client;
  let invoiceA: Invoice;
  let itemA: InvoiceItem;

  beforeAll(async () => {
    const created = await createApp(E2E_PIPE);
    app = created.app;
    prodApp = (await createApp(PRODUCTION_PIPE)).app;

    const m = created.moduleFixture;
    userRepository = m.get(getRepositoryToken(User));
    clientRepository = m.get(getRepositoryToken(Client));
    invoiceRepository = m.get(getRepositoryToken(Invoice));
    invoiceItemRepository = m.get(getRepositoryToken(InvoiceItem));
    attachmentRepository = m.get(getRepositoryToken(Attachment));
    jwtService = m.get(JwtService);
    configService = m.get(ConfigService);
  });

  afterAll(async () => {
    await app.close();
    await prodApp.close();
  });

  const makeInvoice = (userId: string, clientId: string, number: string) =>
    invoiceRepository.save(
      invoiceRepository.create({
        userId,
        clientId,
        type: InvoiceType.INVOICE,
        number,
        issueDate: new Date(),
        dueDate: new Date(),
        currency: 'USD',
        subtotal: 100,
        taxTotal: 0,
        discountTotal: 0,
        total: 100,
        status: InvoiceStatus.DRAFT,
      }),
    );

  beforeEach(async () => {
    const ds = userRepository.manager.connection;
    await ds.query(
      'TRUNCATE TABLE ' + ds.entityMetadatas.map((m) => `"${m.tableName}"`).join(', ') + ' RESTART IDENTITY CASCADE',
    );

    const passwordHash = await bcrypt.hash('password123', 4);
    userA = await userRepository.save(
      userRepository.create({ email: 'attacker@example.test', passwordHash, name: 'User A', companyName: 'A Co' }),
    );
    userB = await userRepository.save(
      userRepository.create({ email: 'victim@example.test', passwordHash, name: 'User B', companyName: 'B Co' }),
    );
    const sign = (u: User) =>
      jwtService.sign({ sub: u.id, email: u.email }, { secret: configService.get('JWT_SECRET'), expiresIn: '15m' });
    tokenA = sign(userA);
    tokenB = sign(userB);

    clientB = await clientRepository.save(
      clientRepository.create({ userId: userB.id, name: 'Victim Client', email: 'victim-client@example.test' }),
    );
    invoiceB = await makeInvoice(userB.id, clientB.id, 'B-0001');
    itemB = await invoiceItemRepository.save(
      invoiceItemRepository.create({ invoiceId: invoiceB.id, description: 'Victim Item', quantity: 1, unitPrice: 100, lineTotal: 100 }),
    );
    attachmentB = await attachmentRepository.save(
      attachmentRepository.create({
        ownerType: AttachmentOwnerType.INVOICE,
        ownerId: invoiceB.id,
        url: 'https://files.example.test/victim.pdf',
        filename: 'victim.pdf',
      }),
    );

    clientA = await clientRepository.save(
      clientRepository.create({ userId: userA.id, name: 'Attacker Client', email: 'attacker-client@example.test' }),
    );
    invoiceA = await makeInvoice(userA.id, clientA.id, 'A-0001');
    itemA = await invoiceItemRepository.save(
      invoiceItemRepository.create({ invoiceId: invoiceA.id, description: 'Attacker Item', quantity: 1, unitPrice: 10, lineTotal: 10 }),
    );
  });

  const change = (objectType: ChangeObjectType, objectId: string, changeType: ChangeType, data: Record<string, any> = {}) => ({
    object_type: objectType,
    object_id: objectId,
    change_type: changeType,
    data,
    device_id: 'device-test',
    updated_at: new Date().toISOString(),
  });

  const push = (token: string, changes: any[], target: INestApplication = app) =>
    request(target.getHttpServer())
      .post('/api/v1/sync/push')
      .set('Authorization', `Bearer ${token}`)
      .send({ deviceId: 'device-test', changes });

  const pull = (token: string) =>
    request(app.getHttpServer()).get('/api/v1/sync/pull').set('Authorization', `Bearer ${token}`).expect(200);

  describe('clients', () => {
    it('rejects updating another user’s client; owner update succeeds', async () => {
      const res = await push(tokenA, [
        change(ChangeObjectType.CLIENT, clientB.id, ChangeType.UPDATE, { name: 'pwned', email: 'attacker@evil.test' }),
      ]).expect(200);
      expect(res.body).toEqual({ synced: 0, failed: 1 });
      const after = await clientRepository.findOneBy({ id: clientB.id });
      expect(after.name).toBe('Victim Client');
      expect(after.email).toBe('victim-client@example.test');
      expect(after.userId).toBe(userB.id);

      const own = await push(tokenB, [change(ChangeObjectType.CLIENT, clientB.id, ChangeType.UPDATE, { name: 'Renamed by owner' })]).expect(200);
      expect(own.body).toEqual({ synced: 1, failed: 0 });
      expect((await clientRepository.findOneBy({ id: clientB.id })).name).toBe('Renamed by owner');
    });

    it('rejects a CREATE that reuses another user’s client id', async () => {
      const res = await push(tokenA, [change(ChangeObjectType.CLIENT, clientB.id, ChangeType.CREATE, { name: 'pwned' })]).expect(200);
      expect(res.body).toEqual({ synced: 0, failed: 1 });
      const after = await clientRepository.findOneBy({ id: clientB.id });
      expect(after.name).toBe('Victim Client');
      expect(after.userId).toBe(userB.id);
    });

    it('rejects soft-deleting another user’s client; owner delete succeeds', async () => {
      const res = await push(tokenA, [change(ChangeObjectType.CLIENT, clientB.id, ChangeType.DELETE)]).expect(200);
      expect(res.body).toEqual({ synced: 0, failed: 1 });
      expect((await clientRepository.findOneBy({ id: clientB.id })).deletedAt).toBeNull();

      const own = await push(tokenB, [change(ChangeObjectType.CLIENT, clientB.id, ChangeType.DELETE)]).expect(200);
      expect(own.body).toEqual({ synced: 1, failed: 0 });
      expect((await clientRepository.findOneBy({ id: clientB.id })).deletedAt).not.toBeNull();
    });

    it('ignores a client-supplied userId on create (owner is always the authenticated user)', async () => {
      const newId = uuidv4();
      const res = await push(tokenA, [
        change(ChangeObjectType.CLIENT, newId, ChangeType.CREATE, { name: 'Planted Client', userId: userB.id }),
      ]).expect(200);
      expect(res.body.failed).toBe(0);
      const created = await clientRepository.findOneBy({ id: newId });
      expect(created.userId).toBe(userA.id);

      const victimPull = await pull(tokenB);
      expect(victimPull.body.clients.map((c: Client) => c.id)).not.toContain(newId);
    });

    it('ignores a client-supplied userId on update (no ownership transfer)', async () => {
      const res = await push(tokenA, [
        change(ChangeObjectType.CLIENT, clientA.id, ChangeType.UPDATE, { name: 'Still mine', userId: userB.id }),
      ]).expect(200);
      expect(res.body).toEqual({ synced: 1, failed: 0 });
      const after = await clientRepository.findOneBy({ id: clientA.id });
      expect(after.name).toBe('Still mine');
      expect(after.userId).toBe(userA.id);
    });
  });

  describe('invoices', () => {
    it('rejects updating another user’s invoice; owner update succeeds', async () => {
      const res = await push(tokenA, [
        change(ChangeObjectType.INVOICE, invoiceB.id, ChangeType.UPDATE, { total: 1, status: InvoiceStatus.PAID }),
      ]).expect(200);
      expect(res.body).toEqual({ synced: 0, failed: 1 });
      const after = await invoiceRepository.findOneBy({ id: invoiceB.id });
      expect(Number(after.total)).toBe(100);
      expect(after.status).toBe(InvoiceStatus.DRAFT);

      const own = await push(tokenB, [change(ChangeObjectType.INVOICE, invoiceB.id, ChangeType.UPDATE, { notes: 'owner note' })]).expect(200);
      expect(own.body).toEqual({ synced: 1, failed: 0 });
      expect((await invoiceRepository.findOneBy({ id: invoiceB.id })).notes).toBe('owner note');
    });

    it('rejects soft-deleting another user’s invoice; owner delete succeeds', async () => {
      const res = await push(tokenA, [change(ChangeObjectType.INVOICE, invoiceB.id, ChangeType.DELETE)]).expect(200);
      expect(res.body).toEqual({ synced: 0, failed: 1 });
      expect((await invoiceRepository.findOneBy({ id: invoiceB.id })).deletedAt).toBeNull();

      const own = await push(tokenB, [change(ChangeObjectType.INVOICE, invoiceB.id, ChangeType.DELETE)]).expect(200);
      expect(own.body).toEqual({ synced: 1, failed: 0 });
      expect((await invoiceRepository.findOneBy({ id: invoiceB.id })).deletedAt).not.toBeNull();
    });

    it('rejects creating an invoice that references another user’s client, and pull does not leak it', async () => {
      const invoiceId = uuidv4();
      const res = await push(tokenA, [
        change(ChangeObjectType.INVOICE, invoiceId, ChangeType.CREATE, {
          clientId: clientB.id,
          number: 'A-EVIL',
          issueDate: '2026-10-01',
          total: 1,
        }),
      ]).expect(200);
      expect(res.body).toEqual({ synced: 0, failed: 1 });
      expect(await invoiceRepository.findOneBy({ id: invoiceId })).toBeNull();

      const attackerPull = await pull(tokenA);
      expect(JSON.stringify(attackerPull.body)).not.toContain(clientB.id);
      expect(JSON.stringify(attackerPull.body)).not.toContain('victim-client@example.test');

      // Positive control: the same create with the attacker's own client works
      const ownId = uuidv4();
      const own = await push(tokenA, [
        change(ChangeObjectType.INVOICE, ownId, ChangeType.CREATE, {
          clientId: clientA.id,
          number: 'A-0002',
          issueDate: '2026-10-01',
          total: 1,
        }),
      ]).expect(200);
      expect(own.body).toEqual({ synced: 1, failed: 0 });
      const created = await invoiceRepository.findOneBy({ id: ownId });
      expect(created.userId).toBe(userA.id);
      expect(created.clientId).toBe(clientA.id);
    });

    it('rejects re-pointing an own invoice at another user’s client', async () => {
      const res = await push(tokenA, [
        change(ChangeObjectType.INVOICE, invoiceA.id, ChangeType.UPDATE, { clientId: clientB.id }),
      ]).expect(200);
      expect(res.body).toEqual({ synced: 0, failed: 1 });
      expect((await invoiceRepository.findOneBy({ id: invoiceA.id })).clientId).toBe(clientA.id);

      // Positive control: re-pointing at another client of the same user works
      const otherA = await clientRepository.save(clientRepository.create({ userId: userA.id, name: 'Second Attacker Client' }));
      const own = await push(tokenA, [
        change(ChangeObjectType.INVOICE, invoiceA.id, ChangeType.UPDATE, { clientId: otherA.id }),
      ]).expect(200);
      expect(own.body).toEqual({ synced: 1, failed: 0 });
      expect((await invoiceRepository.findOneBy({ id: invoiceA.id })).clientId).toBe(otherA.id);
    });

    it('rejects an invoice update that sets userId to another user', async () => {
      const res = await push(tokenA, [
        change(ChangeObjectType.INVOICE, invoiceA.id, ChangeType.UPDATE, { notes: 'x', userId: userB.id }),
      ]).expect(200);
      expect(res.body.failed).toBe(0);
      expect((await invoiceRepository.findOneBy({ id: invoiceA.id })).userId).toBe(userA.id);
      const victimPull = await pull(tokenB);
      expect(victimPull.body.invoices.map((i: Invoice) => i.id)).not.toContain(invoiceA.id);
    });
  });

  describe('invoice items', () => {
    it('rejects adding an item to another user’s invoice; owner add succeeds', async () => {
      const itemId = uuidv4();
      const res = await push(tokenA, [
        change(ChangeObjectType.INVOICE_ITEM, itemId, ChangeType.CREATE, {
          invoiceId: invoiceB.id,
          description: 'Injected line',
          quantity: 1,
          unitPrice: 999,
          lineTotal: 999,
        }),
      ]).expect(200);
      expect(res.body).toEqual({ synced: 0, failed: 1 });
      expect(await invoiceItemRepository.findOneBy({ id: itemId })).toBeNull();
      const victimPull = await pull(tokenB);
      expect(victimPull.body.invoiceItems.map((i: InvoiceItem) => i.id)).not.toContain(itemId);

      const ownId = uuidv4();
      const own = await push(tokenB, [
        change(ChangeObjectType.INVOICE_ITEM, ownId, ChangeType.CREATE, {
          invoiceId: invoiceB.id,
          description: 'Owner line',
          quantity: 1,
          unitPrice: 5,
          lineTotal: 5,
        }),
      ]).expect(200);
      expect(own.body).toEqual({ synced: 1, failed: 0 });
      expect((await invoiceItemRepository.findOneBy({ id: ownId })).invoiceId).toBe(invoiceB.id);
    });

    it('rejects updating another user’s item; owner update succeeds', async () => {
      const res = await push(tokenA, [
        change(ChangeObjectType.INVOICE_ITEM, itemB.id, ChangeType.UPDATE, { description: 'pwned', unitPrice: 0 }),
      ]).expect(200);
      expect(res.body).toEqual({ synced: 0, failed: 1 });
      expect((await invoiceItemRepository.findOneBy({ id: itemB.id })).description).toBe('Victim Item');

      const own = await push(tokenB, [
        change(ChangeObjectType.INVOICE_ITEM, itemB.id, ChangeType.UPDATE, { description: 'Owner edit' }),
      ]).expect(200);
      expect(own.body).toEqual({ synced: 1, failed: 0 });
      expect((await invoiceItemRepository.findOneBy({ id: itemB.id })).description).toBe('Owner edit');
    });

    it('rejects moving an item onto, or stealing it into, another user’s invoice', async () => {
      const moveOut = await push(tokenA, [
        change(ChangeObjectType.INVOICE_ITEM, itemA.id, ChangeType.UPDATE, { invoiceId: invoiceB.id }),
      ]).expect(200);
      expect(moveOut.body).toEqual({ synced: 0, failed: 1 });
      expect((await invoiceItemRepository.findOneBy({ id: itemA.id })).invoiceId).toBe(invoiceA.id);

      const steal = await push(tokenA, [
        change(ChangeObjectType.INVOICE_ITEM, itemB.id, ChangeType.UPDATE, { invoiceId: invoiceA.id }),
      ]).expect(200);
      expect(steal.body).toEqual({ synced: 0, failed: 1 });
      expect((await invoiceItemRepository.findOneBy({ id: itemB.id })).invoiceId).toBe(invoiceB.id);
    });

    it('rejects deleting another user’s item; owner delete succeeds and is idempotent', async () => {
      const res = await push(tokenA, [change(ChangeObjectType.INVOICE_ITEM, itemB.id, ChangeType.DELETE)]).expect(200);
      expect(res.body).toEqual({ synced: 0, failed: 1 });
      expect(await invoiceItemRepository.findOneBy({ id: itemB.id })).not.toBeNull();

      const own = await push(tokenB, [change(ChangeObjectType.INVOICE_ITEM, itemB.id, ChangeType.DELETE)]).expect(200);
      expect(own.body).toEqual({ synced: 1, failed: 0 });
      expect(await invoiceItemRepository.findOneBy({ id: itemB.id })).toBeNull();

      // Retrying the same delete (e.g. after a lost response) stays a no-op success
      const retry = await push(tokenB, [change(ChangeObjectType.INVOICE_ITEM, itemB.id, ChangeType.DELETE)]).expect(200);
      expect(retry.body).toEqual({ synced: 1, failed: 0 });
    });
  });

  describe('attachments', () => {
    it('rejects attaching a file to another user’s invoice; owner attach succeeds', async () => {
      const attId = uuidv4();
      const data = { ownerType: 'invoice', ownerId: invoiceB.id, url: 'https://evil.example.test/x.pdf', filename: 'x.pdf' };
      const res = await push(tokenA, [change(ChangeObjectType.ATTACHMENT, attId, ChangeType.CREATE, data)]).expect(200);
      expect(res.body).toEqual({ synced: 0, failed: 1 });
      expect(await attachmentRepository.findOneBy({ id: attId })).toBeNull();
      const victimPull = await pull(tokenB);
      expect(victimPull.body.attachments.map((a: Attachment) => a.id)).not.toContain(attId);

      const ownId = uuidv4();
      const own = await push(tokenB, [
        change(ChangeObjectType.ATTACHMENT, ownId, ChangeType.CREATE, { ...data, url: 'https://files.example.test/own.pdf' }),
      ]).expect(200);
      expect(own.body).toEqual({ synced: 1, failed: 0 });
    });

    it('rejects updating or deleting another user’s attachment; owner delete succeeds', async () => {
      const upd = await push(tokenA, [
        change(ChangeObjectType.ATTACHMENT, attachmentB.id, ChangeType.UPDATE, { url: 'https://evil.example.test/swap.pdf' }),
      ]).expect(200);
      expect(upd.body).toEqual({ synced: 0, failed: 1 });
      expect((await attachmentRepository.findOneBy({ id: attachmentB.id })).url).toBe('https://files.example.test/victim.pdf');

      const del = await push(tokenA, [change(ChangeObjectType.ATTACHMENT, attachmentB.id, ChangeType.DELETE)]).expect(200);
      expect(del.body).toEqual({ synced: 0, failed: 1 });
      expect(await attachmentRepository.findOneBy({ id: attachmentB.id })).not.toBeNull();

      const own = await push(tokenB, [change(ChangeObjectType.ATTACHMENT, attachmentB.id, ChangeType.DELETE)]).expect(200);
      expect(own.body).toEqual({ synced: 1, failed: 0 });
      expect(await attachmentRepository.findOneBy({ id: attachmentB.id })).toBeNull();
    });

    it('rejects re-pointing an own attachment at another user’s client', async () => {
      const attA = await attachmentRepository.save(
        attachmentRepository.create({ ownerType: AttachmentOwnerType.CLIENT, ownerId: clientA.id, url: 'https://files.example.test/a.pdf', filename: 'a.pdf' }),
      );
      const res = await push(tokenA, [
        change(ChangeObjectType.ATTACHMENT, attA.id, ChangeType.UPDATE, { ownerId: clientB.id }),
      ]).expect(200);
      expect(res.body).toEqual({ synced: 0, failed: 1 });
      expect((await attachmentRepository.findOneBy({ id: attA.id })).ownerId).toBe(clientA.id);
    });
  });

  describe('batches', () => {
    it('applies the authorized changes in a batch and none of the unauthorized ones', async () => {
      const newClientId = uuidv4();
      const newItemId = uuidv4();
      const res = await push(tokenA, [
        change(ChangeObjectType.CLIENT, newClientId, ChangeType.CREATE, { name: 'Legit New Client' }),
        change(ChangeObjectType.CLIENT, clientB.id, ChangeType.UPDATE, { name: 'pwned' }),
        change(ChangeObjectType.INVOICE_ITEM, newItemId, ChangeType.CREATE, {
          invoiceId: invoiceA.id,
          description: 'Legit line',
          quantity: 1,
          unitPrice: 1,
          lineTotal: 1,
        }),
        change(ChangeObjectType.INVOICE, invoiceB.id, ChangeType.DELETE),
      ]).expect(200);
      expect(res.body).toEqual({ synced: 2, failed: 2 });

      expect((await clientRepository.findOneBy({ id: newClientId })).userId).toBe(userA.id);
      expect(await invoiceItemRepository.findOneBy({ id: newItemId })).not.toBeNull();
      expect((await clientRepository.findOneBy({ id: clientB.id })).name).toBe('Victim Client');
      expect((await invoiceRepository.findOneBy({ id: invoiceB.id })).deletedAt).toBeNull();
    });
  });

  describe('reused ids and relation objects', () => {
    it('rejects a CREATE that reuses another user’s invoice id', async () => {
      const res = await push(tokenA, [
        change(ChangeObjectType.INVOICE, invoiceB.id, ChangeType.CREATE, {
          clientId: clientA.id,
          number: 'A-EVIL',
          issueDate: '2026-10-01',
          total: 1,
        }),
      ]).expect(200);
      expect(res.body).toEqual({ synced: 0, failed: 1 });
      const after = await invoiceRepository.findOneBy({ id: invoiceB.id });
      expect(after.userId).toBe(userB.id);
      expect(after.clientId).toBe(clientB.id);
      expect(after.number).toBe('B-0001');
      expect(Number(after.total)).toBe(100);
    });

    it('rejects a CREATE that reuses another user’s invoice item id', async () => {
      const res = await push(tokenA, [
        change(ChangeObjectType.INVOICE_ITEM, itemB.id, ChangeType.CREATE, {
          invoiceId: invoiceA.id,
          description: 'pwned',
          quantity: 1,
          unitPrice: 0,
          lineTotal: 0,
        }),
      ]).expect(200);
      expect(res.body).toEqual({ synced: 0, failed: 1 });
      const after = await invoiceItemRepository.findOneBy({ id: itemB.id });
      expect(after.invoiceId).toBe(invoiceB.id);
      expect(after.description).toBe('Victim Item');
    });

    it('ignores relation objects that would re-point foreign keys', async () => {
      const res = await push(tokenA, [
        change(ChangeObjectType.INVOICE, invoiceA.id, ChangeType.UPDATE, { notes: 'via relation', client: { id: clientB.id } }),
        change(ChangeObjectType.INVOICE_ITEM, itemA.id, ChangeType.UPDATE, { description: 'via relation', invoice: { id: invoiceB.id } }),
        change(ChangeObjectType.CLIENT, clientA.id, ChangeType.UPDATE, { name: 'via relation', user: { id: userB.id } }),
      ]).expect(200);
      expect(res.body.synced + res.body.failed).toBe(3);

      const invoice = await invoiceRepository.findOneBy({ id: invoiceA.id });
      expect(invoice.clientId).toBe(clientA.id);
      const item = await invoiceItemRepository.findOneBy({ id: itemA.id });
      expect(item.invoiceId).toBe(invoiceA.id);
      const client = await clientRepository.findOneBy({ id: clientA.id });
      expect(client.userId).toBe(userA.id);

      // Positive control: the plain column changes in the same changes were applied
      expect(res.body).toEqual({ synced: 3, failed: 0 });
      expect(invoice.notes).toBe('via relation');
      expect(item.description).toBe('via relation');
      expect(client.name).toBe('via relation');
    });
  });

  describe('pull', () => {
    it('returns only the authenticated user’s records across all collections', async () => {
      const res = await pull(tokenA);
      const body = JSON.stringify(res.body);
      for (const foreignId of [userB.id, clientB.id, invoiceB.id, itemB.id, attachmentB.id]) {
        expect(body).not.toContain(foreignId);
      }
      expect(res.body.clients.map((c: Client) => c.id)).toContain(clientA.id);
      expect(res.body.invoices.map((i: Invoice) => i.id)).toContain(invoiceA.id);
      expect(res.body.invoiceItems.map((i: InvoiceItem) => i.id)).toContain(itemA.id);
    });
  });

  describe('with the production validation pipe (src/main.ts options)', () => {
    it('accepts a well-formed push from the mobile client', async () => {
      const newId = uuidv4();
      const res = await push(tokenA, [change(ChangeObjectType.CLIENT, newId, ChangeType.CREATE, { name: 'Via prod pipe' })], prodApp).expect(200);
      expect(res.body).toEqual({ synced: 1, failed: 0 });
      expect((await clientRepository.findOneBy({ id: newId })).userId).toBe(userA.id);
    });

    it('still enforces ownership', async () => {
      const res = await push(tokenA, [change(ChangeObjectType.CLIENT, clientB.id, ChangeType.UPDATE, { name: 'pwned' })], prodApp).expect(200);
      expect(res.body).toEqual({ synced: 0, failed: 1 });
      expect((await clientRepository.findOneBy({ id: clientB.id })).name).toBe('Victim Client');
    });

    it('rejects a malformed change list with 400', async () => {
      await request(prodApp.getHttpServer())
        .post('/api/v1/sync/push')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ deviceId: 'device-test', changes: [{ object_type: 'not-a-type', object_id: uuidv4(), change_type: 'create', data: {} }] })
        .expect(400);
    });
  });
});
