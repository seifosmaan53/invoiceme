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
import { Payment } from '../src/entities/payment.entity';
import { AuditLog, AuditAction } from '../src/entities/audit-log.entity';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { PdfService } from '../src/core/services/pdf.service';
import { S3Service } from '../src/core/services/s3.service';
import { StripeService } from '../src/core/services/stripe.service';
import { InvoiceType, InvoiceStatus } from '../src/entities/invoice.entity';

describe('Invoices E2E Tests', () => {
  let app: INestApplication;
  let userRepository: Repository<User>;
  let clientRepository: Repository<Client>;
  let invoiceRepository: Repository<Invoice>;
  let invoiceItemRepository: Repository<InvoiceItem>;
  let attachmentRepository: Repository<Attachment>;
  let paymentRepository: Repository<Payment>;
  let auditLogRepository: Repository<AuditLog>;
  let jwtService: JwtService;
  let configService: ConfigService;
  let testUser: User;
  let authToken: string;

  // Mock services
  const mockPdfService = {
    generateInvoicePdf: jest.fn(),
  };

  const mockS3Service = {
    uploadFile: jest.fn(),
  };

  const mockStripeService = {
    createPaymentIntent: jest.fn(),
  };

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
      .overrideProvider(PdfService)
      .useValue(mockPdfService)
      .overrideProvider(S3Service)
      .useValue(mockS3Service)
      .overrideProvider(StripeService)
      .useValue(mockStripeService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    userRepository = moduleFixture.get<Repository<User>>(getRepositoryToken(User));
    clientRepository = moduleFixture.get<Repository<Client>>(getRepositoryToken(Client));
    invoiceRepository = moduleFixture.get<Repository<Invoice>>(getRepositoryToken(Invoice));
    invoiceItemRepository = moduleFixture.get<Repository<InvoiceItem>>(getRepositoryToken(InvoiceItem));
    attachmentRepository = moduleFixture.get<Repository<Attachment>>(getRepositoryToken(Attachment));
    paymentRepository = moduleFixture.get<Repository<Payment>>(getRepositoryToken(Payment));
    auditLogRepository = moduleFixture.get<Repository<AuditLog>>(getRepositoryToken(AuditLog));
    jwtService = moduleFixture.get<JwtService>(JwtService);
    configService = moduleFixture.get<ConfigService>(ConfigService);

    // Setup mocks
    mockPdfService.generateInvoicePdf.mockResolvedValue(Buffer.from('fake-pdf-content'));
    mockS3Service.uploadFile.mockResolvedValue('https://s3.example.com/fake-url.pdf');
    mockStripeService.createPaymentIntent.mockResolvedValue({
      id: 'pi_test_123',
      client_secret: 'pi_test_123_secret',
      status: 'requires_payment_method',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clean tables
    await auditLogRepository.delete({});
    await paymentRepository.delete({});
    await attachmentRepository.delete({});
    await invoiceItemRepository.delete({});
    await invoiceRepository.delete({});
    await clientRepository.delete({});
    await userRepository.delete({});

    // Create test user and auth token
    const password = 'password123';
    const hashedPassword = await bcrypt.hash(password, 10);
    testUser = userRepository.create({
      email: 'invoice-test@example.com',
      passwordHash: hashedPassword,
      name: 'Invoice Test User',
      companyName: 'Test Company',
    });
    await userRepository.save(testUser);

    authToken = jwtService.sign(
      { userId: testUser.id, email: testUser.email },
      { secret: configService.get('JWT_SECRET'), expiresIn: '15m' },
    );
  });

  describe('POST /api/v1/clients', () => {
    it('should create a client successfully', async () => {
      const clientDto = {
        name: 'Test Client',
        email: 'client@example.com',
        phone: '123-456-7890',
        addressJson: {
          street: '123 Main St',
          city: 'New York',
          state: 'NY',
          zip: '10001',
        },
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/clients')
        .set('Authorization', `Bearer ${authToken}`)
        .send(clientDto)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.name).toBe(clientDto.name);
      expect(response.body.email).toBe(clientDto.email);

      // Verify client is created in database
      const client = await clientRepository.findOne({ where: { id: response.body.id } });
      expect(client).toBeDefined();
      expect(client.userId).toBe(testUser.id);
    });

    it('should return 401 Unauthorized without auth token', async () => {
      const clientDto = {
        name: 'Test Client',
      };

      await request(app.getHttpServer()).post('/api/v1/clients').send(clientDto).expect(401);
    });

    it('should return 400 Bad Request for invalid data', async () => {
      const clientDto = {
        // Missing required name field
        email: 'client@example.com',
      };

      await request(app.getHttpServer())
        .post('/api/v1/clients')
        .set('Authorization', `Bearer ${authToken}`)
        .send(clientDto)
        .expect(400);
    });
  });

  describe('POST /api/v1/invoices', () => {
    it('should create an invoice successfully', async () => {
      // Create test client first
      const client = clientRepository.create({
        userId: testUser.id,
        name: 'Invoice Client',
        email: 'invoiceclient@example.com',
      });
      await clientRepository.save(client);

      const invoiceDto = {
        clientId: client.id,
        type: InvoiceType.INVOICE,
        issueDate: new Date().toISOString(),
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        currency: 'USD',
        items: [
          {
            description: 'Test Item 1',
            quantity: 2,
            unitPrice: 100.0,
            taxRate: 10,
            discountRate: 0,
          },
          {
            description: 'Test Item 2',
            quantity: 1,
            unitPrice: 50.0,
            taxRate: 0,
            discountRate: 5,
          },
        ],
        notes: 'Test invoice notes',
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invoiceDto)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.clientId).toBe(client.id);
      expect(response.body.type).toBe(InvoiceType.INVOICE);
      expect(response.body.items).toHaveLength(2);

      // Verify invoice is created in database
      const invoice = await invoiceRepository.findOne({
        where: { id: response.body.id },
        relations: ['items'],
      });
      expect(invoice).toBeDefined();
      expect(invoice.userId).toBe(testUser.id);
      expect(invoice.items).toHaveLength(2);
    });

    it('should return 404 Not Found for non-existent clientId', async () => {
      const invoiceDto = {
        clientId: '00000000-0000-0000-0000-000000000000',
        issueDate: new Date().toISOString(),
        items: [
          {
            description: 'Test Item',
            quantity: 1,
            unitPrice: 100.0,
          },
        ],
      };

      await request(app.getHttpServer())
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invoiceDto)
        .expect(404);
    });

    it('should return 401 Unauthorized without auth token', async () => {
      const invoiceDto = {
        clientId: 'some-id',
        issueDate: new Date().toISOString(),
        items: [],
      };

      await request(app.getHttpServer()).post('/api/v1/invoices').send(invoiceDto).expect(401);
    });
  });

  describe('POST /api/v1/invoices/:id/pdf', () => {
    it('should generate PDF successfully', async () => {
      // Create test client and invoice
      const client = clientRepository.create({
        userId: testUser.id,
        name: 'PDF Client',
        email: 'pdfclient@example.com',
      });
      await clientRepository.save(client);

      const invoice = invoiceRepository.create({
        userId: testUser.id,
        clientId: client.id,
        type: InvoiceType.INVOICE,
        number: 'INV-001',
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

      const response = await request(app.getHttpServer())
        .post(`/api/v1/invoices/${invoice.id}/pdf`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(201);

      expect(response.body).toHaveProperty('url');
      expect(response.body).toHaveProperty('invoiceId');
      expect(response.body.invoiceId).toBe(invoice.id);

      // Verify PDF service was called
      expect(mockPdfService.generateInvoicePdf).toHaveBeenCalled();
      expect(mockS3Service.uploadFile).toHaveBeenCalled();

      // Verify audit log entry
      const auditLog = await auditLogRepository.findOne({
        where: { resourceId: invoice.id, action: AuditAction.EXPORT },
      });
      expect(auditLog).toBeDefined();
    });

    it('should return 404 Not Found for non-existent invoice', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/invoices/00000000-0000-0000-0000-000000000000/pdf')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('should return 401 Unauthorized without auth token', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/invoices/some-id/pdf')
        .expect(401);
    });
  });

  describe('Complete Client → Invoice → PDF Flow', () => {
    it('should complete full invoice creation and PDF generation flow', async () => {
      // Register/login to get auth tokens (already have testUser)
      // Create client
      const clientResponse = await request(app.getHttpServer())
        .post('/api/v1/clients')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Flow Client',
          email: 'flowclient@example.com',
        })
        .expect(201);

      const clientId = clientResponse.body.id;

      // Create invoice with multiple items
      const invoiceResponse = await request(app.getHttpServer())
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          clientId: clientId,
          type: InvoiceType.INVOICE,
          issueDate: new Date().toISOString(),
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          currency: 'USD',
          items: [
            {
              description: 'Item 1',
              quantity: 2,
              unitPrice: 100.0,
            },
            {
              description: 'Item 2',
              quantity: 1,
              unitPrice: 50.0,
            },
          ],
        })
        .expect(201);

      const invoiceId = invoiceResponse.body.id;

      // Get invoice details
      await request(app.getHttpServer())
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Generate PDF
      const pdfResponse = await request(app.getHttpServer())
        .post(`/api/v1/invoices/${invoiceId}/pdf`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(201);

      expect(pdfResponse.body).toHaveProperty('url');

      // Verify invoice still accessible
      await request(app.getHttpServer())
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
    });
  });

  describe('GET /api/v1/invoices/:id', () => {
    it('should get invoice with details', async () => {
      // Create test client and invoice
      const client = clientRepository.create({
        userId: testUser.id,
        name: 'Get Client',
        email: 'getclient@example.com',
      });
      await clientRepository.save(client);

      const invoice = invoiceRepository.create({
        userId: testUser.id,
        clientId: client.id,
        type: InvoiceType.INVOICE,
        number: 'INV-002',
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
        description: 'Test Item',
        quantity: 1,
        unitPrice: 100,
        lineTotal: 100,
      });
      await invoiceItemRepository.save(item);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/invoices/${invoice.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.id).toBe(invoice.id);
      expect(response.body.client).toBeDefined();
      expect(response.body.items).toBeDefined();

      // Verify audit log entry
      const auditLog = await auditLogRepository.findOne({
        where: { resourceId: invoice.id, action: AuditAction.VIEW },
      });
      expect(auditLog).toBeDefined();
    });

    it('should return 404 Not Found for non-existent invoice', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/invoices/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });
  });

  describe('GET /api/v1/invoices (list with pagination)', () => {
    it('should list invoices with pagination', async () => {
      // Create test client
      const client = clientRepository.create({
        userId: testUser.id,
        name: 'List Client',
        email: 'listclient@example.com',
      });
      await clientRepository.save(client);

      // Create multiple invoices
      for (let i = 0; i < 5; i++) {
        const invoice = invoiceRepository.create({
          userId: testUser.id,
          clientId: client.id,
          type: InvoiceType.INVOICE,
          number: `INV-${i}`,
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
      }

      const response = await request(app.getHttpServer())
        .get('/api/v1/invoices?page=1&limit=3')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('total');
      expect(response.body.data.length).toBeLessThanOrEqual(3);
    });

    it('should filter invoices by type', async () => {
      // Create test client
      const client = clientRepository.create({
        userId: testUser.id,
        name: 'Filter Client',
        email: 'filterclient@example.com',
      });
      await clientRepository.save(client);

      // Create invoices of different types
      const invoice = invoiceRepository.create({
        userId: testUser.id,
        clientId: client.id,
        type: InvoiceType.INVOICE,
        number: 'INV-FILTER',
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

      const estimate = invoiceRepository.create({
        userId: testUser.id,
        clientId: client.id,
        type: InvoiceType.ESTIMATE,
        number: 'EST-FILTER',
        issueDate: new Date(),
        dueDate: new Date(),
        currency: 'USD',
        subtotal: 100,
        taxTotal: 10,
        discountTotal: 0,
        total: 110,
        status: InvoiceStatus.DRAFT,
      });
      await invoiceRepository.save(estimate);

      const response = await request(app.getHttpServer())
        .get('/api/v1/invoices?type=invoice')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data.every((inv: Invoice) => inv.type === InvoiceType.INVOICE)).toBe(true);
    });

    it('should filter invoices by date range', async () => {
      // Create test client
      const client = clientRepository.create({
        userId: testUser.id,
        name: 'Date Filter Client',
        email: 'datefilter@example.com',
      });
      await clientRepository.save(client);

      // Create invoices with different dates
      const oldInvoice = invoiceRepository.create({
        userId: testUser.id,
        clientId: client.id,
        type: InvoiceType.INVOICE,
        number: 'INV-OLD',
        issueDate: new Date('2024-06-01'),
        dueDate: new Date('2024-07-01'),
        currency: 'USD',
        subtotal: 100,
        taxTotal: 10,
        discountTotal: 0,
        total: 110,
        status: InvoiceStatus.DRAFT,
      });
      await invoiceRepository.save(oldInvoice);

      const newInvoice = invoiceRepository.create({
        userId: testUser.id,
        clientId: client.id,
        type: InvoiceType.INVOICE,
        number: 'INV-NEW',
        issueDate: new Date('2025-06-01'),
        dueDate: new Date('2025-07-01'),
        currency: 'USD',
        subtotal: 200,
        taxTotal: 20,
        discountTotal: 0,
        total: 220,
        status: InvoiceStatus.DRAFT,
      });
      await invoiceRepository.save(newInvoice);

      // Filter by date range (only 2025 invoices)
      const response = await request(app.getHttpServer())
        .get('/api/v1/invoices?dateFrom=2025-01-01&dateTo=2025-12-31')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(0);
      const invoiceNumbers = response.body.data.map((inv: Invoice) => inv.number);
      expect(invoiceNumbers).toContain('INV-NEW');
      expect(invoiceNumbers).not.toContain('INV-OLD');
    });

    it('should filter invoices by amount range', async () => {
      // Create test client
      const client = clientRepository.create({
        userId: testUser.id,
        name: 'Amount Filter Client',
        email: 'amountfilter@example.com',
      });
      await clientRepository.save(client);

      // Create invoices with different amounts
      const smallInvoice = invoiceRepository.create({
        userId: testUser.id,
        clientId: client.id,
        type: InvoiceType.INVOICE,
        number: 'INV-SMALL',
        issueDate: new Date(),
        dueDate: new Date(),
        currency: 'USD',
        subtotal: 50,
        taxTotal: 5,
        discountTotal: 0,
        total: 55,
        status: InvoiceStatus.DRAFT,
      });
      await invoiceRepository.save(smallInvoice);

      const mediumInvoice = invoiceRepository.create({
        userId: testUser.id,
        clientId: client.id,
        type: InvoiceType.INVOICE,
        number: 'INV-MEDIUM',
        issueDate: new Date(),
        dueDate: new Date(),
        currency: 'USD',
        subtotal: 500,
        taxTotal: 50,
        discountTotal: 0,
        total: 550,
        status: InvoiceStatus.DRAFT,
      });
      await invoiceRepository.save(mediumInvoice);

      const largeInvoice = invoiceRepository.create({
        userId: testUser.id,
        clientId: client.id,
        type: InvoiceType.INVOICE,
        number: 'INV-LARGE',
        issueDate: new Date(),
        dueDate: new Date(),
        currency: 'USD',
        subtotal: 5000,
        taxTotal: 500,
        discountTotal: 0,
        total: 5500,
        status: InvoiceStatus.DRAFT,
      });
      await invoiceRepository.save(largeInvoice);

      // Filter by amount range (100-1000)
      const response = await request(app.getHttpServer())
        .get('/api/v1/invoices?amountMin=100&amountMax=1000')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(0);
      const invoiceNumbers = response.body.data.map((inv: Invoice) => inv.number);
      expect(invoiceNumbers).toContain('INV-MEDIUM');
      expect(invoiceNumbers).not.toContain('INV-SMALL');
      expect(invoiceNumbers).not.toContain('INV-LARGE');

      // Verify all returned invoices are within the range
      response.body.data.forEach((inv: Invoice) => {
        expect(inv.total).toBeGreaterThanOrEqual(100);
        expect(inv.total).toBeLessThanOrEqual(1000);
      });
    });

    it('should filter invoices by status and date range', async () => {
      // Create test client
      const client = clientRepository.create({
        userId: testUser.id,
        name: 'Status Date Filter Client',
        email: 'statusdate@example.com',
      });
      await clientRepository.save(client);

      // Create invoices with different statuses and dates
      const paidInvoice = invoiceRepository.create({
        userId: testUser.id,
        clientId: client.id,
        type: InvoiceType.INVOICE,
        number: 'INV-PAID',
        issueDate: new Date('2025-06-01'),
        dueDate: new Date('2025-07-01'),
        currency: 'USD',
        subtotal: 100,
        taxTotal: 10,
        discountTotal: 0,
        total: 110,
        status: InvoiceStatus.PAID,
      });
      await invoiceRepository.save(paidInvoice);

      const unpaidInvoice = invoiceRepository.create({
        userId: testUser.id,
        clientId: client.id,
        type: InvoiceType.INVOICE,
        number: 'INV-UNPAID',
        issueDate: new Date('2025-06-01'),
        dueDate: new Date('2025-07-01'),
        currency: 'USD',
        subtotal: 200,
        taxTotal: 20,
        discountTotal: 0,
        total: 220,
        status: InvoiceStatus.UNPAID,
      });
      await invoiceRepository.save(unpaidInvoice);

      // Filter by status and date range
      const response = await request(app.getHttpServer())
        .get('/api/v1/invoices?status=paid&dateFrom=2025-01-01&dateTo=2025-12-31')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(0);
      const invoiceNumbers = response.body.data.map((inv: Invoice) => inv.number);
      expect(invoiceNumbers).toContain('INV-PAID');
      expect(invoiceNumbers).not.toContain('INV-UNPAID');

      // Verify all returned invoices match the filters
      response.body.data.forEach((inv: Invoice) => {
        expect(inv.status).toBe(InvoiceStatus.PAID);
        const issueDate = new Date(inv.issueDate);
        expect(issueDate.getFullYear()).toBe(2025);
      });
    });

    it('should filter invoices with combined filters (type, status, date, amount)', async () => {
      // Create test client
      const client = clientRepository.create({
        userId: testUser.id,
        name: 'Combined Filter Client',
        email: 'combined@example.com',
      });
      await clientRepository.save(client);

      // Create invoices that match various combinations
      const matchingInvoice = invoiceRepository.create({
        userId: testUser.id,
        clientId: client.id,
        type: InvoiceType.INVOICE,
        number: 'INV-MATCH',
        issueDate: new Date('2025-06-15'),
        dueDate: new Date('2025-07-15'),
        currency: 'USD',
        subtotal: 500,
        taxTotal: 50,
        discountTotal: 0,
        total: 550,
        status: InvoiceStatus.SENT,
      });
      await invoiceRepository.save(matchingInvoice);

      // Filter with all parameters
      const response = await request(app.getHttpServer())
        .get('/api/v1/invoices?type=invoice&status=sent&dateFrom=2025-06-01&dateTo=2025-06-30&amountMin=500&amountMax=600')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(0);
      const invoiceNumbers = response.body.data.map((inv: Invoice) => inv.number);
      expect(invoiceNumbers).toContain('INV-MATCH');

      // Verify all returned invoices match all filters
      response.body.data.forEach((inv: Invoice) => {
        expect(inv.type).toBe(InvoiceType.INVOICE);
        expect(inv.status).toBe(InvoiceStatus.SENT);
        expect(inv.total).toBeGreaterThanOrEqual(500);
        expect(inv.total).toBeLessThanOrEqual(600);
        const issueDate = new Date(inv.issueDate);
        expect(issueDate.getMonth()).toBe(5); // June (0-indexed)
        expect(issueDate.getFullYear()).toBe(2025);
      });
    });
  });

  describe('PATCH /api/v1/invoices/:id', () => {
    it('should update invoice successfully', async () => {
      // Create test client and invoice
      const client = clientRepository.create({
        userId: testUser.id,
        name: 'Update Client',
        email: 'updateclient@example.com',
      });
      await clientRepository.save(client);

      const invoice = invoiceRepository.create({
        userId: testUser.id,
        clientId: client.id,
        type: InvoiceType.INVOICE,
        number: 'INV-UPDATE',
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

      const updateDto = {
        status: InvoiceStatus.SENT,
        notes: 'Updated notes',
      };

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/invoices/${invoice.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateDto)
        .expect(200);

      expect(response.body.status).toBe(InvoiceStatus.SENT);
      expect(response.body.notes).toBe('Updated notes');

      // Verify invoice is updated in database
      const updatedInvoice = await invoiceRepository.findOne({ where: { id: invoice.id } });
      expect(updatedInvoice.status).toBe(InvoiceStatus.SENT);

      // Verify audit log entry
      const auditLog = await auditLogRepository.findOne({
        where: { resourceId: invoice.id, action: AuditAction.UPDATE },
      });
      expect(auditLog).toBeDefined();
    });
  });

  describe('DELETE /api/v1/invoices/:id', () => {
    it('should soft delete invoice', async () => {
      // Create test client and invoice
      const client = clientRepository.create({
        userId: testUser.id,
        name: 'Delete Client',
        email: 'deleteclient@example.com',
      });
      await clientRepository.save(client);

      const invoice = invoiceRepository.create({
        userId: testUser.id,
        clientId: client.id,
        type: InvoiceType.INVOICE,
        number: 'INV-DELETE',
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

      await request(app.getHttpServer())
        .delete(`/api/v1/invoices/${invoice.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Verify invoice's deletedAt is set
      const deletedInvoice = await invoiceRepository.findOne({ where: { id: invoice.id } });
      expect(deletedInvoice.deletedAt).toBeDefined();

      // Verify invoice no longer appears in list
      const listResponse = await request(app.getHttpServer())
        .get('/api/v1/invoices')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(listResponse.body.data.find((inv: Invoice) => inv.id === invoice.id)).toBeUndefined();

      // Verify audit log entry
      const auditLog = await auditLogRepository.findOne({
        where: { resourceId: invoice.id, action: AuditAction.DELETE },
      });
      expect(auditLog).toBeDefined();
    });
  });

  describe('POST /api/v1/invoices/:id/convert', () => {
    it('should convert estimate to invoice', async () => {
      // Create test client and estimate
      const client = clientRepository.create({
        userId: testUser.id,
        name: 'Convert Client',
        email: 'convertclient@example.com',
      });
      await clientRepository.save(client);

      const estimate = invoiceRepository.create({
        userId: testUser.id,
        clientId: client.id,
        type: InvoiceType.ESTIMATE,
        number: 'EST-CONVERT',
        issueDate: new Date(),
        dueDate: new Date(),
        currency: 'USD',
        subtotal: 100,
        taxTotal: 10,
        discountTotal: 0,
        total: 110,
        status: InvoiceStatus.DRAFT,
      });
      await invoiceRepository.save(estimate);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/invoices/${estimate.id}/convert`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(201);

      expect(response.body.type).toBe(InvoiceType.INVOICE);
      expect(response.body.id).not.toBe(estimate.id);

      // Verify original estimate still exists
      const originalEstimate = await invoiceRepository.findOne({ where: { id: estimate.id } });
      expect(originalEstimate).toBeDefined();
      expect(originalEstimate.type).toBe(InvoiceType.ESTIMATE);
    });

    it('should return 400 Bad Request for non-estimate', async () => {
      // Create test client and invoice
      const client = clientRepository.create({
        userId: testUser.id,
        name: 'No Convert Client',
        email: 'noconvertclient@example.com',
      });
      await clientRepository.save(client);

      const invoice = invoiceRepository.create({
        userId: testUser.id,
        clientId: client.id,
        type: InvoiceType.INVOICE,
        number: 'INV-NOCONVERT',
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

      await request(app.getHttpServer())
        .post(`/api/v1/invoices/${invoice.id}/convert`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });
  });

  describe('POST /api/v1/invoices/:id/attachments', () => {
    it('should upload attachment successfully', async () => {
      // Create test client and invoice
      const client = clientRepository.create({
        userId: testUser.id,
        name: 'Attachment Client',
        email: 'attachmentclient@example.com',
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

      const response = await request(app.getHttpServer())
        .post(`/api/v1/invoices/${invoice.id}/attachments`)
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', Buffer.from('fake file content'), 'test.pdf')
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('url');
      expect(response.body.filename).toBe('test.pdf');

      // Verify S3Service was called
      expect(mockS3Service.uploadFile).toHaveBeenCalled();

      // Verify attachment record is created
      const attachment = await attachmentRepository.findOne({ where: { id: response.body.id } });
      expect(attachment).toBeDefined();
      expect(attachment.ownerId).toBe(invoice.id);
    });

    it('should return 400 Bad Request without file', async () => {
      // Create test invoice
      const client = clientRepository.create({
        userId: testUser.id,
        name: 'No File Client',
        email: 'nofileclient@example.com',
      });
      await clientRepository.save(client);

      const invoice = invoiceRepository.create({
        userId: testUser.id,
        clientId: client.id,
        type: InvoiceType.INVOICE,
        number: 'INV-NOFILE',
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

      await request(app.getHttpServer())
        .post(`/api/v1/invoices/${invoice.id}/attachments`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });
  });

  describe('GET /api/v1/invoices/:id/attachments', () => {
    it('should return list of attachments for an invoice', async () => {
      // Create test invoice
      const client = clientRepository.create({
        userId: testUser.id,
        name: 'Attachment Client',
        email: 'attachmentclient@example.com',
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

      // Upload an attachment first
      const attachmentResponse = await request(app.getHttpServer())
        .post(`/api/v1/invoices/${invoice.id}/attachments`)
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', Buffer.from('test file content'), 'test.pdf')
        .expect(201);

      const attachment = attachmentResponse.body;

      // Get attachments list
      const response = await request(app.getHttpServer())
        .get(`/api/v1/invoices/${invoice.id}/attachments`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body[0].id).toBe(attachment.id);
      expect(response.body[0].ownerId).toBe(invoice.id);
      expect(response.body[0].ownerType).toBe('invoice');
    });

    it('should return empty array if invoice has no attachments', async () => {
      // Create test invoice
      const client = clientRepository.create({
        userId: testUser.id,
        name: 'No Attachment Client',
        email: 'noattachclient@example.com',
      });
      await clientRepository.save(client);

      const invoice = invoiceRepository.create({
        userId: testUser.id,
        clientId: client.id,
        type: InvoiceType.INVOICE,
        number: 'INV-NOATTACH',
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

      // Get attachments list
      const response = await request(app.getHttpServer())
        .get(`/api/v1/invoices/${invoice.id}/attachments`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(0);
    });

    it('should return 404 if invoice not found', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/invoices/non-existent-id/attachments')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });
  });
});

