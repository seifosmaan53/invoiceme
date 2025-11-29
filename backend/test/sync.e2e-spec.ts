import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppModule } from '../src/app.module';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../src/entities/user.entity';
import { Client } from '../src/entities/client.entity';
import { Invoice } from '../src/entities/invoice.entity';
import { InvoiceItem } from '../src/entities/invoice-item.entity';
import { Attachment } from '../src/entities/attachment.entity';
import { DeviceChange, ChangeType, ChangeObjectType } from '../src/entities/device-change.entity';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { InvoiceType, InvoiceStatus } from '../src/entities/invoice.entity';
import { v4 as uuidv4 } from 'uuid';

describe('Sync E2E Tests', () => {
  let app: INestApplication;
  let userRepository: Repository<User>;
  let clientRepository: Repository<Client>;
  let invoiceRepository: Repository<Invoice>;
  let invoiceItemRepository: Repository<InvoiceItem>;
  let attachmentRepository: Repository<Attachment>;
  let deviceChangeRepository: Repository<DeviceChange>;
  let jwtService: JwtService;
  let configService: ConfigService;
  let testUser: User;
  let testUser2: User;
  let authToken: string;
  let authToken2: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: ['.env.test', '.env'],
        }),
        AppModule,
      ],
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
    app.setGlobalPrefix('api');
    await app.init();

    userRepository = moduleFixture.get<Repository<User>>(getRepositoryToken(User));
    clientRepository = moduleFixture.get<Repository<Client>>(getRepositoryToken(Client));
    invoiceRepository = moduleFixture.get<Repository<Invoice>>(getRepositoryToken(Invoice));
    invoiceItemRepository = moduleFixture.get<Repository<InvoiceItem>>(getRepositoryToken(InvoiceItem));
    attachmentRepository = moduleFixture.get<Repository<Attachment>>(getRepositoryToken(Attachment));
    deviceChangeRepository = moduleFixture.get<Repository<DeviceChange>>(getRepositoryToken(DeviceChange));
    jwtService = moduleFixture.get<JwtService>(JwtService);
    configService = moduleFixture.get<ConfigService>(ConfigService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clean tables
    await deviceChangeRepository.delete({});
    await attachmentRepository.delete({});
    await invoiceItemRepository.delete({});
    await invoiceRepository.delete({});
    await clientRepository.delete({});
    await userRepository.delete({});

    // Create test users and auth tokens
    const password = 'password123';
    const hashedPassword = await bcrypt.hash(password, 10);
    testUser = userRepository.create({
      email: 'sync-test@example.com',
      passwordHash: hashedPassword,
      name: 'Sync Test User',
      companyName: 'Test Company',
    });
    await userRepository.save(testUser);

    testUser2 = userRepository.create({
      email: 'sync-test2@example.com',
      passwordHash: hashedPassword,
      name: 'Sync Test User 2',
      companyName: 'Test Company 2',
    });
    await userRepository.save(testUser2);

    authToken = jwtService.sign(
      { userId: testUser.id, email: testUser.email },
      { secret: configService.get('JWT_SECRET'), expiresIn: '15m' },
    );

    authToken2 = jwtService.sign(
      { userId: testUser2.id, email: testUser2.email },
      { secret: configService.get('JWT_SECRET'), expiresIn: '15m' },
    );
  });

  describe('POST /api/v1/sync/push - Client Changes', () => {
    it('should push client CREATE change successfully', async () => {
      const clientId = uuidv4();
      const deviceId = 'device-123';
      const syncPushDto = {
        deviceId: deviceId,
        changes: [
          {
            object_type: ChangeObjectType.CLIENT,
            object_id: clientId,
            change_type: ChangeType.CREATE,
            data: {
              name: 'Synced Client',
              email: 'synced@example.com',
              phone: '123-456-7890',
            },
            device_id: deviceId,
            updated_at: new Date().toISOString(),
          },
        ],
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/sync/push')
        .set('Authorization', `Bearer ${authToken}`)
        .send(syncPushDto)
        .expect(200);

      expect(response.body).toHaveProperty('synced');
      expect(response.body).toHaveProperty('failed');
      expect(response.body.synced).toBe(1);
      expect(response.body.failed).toBe(0);

      // Verify client is created in database
      const client = await clientRepository.findOne({ where: { id: clientId } });
      expect(client).toBeDefined();
      expect(client.name).toBe('Synced Client');
      expect(client.userId).toBe(testUser.id);

      // Verify device_change record is created
      const deviceChange = await deviceChangeRepository.findOne({
        where: { objectId: clientId },
      });
      expect(deviceChange).toBeDefined();
      expect(deviceChange.synced).toBe(true);
    });

    it('should return 401 Unauthorized without auth token', async () => {
      const syncPushDto = {
        deviceId: 'device-123',
        changes: [],
      };

      await request(app.getHttpServer()).post('/api/v1/sync/push').send(syncPushDto).expect(401);
    });
  });

  describe('POST /api/v1/sync/push - Invoice Changes', () => {
    it('should push invoice CREATE change successfully', async () => {
      // Create test client first
      const client = clientRepository.create({
        userId: testUser.id,
        name: 'Invoice Sync Client',
        email: 'invoicesync@example.com',
      });
      await clientRepository.save(client);

      const invoiceId = uuidv4();
      const deviceId = 'device-123';
      const syncPushDto = {
        deviceId: deviceId,
        changes: [
          {
            object_type: ChangeObjectType.INVOICE,
            object_id: invoiceId,
            change_type: ChangeType.CREATE,
            data: {
              clientId: client.id,
              type: InvoiceType.INVOICE,
              number: 'INV-SYNC',
              issueDate: new Date().toISOString(),
              dueDate: new Date().toISOString(),
              currency: 'USD',
              subtotal: 100,
              taxTotal: 10,
              discountTotal: 0,
              total: 110,
              status: InvoiceStatus.DRAFT,
            },
            device_id: deviceId,
            updated_at: new Date().toISOString(),
          },
        ],
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/sync/push')
        .set('Authorization', `Bearer ${authToken}`)
        .send(syncPushDto)
        .expect(200);

      expect(response.body.synced).toBe(1);

      // Verify invoice is created
      const invoice = await invoiceRepository.findOne({ where: { id: invoiceId } });
      expect(invoice).toBeDefined();
      expect(invoice.clientId).toBe(client.id);
    });
  });

  describe('POST /api/v1/sync/push - Invoice Item Changes', () => {
    it('should push invoice_item CREATE change successfully', async () => {
      // Create test client and invoice
      const client = clientRepository.create({
        userId: testUser.id,
        name: 'Item Sync Client',
        email: 'itemsync@example.com',
      });
      await clientRepository.save(client);

      const invoice = invoiceRepository.create({
        userId: testUser.id,
        clientId: client.id,
        type: InvoiceType.INVOICE,
        number: 'INV-ITEM',
        issueDate: new Date(),
        dueDate: new Date(),
        currency: 'USD',
        subtotal: 100,
        taxTotal: 10,
        discountTotal: 0,
        total: 110,
        status: InvoiceStatus.DRAFT,
      });
      await invoiceRepository.save(invoice);

      const itemId = uuidv4();
      const deviceId = 'device-123';
      const syncPushDto = {
        deviceId: deviceId,
        changes: [
          {
            object_type: ChangeObjectType.INVOICE_ITEM,
            object_id: itemId,
            change_type: ChangeType.CREATE,
            data: {
              invoiceId: invoice.id,
              description: 'Synced Item',
              quantity: 2,
              unitPrice: 50,
              lineTotal: 100,
            },
            device_id: deviceId,
            updated_at: new Date().toISOString(),
          },
        ],
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/sync/push')
        .set('Authorization', `Bearer ${authToken}`)
        .send(syncPushDto)
        .expect(200);

      expect(response.body.synced).toBe(1);

      // Verify invoice item is created
      const item = await invoiceItemRepository.findOne({ where: { id: itemId } });
      expect(item).toBeDefined();
      expect(item.description).toBe('Synced Item');
    });
  });

  describe('POST /api/v1/sync/push - Update Changes', () => {
    it('should push client UPDATE change successfully', async () => {
      // Create test client in database
      const client = clientRepository.create({
        userId: testUser.id,
        name: 'Original Client',
        email: 'original@example.com',
      });
      await clientRepository.save(client);

      const deviceId = 'device-123';
      const syncPushDto = {
        deviceId: deviceId,
        changes: [
          {
            object_type: ChangeObjectType.CLIENT,
            object_id: client.id,
            change_type: ChangeType.UPDATE,
            data: {
              name: 'Updated Client',
              email: 'updated@example.com',
            },
            device_id: deviceId,
            updated_at: new Date().toISOString(),
          },
        ],
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/sync/push')
        .set('Authorization', `Bearer ${authToken}`)
        .send(syncPushDto)
        .expect(200);

      expect(response.body.synced).toBe(1);

      // Verify client is updated
      const updatedClient = await clientRepository.findOne({ where: { id: client.id } });
      expect(updatedClient.name).toBe('Updated Client');
      expect(updatedClient.email).toBe('updated@example.com');
      expect(updatedClient.updatedAt.getTime()).toBeGreaterThan(client.updatedAt.getTime());
    });
  });

  describe('POST /api/v1/sync/push - Delete Changes', () => {
    it('should push client DELETE change successfully', async () => {
      // Create test client in database
      const client = clientRepository.create({
        userId: testUser.id,
        name: 'Delete Client',
        email: 'delete@example.com',
      });
      await clientRepository.save(client);

      const deviceId = 'device-123';
      const syncPushDto = {
        deviceId: deviceId,
        changes: [
          {
            object_type: ChangeObjectType.CLIENT,
            object_id: client.id,
            change_type: ChangeType.DELETE,
            data: {},
            device_id: deviceId,
            updated_at: new Date().toISOString(),
          },
        ],
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/sync/push')
        .set('Authorization', `Bearer ${authToken}`)
        .send(syncPushDto)
        .expect(200);

      expect(response.body.synced).toBe(1);

      // Verify client's deletedAt is set
      const deletedClient = await clientRepository.findOne({ where: { id: client.id } });
      expect(deletedClient.deletedAt).toBeDefined();
    });
  });

  describe('POST /api/v1/sync/push - Batch Changes', () => {
    it('should push multiple changes in batch', async () => {
      const clientId = uuidv4();
      const invoiceId = uuidv4();
      const itemId = uuidv4();
      const deviceId = 'device-123';

      const syncPushDto = {
        deviceId: deviceId,
        changes: [
          {
            object_type: ChangeObjectType.CLIENT,
            object_id: clientId,
            change_type: ChangeType.CREATE,
            data: {
              name: 'Batch Client',
              email: 'batch@example.com',
            },
            device_id: deviceId,
            updated_at: new Date().toISOString(),
          },
          {
            object_type: ChangeObjectType.INVOICE,
            object_id: invoiceId,
            change_type: ChangeType.CREATE,
            data: {
              clientId: clientId,
              type: InvoiceType.INVOICE,
              number: 'INV-BATCH',
              issueDate: new Date().toISOString(),
              dueDate: new Date().toISOString(),
              currency: 'USD',
              subtotal: 100,
              taxTotal: 10,
              discountTotal: 0,
              total: 110,
              status: InvoiceStatus.DRAFT,
            },
            device_id: deviceId,
            updated_at: new Date().toISOString(),
          },
          {
            object_type: ChangeObjectType.INVOICE_ITEM,
            object_id: itemId,
            change_type: ChangeType.CREATE,
            data: {
              invoiceId: invoiceId,
              description: 'Batch Item',
              quantity: 1,
              unitPrice: 100,
              lineTotal: 100,
            },
            device_id: deviceId,
            updated_at: new Date().toISOString(),
          },
        ],
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/sync/push')
        .set('Authorization', `Bearer ${authToken}`)
        .send(syncPushDto)
        .expect(200);

      expect(response.body.synced).toBe(3);
      expect(response.body.failed).toBe(0);

      // Verify all entities are created
      const client = await clientRepository.findOne({ where: { id: clientId } });
      const invoice = await invoiceRepository.findOne({ where: { id: invoiceId } });
      const item = await invoiceItemRepository.findOne({ where: { id: itemId } });

      expect(client).toBeDefined();
      expect(invoice).toBeDefined();
      expect(item).toBeDefined();
    });
  });

  describe('GET /api/v1/sync/pull - Initial Sync', () => {
    it('should pull all changes for initial sync', async () => {
      // Create test data
      const client = clientRepository.create({
        userId: testUser.id,
        name: 'Pull Client',
        email: 'pull@example.com',
      });
      await clientRepository.save(client);

      const invoice = invoiceRepository.create({
        userId: testUser.id,
        clientId: client.id,
        type: InvoiceType.INVOICE,
        number: 'INV-PULL',
        issueDate: new Date(),
        dueDate: new Date(),
        currency: 'USD',
        subtotal: 100,
        taxTotal: 10,
        discountTotal: 0,
        total: 110,
        status: InvoiceStatus.DRAFT,
      });
      await invoiceRepository.save(invoice);

      const item = invoiceItemRepository.create({
        invoiceId: invoice.id,
        description: 'Pull Item',
        quantity: 1,
        unitPrice: 100,
        lineTotal: 100,
      });
      await invoiceItemRepository.save(item);

      const response = await request(app.getHttpServer())
        .get('/api/v1/sync/pull')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('clients');
      expect(response.body).toHaveProperty('invoices');
      expect(response.body).toHaveProperty('invoiceItems');
      expect(response.body).toHaveProperty('attachments');
      expect(response.body).toHaveProperty('lastSyncTimestamp');

      expect(response.body.clients.length).toBeGreaterThanOrEqual(1);
      expect(response.body.invoices.length).toBeGreaterThanOrEqual(1);
      expect(response.body.invoiceItems.length).toBeGreaterThanOrEqual(1);

      // Verify only non-deleted entities are returned
      expect(response.body.clients.every((c: Client) => !c.deletedAt)).toBe(true);
    });

    it('should return 401 Unauthorized without auth token', async () => {
      await request(app.getHttpServer()).get('/api/v1/sync/pull').expect(401);
    });
  });

  describe('GET /api/v1/sync/pull - Incremental Sync', () => {
    it('should pull only entities updated after timestamp', async () => {
      // Create initial test data
      const client1 = clientRepository.create({
        userId: testUser.id,
        name: 'Initial Client',
        email: 'initial@example.com',
      });
      await clientRepository.save(client1);

      // Get initial sync timestamp
      const initialTimestamp = new Date().toISOString();

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Create new client and update existing one
      const client2 = clientRepository.create({
        userId: testUser.id,
        name: 'New Client',
        email: 'new@example.com',
      });
      await clientRepository.save(client2);

      client1.name = 'Updated Initial Client';
      await clientRepository.save(client1);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/sync/pull?since=${initialTimestamp}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Should include new client and updated client
      const clientIds = response.body.clients.map((c: Client) => c.id);
      expect(clientIds).toContain(client1.id);
      expect(clientIds).toContain(client2.id);
    });
  });

  describe('GET /api/v1/sync/pull - Empty Result', () => {
    it('should return empty arrays when no changes since timestamp', async () => {
      const currentTimestamp = new Date().toISOString();

      const response = await request(app.getHttpServer())
        .get(`/api/v1/sync/pull?since=${currentTimestamp}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.clients).toEqual([]);
      expect(response.body.invoices).toEqual([]);
      expect(response.body.invoiceItems).toEqual([]);
      expect(response.body.attachments).toEqual([]);
      expect(response.body).toHaveProperty('lastSyncTimestamp');
    });
  });

  describe('GET /api/v1/sync/pull - User Isolation', () => {
    it('should return only user A entities when authenticated as user A', async () => {
      // Create test data for user A
      const clientA = clientRepository.create({
        userId: testUser.id,
        name: 'User A Client',
        email: 'usera@example.com',
      });
      await clientRepository.save(clientA);

      // Create test data for user B
      const clientB = clientRepository.create({
        userId: testUser2.id,
        name: 'User B Client',
        email: 'userb@example.com',
      });
      await clientRepository.save(clientB);

      const response = await request(app.getHttpServer())
        .get('/api/v1/sync/pull')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Verify only user A's entities are returned
      const clientIds = response.body.clients.map((c: Client) => c.id);
      expect(clientIds).toContain(clientA.id);
      expect(clientIds).not.toContain(clientB.id);
    });
  });

  describe('Complete Push → Pull Flow', () => {
    it('should complete full sync cycle', async () => {
      // Start with empty database for user
      const clientId = uuidv4();
      const invoiceId = uuidv4();
      const itemId = uuidv4();
      const deviceId = 'device-complete';

      // Push multiple changes
      const pushDto = {
        deviceId: deviceId,
        changes: [
          {
            object_type: ChangeObjectType.CLIENT,
            object_id: clientId,
            change_type: ChangeType.CREATE,
            data: {
              name: 'Complete Client',
              email: 'complete@example.com',
            },
            device_id: deviceId,
            updated_at: new Date().toISOString(),
          },
          {
            object_type: ChangeObjectType.INVOICE,
            object_id: invoiceId,
            change_type: ChangeType.CREATE,
            data: {
              clientId: clientId,
              type: InvoiceType.INVOICE,
              number: 'INV-COMPLETE',
              issueDate: new Date().toISOString(),
              dueDate: new Date().toISOString(),
              currency: 'USD',
              subtotal: 100,
              taxTotal: 10,
              discountTotal: 0,
              total: 110,
              status: InvoiceStatus.DRAFT,
            },
            device_id: deviceId,
            updated_at: new Date().toISOString(),
          },
          {
            object_type: ChangeObjectType.INVOICE_ITEM,
            object_id: itemId,
            change_type: ChangeType.CREATE,
            data: {
              invoiceId: invoiceId,
              description: 'Complete Item',
              quantity: 1,
              unitPrice: 100,
              lineTotal: 100,
            },
            device_id: deviceId,
            updated_at: new Date().toISOString(),
          },
        ],
      };

      const pushResponse = await request(app.getHttpServer())
        .post('/api/v1/sync/push')
        .set('Authorization', `Bearer ${authToken}`)
        .send(pushDto)
        .expect(200);

      expect(pushResponse.body.synced).toBe(3);

      // Get initial sync timestamp
      const pullResponse1 = await request(app.getHttpServer())
        .get('/api/v1/sync/pull')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const lastSyncTimestamp = pullResponse1.body.lastSyncTimestamp;

      // Verify all pushed entities are returned
      expect(pullResponse1.body.clients.find((c: Client) => c.id === clientId)).toBeDefined();
      expect(pullResponse1.body.invoices.find((i: Invoice) => i.id === invoiceId)).toBeDefined();
      expect(pullResponse1.body.invoiceItems.find((item: InvoiceItem) => item.id === itemId)).toBeDefined();

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Update client locally and push update
      const updateDto = {
        deviceId: deviceId,
        changes: [
          {
            object_type: ChangeObjectType.CLIENT,
            object_id: clientId,
            change_type: ChangeType.UPDATE,
            data: {
              name: 'Updated Complete Client',
              email: 'updatedcomplete@example.com',
            },
            device_id: deviceId,
            updated_at: new Date().toISOString(),
          },
        ],
      };

      await request(app.getHttpServer())
        .post('/api/v1/sync/push')
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateDto)
        .expect(200);

      // Pull incremental changes
      const pullResponse2 = await request(app.getHttpServer())
        .get(`/api/v1/sync/pull?since=${lastSyncTimestamp}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Verify only updated client is returned
      const updatedClient = pullResponse2.body.clients.find((c: Client) => c.id === clientId);
      expect(updatedClient).toBeDefined();
      expect(updatedClient.name).toBe('Updated Complete Client');
    });
  });

  describe('POST /api/v1/sync/push - Partial Success', () => {
    it('should handle partial success with valid and invalid changes', async () => {
      const validClientId = uuidv4();
      const invalidInvoiceId = uuidv4();
      const nonExistentClientId = uuidv4();
      const deviceId = 'device-partial';

      const syncPushDto = {
        deviceId: deviceId,
        changes: [
          {
            object_type: ChangeObjectType.CLIENT,
            object_id: validClientId,
            change_type: ChangeType.CREATE,
            data: {
              name: 'Valid Client',
              email: 'valid@example.com',
            },
            device_id: deviceId,
            updated_at: new Date().toISOString(),
          },
          {
            object_type: ChangeObjectType.INVOICE,
            object_id: invalidInvoiceId,
            change_type: ChangeType.CREATE,
            data: {
              clientId: nonExistentClientId,
              type: InvoiceType.INVOICE,
              number: 'INV-INVALID',
              issueDate: new Date().toISOString(),
              dueDate: new Date().toISOString(),
              currency: 'USD',
              subtotal: 100,
              taxTotal: 10,
              discountTotal: 0,
              total: 110,
              status: InvoiceStatus.DRAFT,
            },
            device_id: deviceId,
            updated_at: new Date().toISOString(),
          },
        ],
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/sync/push')
        .set('Authorization', `Bearer ${authToken}`)
        .send(syncPushDto)
        .expect(200);

      expect(response.body).toHaveProperty('synced');
      expect(response.body).toHaveProperty('failed');
      expect(response.body.synced).toBeGreaterThan(0);
      expect(response.body.failed).toBeGreaterThan(0);
      expect(response.body.synced + response.body.failed).toBe(2);

      // Verify valid client was created
      const validClient = await clientRepository.findOne({ where: { id: validClientId } });
      expect(validClient).toBeDefined();
      expect(validClient.name).toBe('Valid Client');

      // Verify invalid invoice was NOT created
      const invalidInvoice = await invoiceRepository.findOne({ where: { id: invalidInvoiceId } });
      expect(invalidInvoice).toBeNull();
    });
  });

  describe('POST /api/v1/sync/push - Attachment Sync', () => {
    it('should push attachment CREATE change successfully', async () => {
      // Create test invoice
      const client = clientRepository.create({
        userId: testUser.id,
        name: 'Attachment Client',
        email: 'attachment@example.com',
      });
      await clientRepository.save(client);

      const invoice = invoiceRepository.create({
        userId: testUser.id,
        clientId: client.id,
        type: InvoiceType.INVOICE,
        number: 'INV-ATTACH',
        issueDate: new Date(),
        dueDate: new Date(),
        currency: 'USD',
        subtotal: 100,
        taxTotal: 10,
        discountTotal: 0,
        total: 110,
        status: InvoiceStatus.DRAFT,
      });
      await invoiceRepository.save(invoice);

      const attachmentId = uuidv4();
      const deviceId = 'device-123';
      const syncPushDto = {
        deviceId: deviceId,
        changes: [
          {
            object_type: ChangeObjectType.ATTACHMENT,
            object_id: attachmentId,
            change_type: ChangeType.CREATE,
            data: {
              ownerType: 'invoice',
              ownerId: invoice.id,
              url: 'https://s3.example.com/attachment.pdf',
              filename: 'attachment.pdf',
              contentType: 'application/pdf',
              sizeBytes: 1024,
            },
            device_id: deviceId,
            updated_at: new Date().toISOString(),
          },
        ],
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/sync/push')
        .set('Authorization', `Bearer ${authToken}`)
        .send(syncPushDto)
        .expect(200);

      expect(response.body.synced).toBe(1);

      // Verify attachment is created
      const attachment = await attachmentRepository.findOne({ where: { id: attachmentId } });
      expect(attachment).toBeDefined();
      expect(attachment.filename).toBe('attachment.pdf');

      // Verify attachment is included in pull response
      const pullResponse = await request(app.getHttpServer())
        .get('/api/v1/sync/pull')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(pullResponse.body.attachments.find((a: Attachment) => a.id === attachmentId)).toBeDefined();
    });
  });
});

