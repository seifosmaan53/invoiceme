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
import { Payment, PaymentStatus } from '../src/entities/payment.entity';
import { AuditLog, AuditAction } from '../src/entities/audit-log.entity';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { StripeService } from '../src/core/services/stripe.service';
import { InvoiceType, InvoiceStatus } from '../src/entities/invoice.entity';

describe('Payments E2E Tests', () => {
  let app: INestApplication;
  let userRepository: Repository<User>;
  let clientRepository: Repository<Client>;
  let invoiceRepository: Repository<Invoice>;
  let paymentRepository: Repository<Payment>;
  let auditLogRepository: Repository<AuditLog>;
  let jwtService: JwtService;
  let configService: ConfigService;
  let testUser: User;
  let authToken: string;

  // Mock StripeService
  const mockStripeService = {
    createPaymentIntent: jest.fn(),
    verifyWebhookSignature: jest.fn(),
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
      .overrideProvider(StripeService)
      .useValue(mockStripeService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    userRepository = moduleFixture.get<Repository<User>>(getRepositoryToken(User));
    clientRepository = moduleFixture.get<Repository<Client>>(getRepositoryToken(Client));
    invoiceRepository = moduleFixture.get<Repository<Invoice>>(getRepositoryToken(Invoice));
    paymentRepository = moduleFixture.get<Repository<Payment>>(getRepositoryToken(Payment));
    auditLogRepository = moduleFixture.get<Repository<AuditLog>>(getRepositoryToken(AuditLog));
    jwtService = moduleFixture.get<JwtService>(JwtService);
    configService = moduleFixture.get<ConfigService>(ConfigService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clean tables
    await auditLogRepository.delete({});
    await paymentRepository.delete({});
    await invoiceRepository.delete({});
    await clientRepository.delete({});
    await userRepository.delete({});

    // Create test user and auth token
    const password = 'password123';
    const hashedPassword = await bcrypt.hash(password, 10);
    testUser = userRepository.create({
      email: 'payment-test@example.com',
      passwordHash: hashedPassword,
      name: 'Payment Test User',
      companyName: 'Test Company',
    });
    await userRepository.save(testUser);

    authToken = jwtService.sign(
      { userId: testUser.id, email: testUser.email },
      { secret: configService.get('JWT_SECRET'), expiresIn: '15m' },
    );

    // Reset mocks
    jest.clearAllMocks();
  });

  describe('POST /api/v1/invoices/:id/pay', () => {
    it('should create payment intent for invoice successfully', async () => {
      // Create test client and invoice
      const client = clientRepository.create({
        userId: testUser.id,
        name: 'Payment Client',
        email: 'paymentclient@example.com',
      });
      await clientRepository.save(client);

      const invoice = invoiceRepository.create({
        userId: testUser.id,
        clientId: client.id,
        type: InvoiceType.INVOICE,
        number: 'INV-PAY',
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

      // Mock Stripe payment intent
      const mockPaymentIntent = {
        id: 'pi_test_123',
        client_secret: 'pi_test_123_secret',
        status: 'requires_payment_method',
      };
      mockStripeService.createPaymentIntent.mockResolvedValue(mockPaymentIntent);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/invoices/${invoice.id}/pay`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('clientSecret');
      expect(response.body).toHaveProperty('paymentIntentId');
      expect(response.body).toHaveProperty('amount');
      expect(response.body).toHaveProperty('currency');
      expect(response.body.amount).toBe(110);
      expect(response.body.currency).toBe('USD');
      expect(response.body.paymentIntentId).toBe('pi_test_123');

      // Verify StripeService was called with correct parameters
      expect(mockStripeService.createPaymentIntent).toHaveBeenCalledWith(
        110,
        'USD',
        expect.objectContaining({
          invoice_id: invoice.id,
          user_id: testUser.id,
          invoice_number: invoice.number,
        }),
      );

      // Verify payment record is created in database
      const payment = await paymentRepository.findOne({
        where: { invoiceId: invoice.id },
      });
      expect(payment).toBeDefined();
      expect(payment.status).toBe(PaymentStatus.PENDING);
      expect(payment.providerPaymentId).toBe('pi_test_123');

      // Verify audit log entry
      const auditLog = await auditLogRepository.findOne({
        where: { resourceId: invoice.id, action: AuditAction.UPDATE },
      });
      expect(auditLog).toBeDefined();
    });

    it('should return 400 Bad Request for already paid invoice', async () => {
      // Create test client and paid invoice
      const client = clientRepository.create({
        userId: testUser.id,
        name: 'Paid Client',
        email: 'paidclient@example.com',
      });
      await clientRepository.save(client);

      const invoice = invoiceRepository.create({
        userId: testUser.id,
        clientId: client.id,
        type: InvoiceType.INVOICE,
        number: 'INV-PAID',
        issueDate: new Date(),
        dueDate: new Date(),
        currency: 'USD',
        subtotal: 100,
        taxTotal: 10,
        discountTotal: 0,
        total: 110,
        status: InvoiceStatus.PAID,
      });
      await invoiceRepository.save(invoice);

      await request(app.getHttpServer())
        .post(`/api/v1/invoices/${invoice.id}/pay`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });

    it('should return 400 Bad Request for cancelled invoice', async () => {
      // Create test client and cancelled invoice
      const client = clientRepository.create({
        userId: testUser.id,
        name: 'Cancelled Client',
        email: 'cancelledclient@example.com',
      });
      await clientRepository.save(client);

      const invoice = invoiceRepository.create({
        userId: testUser.id,
        clientId: client.id,
        type: InvoiceType.INVOICE,
        number: 'INV-CANCELLED',
        issueDate: new Date(),
        dueDate: new Date(),
        currency: 'USD',
        subtotal: 100,
        taxTotal: 10,
        discountTotal: 0,
        total: 110,
        status: InvoiceStatus.CANCELLED,
      });
      await invoiceRepository.save(invoice);

      await request(app.getHttpServer())
        .post(`/api/v1/invoices/${invoice.id}/pay`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });

    it('should return 400 Bad Request for estimate', async () => {
      // Create test client and estimate
      const client = clientRepository.create({
        userId: testUser.id,
        name: 'Estimate Client',
        email: 'estimateclient@example.com',
      });
      await clientRepository.save(client);

      const estimate = invoiceRepository.create({
        userId: testUser.id,
        clientId: client.id,
        type: InvoiceType.ESTIMATE,
        number: 'EST-PAY',
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

      await request(app.getHttpServer())
        .post(`/api/v1/invoices/${estimate.id}/pay`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });

    it('should return 400 Bad Request for invoice with total <= 0', async () => {
      // Create test client and invoice with zero total
      const client = clientRepository.create({
        userId: testUser.id,
        name: 'Zero Client',
        email: 'zeroclient@example.com',
      });
      await clientRepository.save(client);

      const invoice = invoiceRepository.create({
        userId: testUser.id,
        clientId: client.id,
        type: InvoiceType.INVOICE,
        number: 'INV-ZERO',
        issueDate: new Date(),
        dueDate: new Date(),
        currency: 'USD',
        subtotal: 0,
        taxTotal: 0,
        discountTotal: 0,
        total: 0,
        status: InvoiceStatus.DRAFT,
      });
      await invoiceRepository.save(invoice);

      await request(app.getHttpServer())
        .post(`/api/v1/invoices/${invoice.id}/pay`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });

    it('should return 401 Unauthorized without auth token', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/invoices/some-id/pay')
        .expect(401);
    });

    it('should handle duplicate payment creation for same invoice', async () => {
      // Create test client and invoice
      const client = clientRepository.create({
        userId: testUser.id,
        name: 'Duplicate Payment Client',
        email: 'duplicatepayment@example.com',
      });
      await clientRepository.save(client);

      const invoice = invoiceRepository.create({
        userId: testUser.id,
        clientId: client.id,
        type: InvoiceType.INVOICE,
        number: 'INV-DUPLICATE',
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

      // Mock Stripe payment intent for first call
      const mockPaymentIntent1 = {
        id: 'pi_first_123',
        client_secret: 'pi_first_123_secret',
        status: 'requires_payment_method',
      };
      mockStripeService.createPaymentIntent.mockResolvedValueOnce(mockPaymentIntent1);

      // First payment intent call
      const firstResponse = await request(app.getHttpServer())
        .post(`/api/v1/invoices/${invoice.id}/pay`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(firstResponse.body.paymentIntentId).toBe('pi_first_123');

      // Verify first payment record exists with PENDING status
      const firstPayment = await paymentRepository.findOne({
        where: { invoiceId: invoice.id, providerPaymentId: 'pi_first_123' },
      });
      expect(firstPayment).toBeDefined();
      expect(firstPayment.status).toBe(PaymentStatus.PENDING);

      // Mock Stripe payment intent for second call (different payment intent ID)
      const mockPaymentIntent2 = {
        id: 'pi_second_456',
        client_secret: 'pi_second_456_secret',
        status: 'requires_payment_method',
      };
      mockStripeService.createPaymentIntent.mockResolvedValueOnce(mockPaymentIntent2);

      // Second payment intent call (while PENDING payment exists)
      const secondResponse = await request(app.getHttpServer())
        .post(`/api/v1/invoices/${invoice.id}/pay`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(secondResponse.body.paymentIntentId).toBe('pi_second_456');

      // Verify both payment records exist (current behavior: allows multiple pending payments)
      const allPayments = await paymentRepository.find({
        where: { invoiceId: invoice.id },
      });
      expect(allPayments.length).toBe(2);
      expect(allPayments.some((p) => p.providerPaymentId === 'pi_first_123')).toBe(true);
      expect(allPayments.some((p) => p.providerPaymentId === 'pi_second_456')).toBe(true);
      expect(allPayments.every((p) => p.status === PaymentStatus.PENDING)).toBe(true);
    });
  });

  describe('POST /api/v1/webhooks/stripe - Payment Success', () => {
    it('should handle payment success webhook', async () => {
      // Create test client, invoice, and payment
      const client = clientRepository.create({
        userId: testUser.id,
        name: 'Webhook Client',
        email: 'webhookclient@example.com',
      });
      await clientRepository.save(client);

      const invoice = invoiceRepository.create({
        userId: testUser.id,
        clientId: client.id,
        type: InvoiceType.INVOICE,
        number: 'INV-WEBHOOK',
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

      const payment = paymentRepository.create({
        invoiceId: invoice.id,
        providerPaymentId: 'pi_test_123',
        amount: 110,
        currency: 'USD',
        status: PaymentStatus.PENDING,
      });
      await paymentRepository.save(payment);

      // Mock webhook event
      const mockEvent = {
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test_123',
            status: 'succeeded',
            metadata: {
              invoice_id: invoice.id,
              user_id: testUser.id,
              invoice_number: invoice.number,
            },
          },
        },
      };
      mockStripeService.verifyWebhookSignature.mockReturnValue(mockEvent);

      const response = await request(app.getHttpServer())
        .post('/api/v1/webhooks/stripe')
        .set('stripe-signature', 'fake-signature')
        .send(JSON.stringify(mockEvent))
        .expect(200);

      expect(response.body).toEqual({ received: true });

      // Verify payment status is updated
      const updatedPayment = await paymentRepository.findOne({ where: { id: payment.id } });
      expect(updatedPayment.status).toBe(PaymentStatus.COMPLETED);

      // Verify invoice status is updated
      const updatedInvoice = await invoiceRepository.findOne({ where: { id: invoice.id } });
      expect(updatedInvoice.status).toBe(InvoiceStatus.PAID);

      // Verify StripeService was called
      expect(mockStripeService.verifyWebhookSignature).toHaveBeenCalled();
    });
  });

  describe('POST /api/v1/webhooks/stripe - Payment Failed', () => {
    it('should handle payment failed webhook', async () => {
      // Create test client, invoice, and payment
      const client = clientRepository.create({
        userId: testUser.id,
        name: 'Failed Client',
        email: 'failedclient@example.com',
      });
      await clientRepository.save(client);

      const invoice = invoiceRepository.create({
        userId: testUser.id,
        clientId: client.id,
        type: InvoiceType.INVOICE,
        number: 'INV-FAILED',
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

      const payment = paymentRepository.create({
        invoiceId: invoice.id,
        providerPaymentId: 'pi_test_failed',
        amount: 110,
        currency: 'USD',
        status: PaymentStatus.PENDING,
      });
      await paymentRepository.save(payment);

      // Mock webhook event
      const mockEvent = {
        type: 'payment_intent.payment_failed',
        data: {
          object: {
            id: 'pi_test_failed',
            status: 'payment_failed',
            metadata: {
              invoice_id: invoice.id,
            },
          },
        },
      };
      mockStripeService.verifyWebhookSignature.mockReturnValue(mockEvent);

      const response = await request(app.getHttpServer())
        .post('/api/v1/webhooks/stripe')
        .set('stripe-signature', 'fake-signature')
        .send(JSON.stringify(mockEvent))
        .expect(200);

      expect(response.body).toEqual({ received: true });

      // Verify payment status is updated
      const updatedPayment = await paymentRepository.findOne({ where: { id: payment.id } });
      expect(updatedPayment.status).toBe(PaymentStatus.FAILED);

      // Verify invoice status remains unchanged
      const updatedInvoice = await invoiceRepository.findOne({ where: { id: invoice.id } });
      expect(updatedInvoice.status).toBe(InvoiceStatus.DRAFT);
    });
  });

  describe('POST /api/v1/webhooks/stripe - Invalid Signature', () => {
    it('should return 400 Bad Request for invalid signature', async () => {
      mockStripeService.verifyWebhookSignature.mockImplementation(() => {
        throw new Error('Invalid signature');
      });

      await request(app.getHttpServer())
        .post('/api/v1/webhooks/stripe')
        .set('stripe-signature', 'invalid-signature')
        .send(JSON.stringify({ type: 'payment_intent.succeeded' }))
        .expect(400);
    });
  });

  describe('POST /api/v1/webhooks/stripe - Missing Signature Header', () => {
    it('should return 400 Bad Request for missing signature header', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/webhooks/stripe')
        .send(JSON.stringify({ type: 'payment_intent.succeeded' }))
        .expect(400);
    });
  });

  describe('Complete Payment Flow', () => {
    it('should complete full payment flow from intent to webhook', async () => {
      // Create test client and invoice
      const client = clientRepository.create({
        userId: testUser.id,
        name: 'Complete Client',
        email: 'completeclient@example.com',
      });
      await clientRepository.save(client);

      const invoice = invoiceRepository.create({
        userId: testUser.id,
        clientId: client.id,
        type: InvoiceType.INVOICE,
        number: 'INV-COMPLETE',
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

      // Create payment intent
      const mockPaymentIntent = {
        id: 'pi_complete_123',
        client_secret: 'pi_complete_123_secret',
        status: 'requires_payment_method',
      };
      mockStripeService.createPaymentIntent.mockResolvedValue(mockPaymentIntent);

      const intentResponse = await request(app.getHttpServer())
        .post(`/api/v1/invoices/${invoice.id}/pay`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const paymentIntentId = intentResponse.body.paymentIntentId;

      // Verify payment record exists
      const payment = await paymentRepository.findOne({
        where: { invoiceId: invoice.id },
      });
      expect(payment).toBeDefined();
      expect(payment.status).toBe(PaymentStatus.PENDING);

      // Simulate Stripe webhook for successful payment
      const mockEvent = {
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: paymentIntentId,
            status: 'succeeded',
            metadata: {
              invoice_id: invoice.id,
              user_id: testUser.id,
              invoice_number: invoice.number,
            },
          },
        },
      };
      mockStripeService.verifyWebhookSignature.mockReturnValue(mockEvent);

      await request(app.getHttpServer())
        .post('/api/v1/webhooks/stripe')
        .set('stripe-signature', 'fake-signature')
        .send(JSON.stringify(mockEvent))
        .expect(200);

      // Verify payment is completed
      const completedPayment = await paymentRepository.findOne({ where: { id: payment.id } });
      expect(completedPayment.status).toBe(PaymentStatus.COMPLETED);

      // Verify invoice is paid
      const paidInvoice = await invoiceRepository.findOne({ where: { id: invoice.id } });
      expect(paidInvoice.status).toBe(InvoiceStatus.PAID);

      // Verify invoice shows as paid when fetched
      const invoiceResponse = await request(app.getHttpServer())
        .get(`/api/v1/invoices/${invoice.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(invoiceResponse.body.status).toBe(InvoiceStatus.PAID);
    });
  });

  describe('Payment Idempotency', () => {
    it('should handle duplicate webhook events idempotently', async () => {
      // Create test client, invoice, and payment
      const client = clientRepository.create({
        userId: testUser.id,
        name: 'Idempotent Client',
        email: 'idempotentclient@example.com',
      });
      await clientRepository.save(client);

      const invoice = invoiceRepository.create({
        userId: testUser.id,
        clientId: client.id,
        type: InvoiceType.INVOICE,
        number: 'INV-IDEMPOTENT',
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

      const payment = paymentRepository.create({
        invoiceId: invoice.id,
        providerPaymentId: 'pi_idempotent_123',
        amount: 110,
        currency: 'USD',
        status: PaymentStatus.PENDING,
      });
      await paymentRepository.save(payment);

      // Mock webhook event
      const mockEvent = {
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_idempotent_123',
            status: 'succeeded',
            metadata: {
              invoice_id: invoice.id,
            },
          },
        },
      };
      mockStripeService.verifyWebhookSignature.mockReturnValue(mockEvent);

      // Send webhook event first time
      await request(app.getHttpServer())
        .post('/api/v1/webhooks/stripe')
        .set('stripe-signature', 'fake-signature')
        .send(JSON.stringify(mockEvent))
        .expect(200);

      // Verify payment is completed
      let updatedPayment = await paymentRepository.findOne({ where: { id: payment.id } });
      expect(updatedPayment.status).toBe(PaymentStatus.COMPLETED);

      // Send same webhook event again
      await request(app.getHttpServer())
        .post('/api/v1/webhooks/stripe')
        .set('stripe-signature', 'fake-signature')
        .send(JSON.stringify(mockEvent))
        .expect(200);

      // Verify payment is still completed (not duplicated)
      updatedPayment = await paymentRepository.findOne({ where: { id: payment.id } });
      expect(updatedPayment.status).toBe(PaymentStatus.COMPLETED);

      // Verify invoice status is still paid
      const updatedInvoice = await invoiceRepository.findOne({ where: { id: invoice.id } });
      expect(updatedInvoice.status).toBe(InvoiceStatus.PAID);
    });
  });
});

