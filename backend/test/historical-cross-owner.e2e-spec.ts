import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, ValidationPipeOptions } from '@nestjs/common';
import * as request from 'supertest';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { User } from '../src/entities/user.entity';
import { Client } from '../src/entities/client.entity';
import { Invoice, InvoiceType, InvoiceStatus } from '../src/entities/invoice.entity';
import { InvoiceItem } from '../src/entities/invoice-item.entity';
import { Attachment, AttachmentOwnerType } from '../src/entities/attachment.entity';
import { Payment, PaymentStatus } from '../src/entities/payment.entity';
import { InvoiceTemplate } from '../src/entities/invoice-template.entity';
import { DeviceChange, ChangeType, ChangeObjectType } from '../src/entities/device-change.entity';
import { PdfService } from '../src/core/services/pdf.service';
import { S3Service } from '../src/core/services/s3.service';
import { EmailService } from '../src/core/services/email.service';
import { NotificationService } from '../src/core/services/notification.service';
import { InvoiceStatusService } from '../src/invoices/invoice-status.service';
import { PaymentsService } from '../src/payments/payments.service';

/**
 * Historical cross-owner rows (written before ownership was enforced on sync
 * push) must not disclose another user's data through any read path, and no
 * write path may create new ones.
 *
 * User A and user B are synthetic users in the disposable test database. The
 * malformed rows are inserted directly, the way the old push could have left
 * them. Each denial has a positive control for the legitimate owner.
 */

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

// Strings that only exist in user B's client record
const VICTIM_MARKERS = ['Victim Client', 'victim-client@example.test', '+1-555-0100', 'victim secret note'];

const mockPdfService = { generateInvoicePdf: jest.fn() };
const mockS3Service = { isAvailable: jest.fn(), uploadFile: jest.fn() };
const mockEmailService = { sendInvoiceEmail: jest.fn(), sendEmail: jest.fn(), sendPasswordResetEmail: jest.fn() };
const mockNotificationService = {
  notifyInvoiceOverdue: jest.fn(),
  notifyPaymentReceived: jest.fn(),
  notifyInvoiceSent: jest.fn(),
  notifyInvoicePaid: jest.fn(),
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
    .overrideProvider(PdfService)
    .useValue(mockPdfService)
    .overrideProvider(S3Service)
    .useValue(mockS3Service)
    .overrideProvider(EmailService)
    .useValue(mockEmailService)
    .overrideProvider(NotificationService)
    .useValue(mockNotificationService)
    .compile();

  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(new ValidationPipe(pipeOptions));
  app.setGlobalPrefix('api');
  await app.init();
  return { app, moduleFixture };
}

describe('Historical cross-owner rows (E2E)', () => {
  let app: INestApplication;
  let prodApp: INestApplication;
  let userRepository: Repository<User>;
  let clientRepository: Repository<Client>;
  let invoiceRepository: Repository<Invoice>;
  let invoiceItemRepository: Repository<InvoiceItem>;
  let attachmentRepository: Repository<Attachment>;
  let paymentRepository: Repository<Payment>;
  let templateRepository: Repository<InvoiceTemplate>;
  let deviceChangeRepository: Repository<DeviceChange>;

  let userA: User;
  let userB: User;
  let tokenA: string;
  let tokenB: string;

  let clientA: Client;
  let clientB: Client;
  let invoiceA: Invoice; // A -> A's client (legitimate)
  let invoiceBad: Invoice; // A -> B's client (malformed, seeded directly)
  let invoiceB: Invoice; // B -> B's client (legitimate)
  let itemB: InvoiceItem;
  let itemInjected: InvoiceItem; // in B's invoice, created by A through the old sync push
  let attachmentB: Attachment;
  let attachmentInjected: Attachment; // on B's invoice, created by A through sync
  let attachmentMoved: Attachment; // created by B through sync, then re-pointed by A at A's invoice
  let templateA: InvoiceTemplate;
  let templateB: InvoiceTemplate;

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
    paymentRepository = m.get(getRepositoryToken(Payment));
    templateRepository = m.get(getRepositoryToken(InvoiceTemplate));
    deviceChangeRepository = m.get(getRepositoryToken(DeviceChange));
  });

  afterAll(async () => {
    await app.close();
    await prodApp.close();
  });

  const makeInvoice = (userId: string, clientId: string, number: string, extra: Partial<Invoice> = {}) =>
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
        ...extra,
      }),
    );

  const makeItem = (invoiceId: string, description: string) =>
    invoiceItemRepository.save(
      invoiceItemRepository.create({ invoiceId, description, quantity: 1, unitPrice: 100, lineTotal: 100 }),
    );

  const makeAttachment = (ownerId: string, filename: string) =>
    attachmentRepository.save(
      attachmentRepository.create({
        ownerType: AttachmentOwnerType.INVOICE,
        ownerId,
        url: `https://files.example.test/${filename}`,
        filename,
      }),
    );

  const logChange = (
    userId: string,
    objectType: ChangeObjectType,
    objectId: string,
    changeType: ChangeType,
    changeJson: Record<string, any>,
    synced = true,
  ) =>
    deviceChangeRepository.save(
      deviceChangeRepository.create({ userId, deviceId: 'legacy-device', objectType, objectId, changeType, changeJson, synced }),
    );

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPdfService.generateInvoicePdf.mockResolvedValue(Buffer.from('%PDF-fake'));
    mockS3Service.isAvailable.mockReturnValue(false);
    mockS3Service.uploadFile.mockResolvedValue('https://s3.example.test/fake.pdf');
    mockEmailService.sendInvoiceEmail.mockResolvedValue(undefined);

    const ds = userRepository.manager.connection;
    await ds.query(
      'TRUNCATE TABLE ' + ds.entityMetadatas.map((md) => `"${md.tableName}"`).join(', ') + ' RESTART IDENTITY CASCADE',
    );

    const passwordHash = await bcrypt.hash('password123', 4);
    userA = await userRepository.save(
      userRepository.create({ email: 'user-a@example.test', passwordHash, name: 'User A', companyName: 'A Co' }),
    );
    userB = await userRepository.save(
      userRepository.create({ email: 'user-b@example.test', passwordHash, name: 'User B', companyName: 'B Co' }),
    );
    const jwtService = app.get(JwtService);
    const secret = app.get(ConfigService).get('JWT_SECRET');
    tokenA = jwtService.sign({ sub: userA.id, email: userA.email }, { secret, expiresIn: '15m' });
    tokenB = jwtService.sign({ sub: userB.id, email: userB.email }, { secret, expiresIn: '15m' });

    clientA = await clientRepository.save(
      clientRepository.create({ userId: userA.id, name: 'Own Client A', email: 'own-client-a@example.test' }),
    );
    clientB = await clientRepository.save(
      clientRepository.create({
        userId: userB.id,
        name: 'Victim Client',
        email: 'victim-client@example.test',
        phone: '+1-555-0100',
        notes: 'victim secret note',
      }),
    );

    invoiceA = await makeInvoice(userA.id, clientA.id, 'A-0001');
    await makeItem(invoiceA.id, 'A own line');
    invoiceBad = await makeInvoice(userA.id, clientB.id, 'A-0002');
    await makeItem(invoiceBad.id, 'A line on bad invoice');

    invoiceB = await makeInvoice(userB.id, clientB.id, 'B-0001');
    itemB = await makeItem(invoiceB.id, 'B own line');
    itemInjected = await makeItem(invoiceB.id, 'INJECTED BY A');
    await logChange(userA.id, ChangeObjectType.INVOICE_ITEM, itemInjected.id, ChangeType.CREATE, {
      invoiceId: invoiceB.id,
      description: 'INJECTED BY A',
    });

    attachmentB = await makeAttachment(invoiceB.id, 'b-own.pdf');
    attachmentInjected = await makeAttachment(invoiceB.id, 'injected-by-a.pdf');
    await logChange(userA.id, ChangeObjectType.ATTACHMENT, attachmentInjected.id, ChangeType.CREATE, {
      ownerType: 'invoice',
      ownerId: invoiceB.id,
    });
    attachmentMoved = await makeAttachment(invoiceA.id, 'b-moved-secret.pdf');
    await logChange(userB.id, ChangeObjectType.ATTACHMENT, attachmentMoved.id, ChangeType.CREATE, {
      ownerType: 'invoice',
      ownerId: invoiceB.id,
    });
    await logChange(userA.id, ChangeObjectType.ATTACHMENT, attachmentMoved.id, ChangeType.UPDATE, { ownerId: invoiceA.id });

    templateA = await templateRepository.save(
      templateRepository.create({ userId: userA.id, name: 'Template A', type: 'invoice', currency: 'USD', defaultDueDays: 30, lineItemsJson: [] }),
    );
    templateB = await templateRepository.save(
      templateRepository.create({ userId: userB.id, name: 'Template B', type: 'invoice', currency: 'USD', defaultDueDays: 30, lineItemsJson: [] }),
    );
  });

  const api = (target: INestApplication = app) => request(target.getHttpServer());
  const expectNoVictimData = (payload: unknown) => {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    for (const marker of VICTIM_MARKERS) {
      expect(text).not.toContain(marker);
    }
  };

  describe('A. no new cross-owner relationships', () => {
    it('rejects creating an invoice for another user’s client; own client succeeds', async () => {
      const body = (clientId: string) => ({
        clientId,
        issueDate: '2026-10-01',
        items: [{ description: 'x', quantity: 1, unitPrice: 1 }],
      });
      await api(prodApp).post('/api/v1/invoices').set('Authorization', `Bearer ${tokenA}`).send(body(clientB.id)).expect(404);
      expect(await invoiceRepository.count({ where: { clientId: clientB.id, userId: userA.id } })).toBe(1); // only the seeded row

      const own = await api(prodApp).post('/api/v1/invoices').set('Authorization', `Bearer ${tokenA}`).send(body(clientA.id)).expect(201);
      expect(own.body.clientId).toBe(clientA.id);
    });

    it('rejects re-pointing an invoice at another user’s client; owner can re-point the malformed invoice to their own client', async () => {
      await api(prodApp)
        .patch(`/api/v1/invoices/${invoiceA.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ clientId: clientB.id })
        .expect(404);
      expect((await invoiceRepository.findOneBy({ id: invoiceA.id })).clientId).toBe(clientA.id);

      const fixed = await api(prodApp)
        .patch(`/api/v1/invoices/${invoiceBad.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ clientId: clientA.id })
        .expect(200);
      expect(fixed.body.client.id).toBe(clientA.id);
      expect((await invoiceRepository.findOneBy({ id: invoiceBad.id })).clientId).toBe(clientA.id);
    });

    it('rejects a CSV import that references another user’s client; own client imports', async () => {
      const csv = (clientId: string) => Buffer.from(`clientId,issueDate,items\n${clientId},2026-10-01,Line|1|5\n`);
      const res = await api()
        .post('/api/v1/invoices/import/csv')
        .set('Authorization', `Bearer ${tokenA}`)
        .attach('file', csv(clientB.id), 'invoices.csv')
        .expect(201);
      expect(res.body.imported).toBe(0);
      expect(await invoiceRepository.count({ where: { clientId: clientB.id, userId: userA.id } })).toBe(1);

      const own = await api()
        .post('/api/v1/invoices/import/csv')
        .set('Authorization', `Bearer ${tokenA}`)
        .attach('file', csv(clientA.id), 'invoices.csv')
        .expect(201);
      expect(own.body.imported).toBe(1);
    });

    it.each(['duplicate', 'convert'])(
      'refuses to %s an invoice whose client belongs to another user; own invoice works',
      async (action) => {
        if (action === 'convert') {
          await invoiceRepository.update({ id: invoiceBad.id }, { type: InvoiceType.ESTIMATE });
          await invoiceRepository.update({ id: invoiceA.id }, { type: InvoiceType.ESTIMATE });
        }
        const res = await api().post(`/api/v1/invoices/${invoiceBad.id}/${action}`).set('Authorization', `Bearer ${tokenA}`);
        expect(res.status).toBe(400);
        expectNoVictimData(res.body);
        // still only the seeded malformed row points A at B's client
        expect(await invoiceRepository.count({ where: { clientId: clientB.id, userId: userA.id } })).toBe(1);

        const own = await api().post(`/api/v1/invoices/${invoiceA.id}/${action}`).set('Authorization', `Bearer ${tokenA}`).expect(201);
        expect(own.body.clientId).toBe(clientA.id);
      },
    );

    it('a template update cannot change its owner or target another user’s template id (production pipe)', async () => {
      await api(prodApp)
        .patch(`/api/v1/invoice-templates/${templateA.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ userId: userB.id, name: 'Planted' })
        .expect((r) => expect([200, 400]).toContain(r.status));
      const a = await templateRepository.findOneBy({ id: templateA.id });
      expect(a.userId).toBe(userA.id);

      await api(prodApp)
        .patch(`/api/v1/invoice-templates/${templateA.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ id: templateB.id, name: 'Overwritten' })
        .expect((r) => expect([200, 400]).toContain(r.status));
      const b = await templateRepository.findOneBy({ id: templateB.id });
      expect(b.userId).toBe(userB.id);
      expect(b.name).toBe('Template B');

      const own = await api(prodApp)
        .patch(`/api/v1/invoice-templates/${templateA.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Renamed by owner' })
        .expect(200);
      expect(own.body.name).toBe('Renamed by owner');
      expect((await templateRepository.findOneBy({ id: templateA.id })).userId).toBe(userA.id);
    });

    it('a client update cannot change its owner or target another user’s client id (without the main.ts pipe)', async () => {
      await api()
        .patch(`/api/v1/clients/${clientA.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ id: clientB.id, userId: userA.id, name: 'Overwritten' });
      const b = await clientRepository.findOneBy({ id: clientB.id });
      expect(b.userId).toBe(userB.id);
      expect(b.name).toBe('Victim Client');

      await api()
        .patch(`/api/v1/clients/${clientA.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ userId: userB.id });
      expect((await clientRepository.findOneBy({ id: clientA.id })).userId).toBe(userA.id);

      const own = await api().patch(`/api/v1/clients/${clientA.id}`).set('Authorization', `Bearer ${tokenA}`).send({ name: 'Renamed A' }).expect(200);
      expect(own.body.name).toBe('Renamed A');
    });
  });

  describe('B. existing cross-owner rows do not disclose data', () => {
    it('invoice list omits another user’s client; own invoice still embeds its client', async () => {
      const res = await api().get('/api/v1/invoices').set('Authorization', `Bearer ${tokenA}`).expect(200);
      expectNoVictimData(res.body);
      const bad = res.body.data.find((i: Invoice) => i.id === invoiceBad.id);
      expect(bad).toBeDefined();
      expect(bad.client).toBeNull();
      const own = res.body.data.find((i: Invoice) => i.id === invoiceA.id);
      expect(own.client.name).toBe('Own Client A');
    });

    it('invoice search cannot match on another user’s client fields; own client search matches', async () => {
      for (const term of ['Victim Client', 'victim-client@example']) {
        const res = await api().get('/api/v1/invoices').query({ search: term }).set('Authorization', `Bearer ${tokenA}`).expect(200);
        expect(res.body.data).toHaveLength(0);
      }
      const own = await api().get('/api/v1/invoices').query({ search: 'Own Client A' }).set('Authorization', `Bearer ${tokenA}`).expect(200);
      expect(own.body.data.map((i: Invoice) => i.id)).toEqual([invoiceA.id]);
    });

    it('invoice detail omits another user’s client; own detail embeds its client', async () => {
      const res = await api().get(`/api/v1/invoices/${invoiceBad.id}`).set('Authorization', `Bearer ${tokenA}`).expect(200);
      expectNoVictimData(res.body);
      expect(res.body.client).toBeNull();
      expect(res.body.items.map((i: InvoiceItem) => i.description)).toEqual(['A line on bad invoice']);

      const own = await api().get(`/api/v1/invoices/${invoiceA.id}`).set('Authorization', `Bearer ${tokenA}`).expect(200);
      expect(own.body.client.email).toBe('own-client-a@example.test');
    });

    it('PDF generation refuses an invoice whose client is not the owner’s and never renders it; own PDF renders', async () => {
      const res = await api().post(`/api/v1/invoices/${invoiceBad.id}/pdf`).set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(400);
      expectNoVictimData(res.body);
      for (const call of mockPdfService.generateInvoicePdf.mock.calls) {
        expectNoVictimData(call[0]);
      }

      await api().post(`/api/v1/invoices/${invoiceA.id}/pdf`).set('Authorization', `Bearer ${tokenA}`).expect(201);
      const rendered = mockPdfService.generateInvoicePdf.mock.calls.at(-1)[0];
      expect(rendered.client.name).toBe('Own Client A');
    });

    it('sending refuses an invoice whose client is not the owner’s: no email to that client; own send works', async () => {
      const res = await api().post(`/api/v1/invoices/${invoiceBad.id}/send`).set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(400);
      expectNoVictimData(res.body);
      expect(mockEmailService.sendInvoiceEmail).not.toHaveBeenCalled();
      for (const call of [...mockPdfService.generateInvoicePdf.mock.calls, ...mockNotificationService.notifyInvoiceSent.mock.calls]) {
        expectNoVictimData(call[0]);
      }

      await api().post(`/api/v1/invoices/${invoiceA.id}/send`).set('Authorization', `Bearer ${tokenA}`).expect(201);
      expect(mockEmailService.sendInvoiceEmail).toHaveBeenCalledTimes(1);
      expect(mockEmailService.sendInvoiceEmail.mock.calls[0][0]).toBe('own-client-a@example.test');
    });

    it('CSV export omits another user’s client; own client is exported', async () => {
      const res = await api().get('/api/v1/invoices/export/csv').set('Authorization', `Bearer ${tokenA}`).expect(200);
      expectNoVictimData(res.text);
      expect(res.text).toContain('A-0002');
      expect(res.text).toContain('own-client-a@example.test');
    });

    it('GDPR export contains no other user’s client and no line items another user injected; own data is exported', async () => {
      const a = await api().get('/api/v1/gdpr/export').set('Authorization', `Bearer ${tokenA}`).expect(200);
      expectNoVictimData(a.body);
      expect(a.body.invoices.map((i: any) => i.number).sort()).toEqual(['A-0001', 'A-0002']);
      expect(a.body.clients.map((c: any) => c.name)).toEqual(['Own Client A']);

      const b = await api().get('/api/v1/gdpr/export').set('Authorization', `Bearer ${tokenB}`).expect(200);
      const bItems = b.body.invoices.flatMap((i: any) => i.items.map((it: any) => it.description));
      expect(bItems).toEqual(['B own line']);
    });

    it('invoice detail and PDF of the victim’s invoice omit line items another user injected', async () => {
      const res = await api().get(`/api/v1/invoices/${invoiceB.id}`).set('Authorization', `Bearer ${tokenB}`).expect(200);
      expect(res.body.items.map((i: InvoiceItem) => i.id)).toEqual([itemB.id]);
      expect(res.body.client.name).toBe('Victim Client'); // B's own client stays visible to B

      await api().post(`/api/v1/invoices/${invoiceB.id}/pdf`).set('Authorization', `Bearer ${tokenB}`).expect(201);
      const rendered = mockPdfService.generateInvoicePdf.mock.calls.at(-1)[0];
      expect(rendered.items.map((i: InvoiceItem) => i.description)).toEqual(['B own line']);
    });

    it('a rejected (unsynced) foreign change does not hide the owner’s item', async () => {
      // Push still records rejected attempts (synced = false); they must not let A hide B's data.
      await logChange(userA.id, ChangeObjectType.INVOICE_ITEM, itemB.id, ChangeType.UPDATE, { description: 'pwned' }, false);
      await logChange(userA.id, ChangeObjectType.ATTACHMENT, attachmentB.id, ChangeType.DELETE, {}, false);
      const res = await api().get(`/api/v1/invoices/${invoiceB.id}`).set('Authorization', `Bearer ${tokenB}`).expect(200);
      expect(res.body.items.map((i: InvoiceItem) => i.id)).toContain(itemB.id);
      const att = await api().get(`/api/v1/invoices/${invoiceB.id}/attachments`).set('Authorization', `Bearer ${tokenB}`).expect(200);
      expect(att.body.map((x: Attachment) => x.id)).toContain(attachmentB.id);
    });

    it('another user’s applied no-op delete of an unused id does not hide the owner’s record created later with that id', async () => {
      const itemId = '7f1c2a90-1b6e-4c3d-9a55-000000000a01';
      const attachmentId = '7f1c2a90-1b6e-4c3d-9a55-000000000a02';
      const push = (token: string, changes: any[]) =>
        api().post('/api/v1/sync/push').set('Authorization', `Bearer ${token}`).send({ deviceId: 'dev', changes });

      // A deletes ids that do not exist yet: applied as no-ops (synced = true)
      const del = await push(tokenA, [
        { object_type: 'invoice_item', object_id: itemId, change_type: 'delete', data: {} },
        { object_type: 'attachment', object_id: attachmentId, change_type: 'delete', data: {} },
      ]);
      expect(del.body).toMatchObject({ synced: 2, failed: 0 });

      // B later creates its own records with those ids
      const create = await push(tokenB, [
        {
          object_type: 'invoice_item',
          object_id: itemId,
          change_type: 'create',
          data: { invoiceId: invoiceB.id, description: 'B re-created line', quantity: 1, unitPrice: 5, lineTotal: 5 },
        },
        {
          object_type: 'attachment',
          object_id: attachmentId,
          change_type: 'create',
          data: { ownerType: 'invoice', ownerId: invoiceB.id, url: 'https://files.example.test/b-later.pdf', filename: 'b-later.pdf' },
        },
      ]);
      expect(create.body).toMatchObject({ synced: 2, failed: 0 });

      const res = await api().get(`/api/v1/invoices/${invoiceB.id}`).set('Authorization', `Bearer ${tokenB}`).expect(200);
      expect(res.body.items.map((i: InvoiceItem) => i.id)).toContain(itemId);
      const att = await api().get(`/api/v1/invoices/${invoiceB.id}/attachments`).set('Authorization', `Bearer ${tokenB}`).expect(200);
      expect(att.body.map((x: Attachment) => x.id)).toContain(attachmentId);
      const pull = await api().get('/api/v1/sync/pull').set('Authorization', `Bearer ${tokenB}`).expect(200);
      expect(pull.body.invoiceItems.map((i: InvoiceItem) => i.id)).toContain(itemId);
      expect(pull.body.attachments.map((x: Attachment) => x.id)).toContain(attachmentId);
    });

    it('attachment list omits attachments with another user’s sync history; own attachment listed', async () => {
      const b = await api().get(`/api/v1/invoices/${invoiceB.id}/attachments`).set('Authorization', `Bearer ${tokenB}`).expect(200);
      expect(b.body.map((x: Attachment) => x.id)).toEqual([attachmentB.id]);

      const a = await api().get(`/api/v1/invoices/${invoiceA.id}/attachments`).set('Authorization', `Bearer ${tokenA}`).expect(200);
      expect(a.body.map((x: Attachment) => x.filename)).not.toContain('b-moved-secret.pdf');
      const ownA = await makeAttachment(invoiceA.id, 'a-own.pdf');
      const again = await api().get(`/api/v1/invoices/${invoiceA.id}/attachments`).set('Authorization', `Bearer ${tokenA}`).expect(200);
      expect(again.body.map((x: Attachment) => x.id)).toEqual([ownA.id]);
    });

    it('sync pull omits items and attachments with another user’s sync history; own ones are pulled', async () => {
      const b = await api().get('/api/v1/sync/pull').set('Authorization', `Bearer ${tokenB}`).expect(200);
      expect(b.body.invoiceItems.map((i: InvoiceItem) => i.id)).toEqual([itemB.id]);
      expect(b.body.attachments.map((x: Attachment) => x.id)).toEqual([attachmentB.id]);

      const a = await api().get('/api/v1/sync/pull').set('Authorization', `Bearer ${tokenA}`).expect(200);
      expectNoVictimData(a.body);
      expect(a.body.attachments.map((x: Attachment) => x.id)).not.toContain(attachmentMoved.id);
      expect(a.body.invoiceItems.map((i: InvoiceItem) => i.description).sort()).toEqual(['A line on bad invoice', 'A own line']);
    });

    it('the “invoice paid” notification never carries another user’s client name; own invoice notifies with its client', async () => {
      const pay = (invoiceId: string, id: string) =>
        paymentRepository.save(
          paymentRepository.create({ invoiceId, providerPaymentId: id, amount: 100, currency: 'USD', status: PaymentStatus.COMPLETED }),
        );
      await pay(invoiceBad.id, 'pi_bad');
      await api().get(`/api/v1/invoices/${invoiceBad.id}`).set('Authorization', `Bearer ${tokenA}`).expect(200);
      await pay(invoiceA.id, 'pi_own');
      await api().get(`/api/v1/invoices/${invoiceA.id}`).set('Authorization', `Bearer ${tokenA}`).expect(200);

      for (const call of mockNotificationService.notifyInvoicePaid.mock.calls) {
        expectNoVictimData(call[0]);
      }
      const names = mockNotificationService.notifyInvoicePaid.mock.calls.map((c) => c[0].clientName);
      expect(names).toContain('Own Client A');
    });

    it('payment-received and overdue notifications never carry another user’s client name', async () => {
      const payments = app.get(PaymentsService);
      for (const [invoiceId, id] of [[invoiceBad.id, 'pi_bad'], [invoiceA.id, 'pi_own']]) {
        await paymentRepository.save(
          paymentRepository.create({ invoiceId, providerPaymentId: id, amount: 100, currency: 'USD', status: PaymentStatus.PENDING }),
        );
        // As the verified webhook passes it (amount and currency are checked)
        await payments.updatePaymentStatus(id, PaymentStatus.COMPLETED, {
          id,
          amount_received: 10000,
          currency: 'usd',
          metadata: { invoice_id: invoiceId },
        });
      }
      const received = mockNotificationService.notifyPaymentReceived.mock.calls.map((c) => c[0]);
      received.forEach(expectNoVictimData);
      expect(received.map((d) => d.clientName)).toEqual(['Unknown', 'Own Client A']);

      const past = new Date('2020-01-01');
      await invoiceRepository.update({ id: invoiceBad.id }, { status: InvoiceStatus.SENT, dueDate: past });
      await invoiceRepository.update({ id: invoiceA.id }, { status: InvoiceStatus.SENT, dueDate: past });
      // Due in 2020: historical on the first overdue run, so opt in to
      // notifying the backlog (OVERDUE_NOTIFY_HISTORICAL=true) to test its contents
      const savedOptIn = process.env.OVERDUE_NOTIFY_HISTORICAL;
      process.env.OVERDUE_NOTIFY_HISTORICAL = 'true';
      try {
        await app.get(InvoiceStatusService).markOverdueInvoices();
      } finally {
        if (savedOptIn === undefined) delete process.env.OVERDUE_NOTIFY_HISTORICAL;
        else process.env.OVERDUE_NOTIFY_HISTORICAL = savedOptIn;
      }
      const overdue = mockNotificationService.notifyInvoiceOverdue.mock.calls.map((c) => c[0]);
      overdue.forEach(expectNoVictimData);
      expect(overdue.map((d) => d.clientName).sort()).toEqual(['Own Client A', 'Unknown']);
    });
  });
});
