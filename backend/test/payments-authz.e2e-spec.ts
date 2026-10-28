/**
 * Payment authorization and Stripe webhook handling, end to end.
 *
 * - Real AppModule, real PostgreSQL, real JWT and API-key guards.
 * - The app is bootstrapped like src/main.ts: the webhook route gets
 *   express.raw() before Nest's own body parser, and the production
 *   ValidationPipe options are used.
 * - The real StripeService verifies webhook signatures (HMAC, no network).
 *   Only createPaymentIntent/retrievePaymentIntent are replaced, so nothing
 *   ever talks to Stripe. The secret key below is a fake test-mode string.
 * - NotificationService and EmailService are recorders: nothing is sent.
 *
 * See docs/security/2026-10-25-payments-attachments.md.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, ValidationPipeOptions } from '@nestjs/common';
import * as request from 'supertest';
import * as express from 'express';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import Stripe from 'stripe';
import { AppModule } from '../src/app.module';
import { User } from '../src/entities/user.entity';
import { Client } from '../src/entities/client.entity';
import { Invoice, InvoiceType, InvoiceStatus } from '../src/entities/invoice.entity';
import { Payment, PaymentStatus } from '../src/entities/payment.entity';
import { PaymentEvent } from '../src/entities/payment-event.entity';
import { PaymentsService } from '../src/payments/payments.service';
import { StripeService } from '../src/core/services/stripe.service';
import { NotificationService } from '../src/core/services/notification.service';
import { EmailService } from '../src/core/services/email.service';
import { ApiKeysService } from '../src/api-keys/api-keys.service';

// Test-mode placeholders, never sent anywhere: createPaymentIntent is mocked.
const FAKE_STRIPE_SECRET_KEY = 'sk_test_e2eFakeKeyNeverUsedOnTheNetwork';
const WEBHOOK_SECRET = 'whsec_e2e_payments_authz_secret';

// Same options as src/main.ts
const PRODUCTION_PIPE: ValidationPipeOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
  forbidUnknownValues: true,
  validateCustomDecorators: true,
  stopAtFirstError: false,
};

const mockNotificationService = {
  notifyInvoiceOverdue: jest.fn(),
  notifyPaymentReceived: jest.fn(),
  notifyInvoiceSent: jest.fn(),
  notifyInvoicePaid: jest.fn(),
};
const mockEmailService = { sendInvoiceEmail: jest.fn(), sendEmail: jest.fn(), sendPasswordResetEmail: jest.fn() };

// Only used to sign test payloads (local HMAC; the constructor makes no request).
const signer = new Stripe(FAKE_STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });

function sign(payload: string, opts: { secret?: string; timestamp?: number } = {}): string {
  return signer.webhooks.generateTestHeaderString({
    payload,
    secret: opts.secret ?? WEBHOOK_SECRET,
    timestamp: opts.timestamp,
  });
}

let eventSeq = 0;
function paymentIntentEvent(type: string, paymentIntent: Record<string, any>): string {
  eventSeq += 1;
  return JSON.stringify({
    id: `evt_test_${eventSeq}`,
    object: 'event',
    type,
    created: Math.floor(Date.now() / 1000),
    data: { object: { object: 'payment_intent', ...paymentIntent } },
  });
}

describe('Payments authorization and Stripe webhooks (E2E)', () => {
  let app: INestApplication;
  let moduleFixture: TestingModule;
  let userRepository: Repository<User>;
  let clientRepository: Repository<Client>;
  let invoiceRepository: Repository<Invoice>;
  let paymentRepository: Repository<Payment>;
  let stripeService: StripeService;
  let apiKeysService: ApiKeysService;
  let createPaymentIntent: jest.SpyInstance;

  let userA: User;
  let userB: User;
  let tokenA: string;
  let tokenB: string;
  let clientA: Client;
  let clientB: Client;
  let invoiceA: Invoice;
  let invoiceB: Invoice;

  const savedEnv: Record<string, string | undefined> = {};
  let piSeq = 0;
  const stripeIntents = new Map<string, any>();
  const stripeCharges = new Map<string, any>();
  const stripeDisputes = new Map<string, any>();
  /** Simulated Stripe latency for intent creation (ms), so concurrency tests have a real race window. */
  let stripeLatency = 0;

  beforeAll(async () => {
    for (const k of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']) savedEnv[k] = process.env[k];
    process.env.STRIPE_SECRET_KEY = FAKE_STRIPE_SECRET_KEY;
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;

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
      .overrideProvider(NotificationService)
      .useValue(mockNotificationService)
      .overrideProvider(EmailService)
      .useValue(mockEmailService)
      .compile();

    // Bootstrap order as in src/main.ts
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.use('/api/v1/webhooks/stripe', express.raw({ type: 'application/json', limit: '1mb' }));
    app.useGlobalPipes(new ValidationPipe(PRODUCTION_PIPE));
    app.use(express.json({ limit: '10mb' }));
    app.setGlobalPrefix('api');
    await app.init();

    userRepository = moduleFixture.get(getRepositoryToken(User));
    clientRepository = moduleFixture.get(getRepositoryToken(Client));
    invoiceRepository = moduleFixture.get(getRepositoryToken(Invoice));
    paymentRepository = moduleFixture.get(getRepositoryToken(Payment));
    stripeService = moduleFixture.get(StripeService);
    apiKeysService = moduleFixture.get(ApiKeysService);

    expect(stripeService.isAvailable()).toBe(true);
    createPaymentIntent = jest
      .spyOn(stripeService, 'createPaymentIntent')
      .mockImplementation(async (amount: number, currency: string, metadata: Record<string, string>) => {
        if (stripeLatency) await new Promise((resolve) => setTimeout(resolve, stripeLatency));
        piSeq += 1;
        const id = `pi_e2e_${piSeq}`;
        const intent = {
          id,
          object: 'payment_intent',
          client_secret: `${id}_secret_e2e`,
          status: 'requires_payment_method',
          amount: Math.round(amount * 100),
          currency: currency.toLowerCase(),
          metadata,
        };
        stripeIntents.set(id, intent);
        return { ...intent } as any;
      });
    // An in-memory stand-in for Stripe's own records: intents created above
    // can be retrieved and cancelled; tests set their status.
    jest.spyOn(stripeService, 'retrievePaymentIntent').mockImplementation(async (id: string) => {
      const intent = stripeIntents.get(id);
      if (!intent) throw new Error(`No such payment_intent: ${id}`);
      return { ...intent } as any;
    });
    jest.spyOn(stripeService, 'retrieveCharge').mockImplementation(async (id: string) => {
      if (!stripeCharges.has(id)) throw new Error(`No such charge: ${id}`);
      return { ...stripeCharges.get(id) } as any;
    });
    jest.spyOn(stripeService, 'retrieveDispute').mockImplementation(async (id: string) => {
      if (!stripeDisputes.has(id)) throw new Error(`No such dispute: ${id}`);
      return { ...stripeDisputes.get(id) } as any;
    });
    jest.spyOn(stripeService, 'cancelPaymentIntent').mockImplementation(async (id: string) => {
      const intent = stripeIntents.get(id);
      intent.status = 'canceled';
      return { ...intent } as any;
    });
  });

  afterAll(async () => {
    await app.close();
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  beforeEach(async () => {
    const ds = userRepository.manager.connection;
    await ds.query(
      'TRUNCATE TABLE ' + ds.entityMetadatas.map((m) => `"${m.tableName}"`).join(', ') + ' RESTART IDENTITY CASCADE',
    );
    jest.clearAllMocks();
    stripeIntents.clear();
    stripeCharges.clear();
    stripeDisputes.clear();

    const passwordHash = await bcrypt.hash('password123', 4);
    userA = await userRepository.save(
      userRepository.create({ email: 'payer-a@example.test', passwordHash, name: 'Owner A' }),
    );
    userB = await userRepository.save(
      userRepository.create({ email: 'payer-b@example.test', passwordHash, name: 'Owner B' }),
    );
    const jwt = moduleFixture.get(JwtService);
    const secret = moduleFixture.get(ConfigService).get('JWT_SECRET');
    tokenA = jwt.sign({ sub: userA.id, email: userA.email }, { secret, expiresIn: '15m' });
    tokenB = jwt.sign({ sub: userB.id, email: userB.email }, { secret, expiresIn: '15m' });

    clientA = await clientRepository.save(
      clientRepository.create({ userId: userA.id, name: 'Client of A', email: 'client-a@example.test' }),
    );
    clientB = await clientRepository.save(
      clientRepository.create({ userId: userB.id, name: 'Client of B', email: 'client-b@example.test' }),
    );
    invoiceA = await makeInvoice(userA, clientA, 'A-0001');
    invoiceB = await makeInvoice(userB, clientB, 'B-0001');
  });

  async function makeInvoice(owner: User, client: Client, number: string, total = 110): Promise<Invoice> {
    return invoiceRepository.save(
      invoiceRepository.create({
        userId: owner.id,
        clientId: client.id,
        type: InvoiceType.INVOICE,
        number,
        issueDate: new Date(),
        dueDate: new Date(),
        currency: 'USD',
        subtotal: total,
        taxTotal: 0,
        discountTotal: 0,
        total,
        status: InvoiceStatus.SENT,
      }),
    );
  }

  /** Creates a payment through the real route, as the owner's app does. */
  async function pay(invoice: Invoice, token: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/invoices/${invoice.id}/pay`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body.paymentIntentId;
  }

  function succeededIntent(id: string, invoice: Invoice, owner: User, overrides: Record<string, any> = {}) {
    return {
      id,
      status: 'succeeded',
      amount: 11000,
      amount_received: 11000,
      currency: 'usd',
      metadata: { invoice_id: invoice.id, user_id: owner.id, invoice_number: invoice.number },
      ...overrides,
    };
  }

  function postWebhook(payload: string, signature = sign(payload)) {
    return request(app.getHttpServer())
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(payload);
  }

  async function statusOf(invoice: Invoice): Promise<InvoiceStatus> {
    return (await invoiceRepository.findOneByOrFail({ id: invoice.id })).status;
  }

  describe('POST /api/v1/invoices/:id/pay', () => {
    it("refuses to create a payment for another user's invoice; the owner can", async () => {
      const denied = await request(app.getHttpServer())
        .post(`/api/v1/invoices/${invoiceB.id}/pay`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(denied.status).toBe(404);
      expect(createPaymentIntent).not.toHaveBeenCalled();
      expect(await paymentRepository.countBy({ invoiceId: invoiceB.id })).toBe(0);

      // Positive control: the owner
      await pay(invoiceB, tokenB);
      expect(createPaymentIntent).toHaveBeenCalledTimes(1);
      expect(await paymentRepository.countBy({ invoiceId: invoiceB.id })).toBe(1);
    });

    it('ignores owner, invoice and amount fields supplied in the body or query', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/invoices/${invoiceA.id}/pay?invoiceId=${invoiceB.id}&userId=${userB.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ invoiceId: invoiceB.id, userId: userB.id, amount: 1, currency: 'EUR' })
        .expect(200);

      expect(createPaymentIntent).toHaveBeenCalledWith(
        110,
        'USD',
        { invoice_id: invoiceA.id, user_id: userA.id, invoice_number: 'A-0001' },
        `invoiceme-pay-${invoiceA.id}-1-11000-usd`,
      );
      const payments = await paymentRepository.find();
      expect(payments).toHaveLength(1);
      expect(payments[0]).toMatchObject({ invoiceId: invoiceA.id, providerPaymentId: res.body.paymentIntentId });
      expect(Number(payments[0].amount)).toBe(110);
      expect(payments[0].currency).toBe('USD');
    });

    it('requires write:invoices for API keys; JWT, full-access and write keys still work', async () => {
      const { key: readOnlyKey } = await apiKeysService.generateApiKey(userA.id, 'read only', ['read:invoices']);
      const { key: writeKey } = await apiKeysService.generateApiKey(userA.id, 'writer', ['write:invoices']);
      const { key: allKey } = await apiKeysService.generateApiKey(userA.id, 'full access', ['*']);
      const { key: emptyKey } = await apiKeysService.generateApiKey(userA.id, 'no permissions', []);

      const denied = await request(app.getHttpServer())
        .post(`/api/v1/invoices/${invoiceA.id}/pay`)
        .set('X-API-Key', readOnlyKey);
      expect(denied.status).toBe(403);
      expect(denied.body.message).toContain('API key does not have required permission: write:invoices');
      expect(createPaymentIntent).not.toHaveBeenCalled();
      expect(await paymentRepository.count()).toBe(0);

      // A key with no permissions has no access
      await request(app.getHttpServer()).post(`/api/v1/invoices/${invoiceA.id}/pay`).set('X-API-Key', emptyKey).expect(403);
      expect(createPaymentIntent).not.toHaveBeenCalled();

      // The read-only key is otherwise valid
      await request(app.getHttpServer()).get(`/api/v1/invoices/${invoiceA.id}`).set('X-API-Key', readOnlyKey).expect(200);

      // Positive controls
      await request(app.getHttpServer()).post(`/api/v1/invoices/${invoiceA.id}/pay`).set('X-API-Key', writeKey).expect(200);
      await request(app.getHttpServer()).post(`/api/v1/invoices/${invoiceA.id}/pay`).set('X-API-Key', allKey).expect(200);
      await pay(invoiceA, tokenA);
      // One open attempt for the unchanged invoice, reused by every caller
      expect(await paymentRepository.count()).toBe(1);
      expect(createPaymentIntent).toHaveBeenCalledTimes(1);

      // A permitted key still cannot reach another user's invoice
      await request(app.getHttpServer()).post(`/api/v1/invoices/${invoiceB.id}/pay`).set('X-API-Key', allKey).expect(404);
      expect(await paymentRepository.countBy({ invoiceId: invoiceB.id })).toBe(0);
    });
  });

  describe('currencies and stored secrets', () => {
    it('refuses online payment in a currency the flow cannot convert; the same invoice in USD can be paid', async () => {
      await invoiceRepository.update({ id: invoiceA.id }, { currency: 'JPY' });
      const refused = await request(app.getHttpServer()).post(`/api/v1/invoices/${invoiceA.id}/pay`).set('Authorization', `Bearer ${tokenA}`);
      expect(refused.status).toBe(400);
      expect(refused.body.message).toBe('Online payment is not available for JPY. Supported: USD, EUR, GBP, CAD, AUD.');
      expect(createPaymentIntent).not.toHaveBeenCalled();
      expect(await paymentRepository.count()).toBe(0);

      // Positive control: same invoice, same caller, two-decimal currency
      await invoiceRepository.update({ id: invoiceA.id }, { currency: 'usd' });
      await pay(invoiceA, tokenA);
      expect(createPaymentIntent).toHaveBeenCalledTimes(1);
    });

    it('StripeService refuses an unsupported currency even if a caller skips the route check', async () => {
      // The real method (the instance is spied on), before any Stripe call
      const real = StripeService.prototype.createPaymentIntent.bind(stripeService);
      await expect(real(1000, 'JPY', {})).rejects.toThrow('Online payment is not available for JPY');
    });

    it('returns client_secret to the caller but never stores it', async () => {
      const res = await request(app.getHttpServer()).post(`/api/v1/invoices/${invoiceA.id}/pay`).set('Authorization', `Bearer ${tokenA}`).expect(200);
      expect(res.body.clientSecret).toBe(`${res.body.paymentIntentId}_secret_e2e`);
      const created = await paymentRepository.findOneByOrFail({ providerPaymentId: res.body.paymentIntentId });
      expect(created.metadataJson).toEqual({ payment_intent_id: res.body.paymentIntentId, status: 'requires_payment_method' });

      // The webhook's PaymentIntent carries client_secret too; it is dropped
      const intent = succeededIntent(res.body.paymentIntentId, invoiceA, userA, { client_secret: 'pi_secret_from_stripe' });
      await postWebhook(paymentIntentEvent('payment_intent.succeeded', intent)).expect(200);
      const completed = await paymentRepository.findOneByOrFail({ providerPaymentId: res.body.paymentIntentId });
      expect(completed.status).toBe(PaymentStatus.COMPLETED);
      expect(JSON.stringify(completed.metadataJson)).not.toContain('secret');
      expect(completed.metadataJson).toMatchObject({ id: res.body.paymentIntentId, status: 'succeeded', amount_received: 11000 });
    });
  });

  describe('POST /api/v1/webhooks/stripe', () => {
    it("marks only the paying owner's invoice paid and notifies only that owner", async () => {
      const piA = await pay(invoiceA, tokenA);
      await pay(invoiceB, tokenB);

      const res = await postWebhook(paymentIntentEvent('payment_intent.succeeded', succeededIntent(piA, invoiceA, userA)));
      expect(res.body).toEqual({ received: true });
      expect(res.status).toBe(200);

      expect(await statusOf(invoiceA)).toBe(InvoiceStatus.PAID);
      expect(await statusOf(invoiceB)).toBe(InvoiceStatus.SENT);
      expect((await paymentRepository.findOneByOrFail({ providerPaymentId: piA })).status).toBe(PaymentStatus.COMPLETED);
      expect(mockNotificationService.notifyPaymentReceived).toHaveBeenCalledTimes(1);
      expect(mockNotificationService.notifyPaymentReceived).toHaveBeenCalledWith(
        expect.objectContaining({ userEmail: userA.email, invoiceId: invoiceA.id, clientName: 'Client of A' }),
      );
    });

    it('rejects a wrong secret, a tampered body and a stale signature; a valid one is accepted', async () => {
      const piA = await pay(invoiceA, tokenA);
      const payload = paymentIntentEvent('payment_intent.succeeded', succeededIntent(piA, invoiceA, userA));

      const wrongSecret = await postWebhook(payload, sign(payload, { secret: 'whsec_attacker' }));
      const tampered = await postWebhook(payload.replace('"amount_received":11000', '"amount_received":11001'), sign(payload));
      const stale = await postWebhook(payload, sign(payload, { timestamp: Math.floor(Date.now() / 1000) - 600 }));
      const missing = await request(app.getHttpServer())
        .post('/api/v1/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .send(payload);

      for (const res of [wrongSecret, tampered, stale]) {
        expect(res.status).toBe(400);
        // Blocked by signature verification, not by a body-parsing problem
        expect(res.body.message).toMatch(/signature/i);
      }
      expect(missing.status).toBe(400);
      expect(missing.body.message).toMatch(/stripe-signature/);
      expect(await statusOf(invoiceA)).toBe(InvoiceStatus.SENT);
      expect(mockNotificationService.notifyPaymentReceived).not.toHaveBeenCalled();

      // Positive control: the same payload, correctly signed now
      await postWebhook(payload).expect(200);
      expect(await statusOf(invoiceA)).toBe(InvoiceStatus.PAID);
    });

    it('applies a redelivered event once (one notification)', async () => {
      const piA = await pay(invoiceA, tokenA);
      const payload = paymentIntentEvent('payment_intent.succeeded', succeededIntent(piA, invoiceA, userA));

      await postWebhook(payload).expect(200);
      await postWebhook(payload).expect(200); // Stripe retries re-sign with a fresh timestamp

      expect(await statusOf(invoiceA)).toBe(InvoiceStatus.PAID);
      expect(mockNotificationService.notifyPaymentReceived).toHaveBeenCalledTimes(1);
    });

    it('does not let a late payment_failed downgrade a completed payment', async () => {
      const piA = await pay(invoiceA, tokenA);
      const failedFirst = paymentIntentEvent('payment_intent.payment_failed', {
        ...succeededIntent(piA, invoiceA, userA),
        status: 'requires_payment_method',
        amount_received: 0,
      });

      // Positive control: a failure on a pending payment is recorded
      await postWebhook(failedFirst).expect(200);
      expect((await paymentRepository.findOneByOrFail({ providerPaymentId: piA })).status).toBe(PaymentStatus.FAILED);

      await postWebhook(paymentIntentEvent('payment_intent.succeeded', succeededIntent(piA, invoiceA, userA))).expect(200);
      expect((await paymentRepository.findOneByOrFail({ providerPaymentId: piA })).status).toBe(PaymentStatus.COMPLETED);

      // Stripe does not guarantee order: the earlier failure arrives again
      await postWebhook(failedFirst).expect(200);
      expect((await paymentRepository.findOneByOrFail({ providerPaymentId: piA })).status).toBe(PaymentStatus.COMPLETED);
      expect(await statusOf(invoiceA)).toBe(InvoiceStatus.PAID);
    });

    it('does not mark an invoice paid when the received amount does not cover its current total', async () => {
      const piA = await pay(invoiceA, tokenA); // created for 110.00
      // The owner raises the total after the payment sheet was opened
      await invoiceRepository.update({ id: invoiceA.id }, { total: 250, subtotal: 250 });

      await postWebhook(paymentIntentEvent('payment_intent.succeeded', succeededIntent(piA, invoiceA, userA))).expect(200);

      const payment = await paymentRepository.findOneByOrFail({ providerPaymentId: piA });
      expect(payment.status).toBe(PaymentStatus.COMPLETED);
      expect(Number(payment.amount)).toBe(110);
      expect(await statusOf(invoiceA)).toBe(InvoiceStatus.SENT);
      // The detail view (which recomputes status from payments) agrees
      const detail = await request(app.getHttpServer())
        .get(`/api/v1/invoices/${invoiceA.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(detail.body.status).toBe(InvoiceStatus.SENT);
      expect(mockNotificationService.notifyPaymentReceived).not.toHaveBeenCalled();

      // Positive control: a second payment covering the rest marks it paid
      const piRest = await pay(invoiceA, tokenA);
      await paymentRepository.update({ providerPaymentId: piRest }, { amount: 140 });
      await postWebhook(
        paymentIntentEvent('payment_intent.succeeded', succeededIntent(piRest, invoiceA, userA, { amount: 14000, amount_received: 14000 })),
      ).expect(200);
      expect(await statusOf(invoiceA)).toBe(InvoiceStatus.PAID);
    });

    it('records the amount Stripe actually received, not the amount requested', async () => {
      const piA = await pay(invoiceA, tokenA);

      await postWebhook(
        paymentIntentEvent('payment_intent.succeeded', succeededIntent(piA, invoiceA, userA, { amount_received: 5000 })),
      ).expect(200);

      const payment = await paymentRepository.findOneByOrFail({ providerPaymentId: piA });
      expect(Number(payment.amount)).toBe(50);
      expect(await statusOf(invoiceA)).toBe(InvoiceStatus.SENT);
      await request(app.getHttpServer()).get(`/api/v1/invoices/${invoiceA.id}`).set('Authorization', `Bearer ${tokenA}`).expect(200);
      expect(await statusOf(invoiceA)).toBe(InvoiceStatus.SENT);
    });

    it('does not count a payment in another currency', async () => {
      const piA = await pay(invoiceA, tokenA);

      await postWebhook(
        paymentIntentEvent('payment_intent.succeeded', succeededIntent(piA, invoiceA, userA, { currency: 'eur' })),
      ).expect(200);

      const payment = await paymentRepository.findOneByOrFail({ providerPaymentId: piA });
      expect(payment.status).toBe(PaymentStatus.PENDING);
      expect(payment.metadataJson.review_required).toMatchObject({ reason: 'currency_mismatch' });
      expect(await statusOf(invoiceA)).toBe(InvoiceStatus.SENT);
    });

    it('the detail view does not count a payment made before the invoice currency changed', async () => {
      const piA = await pay(invoiceA, tokenA); // USD 110.00
      await invoiceRepository.update({ id: invoiceA.id }, { currency: 'EUR' });

      await postWebhook(paymentIntentEvent('payment_intent.succeeded', succeededIntent(piA, invoiceA, userA))).expect(200);
      expect((await paymentRepository.findOneByOrFail({ providerPaymentId: piA })).status).toBe(PaymentStatus.COMPLETED);
      expect(await statusOf(invoiceA)).toBe(InvoiceStatus.SENT);

      // GET /invoices/:id recomputes status from payments; it must agree
      await request(app.getHttpServer()).get(`/api/v1/invoices/${invoiceA.id}`).set('Authorization', `Bearer ${tokenA}`).expect(200);
      expect(await statusOf(invoiceA)).toBe(InvoiceStatus.SENT);

      // Positive control: back in USD, the same payment covers it
      await invoiceRepository.update({ id: invoiceA.id }, { currency: 'USD' });
      await request(app.getHttpServer()).get(`/api/v1/invoices/${invoiceA.id}`).set('Authorization', `Bearer ${tokenA}`).expect(200);
      expect(await statusOf(invoiceA)).toBe(InvoiceStatus.PAID);
    });

    it('ignores an event whose metadata names a different invoice than the stored payment', async () => {
      const piA = await pay(invoiceA, tokenA);

      await postWebhook(
        paymentIntentEvent(
          'payment_intent.succeeded',
          succeededIntent(piA, invoiceA, userA, { metadata: { invoice_id: invoiceB.id, user_id: userB.id } }),
        ),
      ).expect(200);

      expect(await statusOf(invoiceA)).toBe(InvoiceStatus.SENT);
      expect(await statusOf(invoiceB)).toBe(InvoiceStatus.SENT);
      expect((await paymentRepository.findOneByOrFail({ providerPaymentId: piA })).status).toBe(PaymentStatus.PENDING);
      expect(mockNotificationService.notifyPaymentReceived).not.toHaveBeenCalled();
    });

    it('acknowledges a correctly signed event for an unknown payment intent without changing anything', async () => {
      await pay(invoiceA, tokenA);
      const res = await postWebhook(
        paymentIntentEvent('payment_intent.succeeded', succeededIntent('pi_not_from_invoiceme', invoiceA, userA)),
      );
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ received: true });
      expect(await statusOf(invoiceA)).toBe(InvoiceStatus.SENT);
      expect(await paymentRepository.countBy({ status: PaymentStatus.PENDING })).toBe(1);
    });

    it("does not disclose another user's client through a legacy cross-owner invoice", async () => {
      // Malformed legacy row: A's invoice points at B's client (see historical-cross-owner report)
      const legacy = await invoiceRepository.save(
        invoiceRepository.create({ ...invoiceA, id: undefined, number: 'A-LEGACY', clientId: clientB.id, client: undefined }),
      );
      const payment = await paymentRepository.save(
        paymentRepository.create({
          invoiceId: legacy.id,
          providerPaymentId: 'pi_legacy',
          amount: 110,
          currency: 'USD',
          status: PaymentStatus.PENDING,
        }),
      );

      await postWebhook(paymentIntentEvent('payment_intent.succeeded', succeededIntent(payment.providerPaymentId, legacy, userA))).expect(200);

      expect(mockNotificationService.notifyPaymentReceived).toHaveBeenCalledTimes(1);
      const sent = mockNotificationService.notifyPaymentReceived.mock.calls[0][0];
      expect(sent.userEmail).toBe(userA.email);
      expect(JSON.stringify(sent)).not.toContain('Client of B');
      expect(JSON.stringify(sent)).not.toContain('client-b@example.test');
    });
  });

  describe('refunds, disputes and invoice payment state', () => {
    const PaymentEventRepo = () => moduleFixture.get(getRepositoryToken(PaymentEvent));
    let evt = 0;
    const event = (type: string, object: Record<string, any>, id = `evt_state_${++evt}`) =>
      JSON.stringify({ id, object: 'event', type, created: Math.floor(Date.now() / 1000), data: { object } });
    const summary = async (invoice: Invoice, token = tokenA) =>
      (await request(app.getHttpServer()).get(`/api/v1/invoices/${invoice.id}`).set('Authorization', `Bearer ${token}`).expect(200)).body;

    /** A paid invoice: /pay, then a signed succeeded webhook; returns the intent and its charge id. */
    async function paidInvoice() {
      const pi = await pay(invoiceA, tokenA);
      await postWebhook(paymentIntentEvent('payment_intent.succeeded', succeededIntent(pi, invoiceA, userA))).expect(200);
      expect((await invoiceRepository.findOneByOrFail({ id: invoiceA.id })).status).toBe(InvoiceStatus.PAID);
      const charge = `ch_${pi}`;
      stripeCharges.set(charge, { id: charge, payment_intent: pi, amount: 11000, amount_refunded: 0, currency: 'usd' });
      return { pi, charge };
    }
    const refund = (charge: string, cents: number) => {
      stripeCharges.get(charge).amount_refunded = cents;
      return postWebhook(event('charge.refunded', { id: charge, object: 'charge' }));
    };

    it('a partial refund is recorded; the invoice stays paid and nothing new is owed', async () => {
      const { charge } = await paidInvoice();
      await refund(charge, 3000).expect(200);

      const body = await summary(invoiceA);
      expect(body.status).toBe(InvoiceStatus.PAID);
      expect(body.paymentSummary).toEqual({
        currency: 'USD', grossPaid: '110.00', refunded: '30.00', disputed: '0.00', net: '80.00',
        state: 'partially_refunded', canReopen: true,
      });
      const [payment] = await paymentRepository.find();
      expect(payment).toMatchObject({ status: PaymentStatus.COMPLETED, providerChargeId: charge });
      expect(Number(payment.refundedAmount)).toBe(30);
    });

    it('a full refund shows as refunded; reads never flip it back or reopen it', async () => {
      const { charge } = await paidInvoice();
      await refund(charge, 11000).expect(200);
      for (let i = 0; i < 2; i++) {
        const body = await summary(invoiceA);
        expect(body.status).toBe(InvoiceStatus.PAID);
        expect(body.paymentSummary).toMatchObject({ state: 'refunded', net: '0.00', grossPaid: '110.00', refunded: '110.00' });
      }
    });

    it('duplicate and out-of-order refund events cannot move the state backwards', async () => {
      const { charge } = await paidInvoice();
      const older = event('charge.refunded', { id: charge, object: 'charge' }, 'evt_refund_older');
      stripeCharges.get(charge).amount_refunded = 5000; // Stripe's current state
      await postWebhook(event('charge.refunded', { id: charge }, 'evt_refund_newer')).expect(200);
      await postWebhook(event('charge.refunded', { id: charge }, 'evt_refund_newer')).expect(200); // redelivery
      await postWebhook(older).expect(200); // an older event arriving late: state is read back, not taken from it
      expect(Number((await paymentRepository.find())[0].refundedAmount)).toBe(50);
      const outcomes = (await PaymentEventRepo().find({ order: { receivedAt: 'ASC' } })).map((e: any) => e.outcome);
      expect(outcomes).toEqual(['applied', 'applied', 'duplicate']);
    });

    it('a refund that arrives before the success event keeps the invoice from being marked paid', async () => {
      const pi = await pay(invoiceA, tokenA);
      const charge = `ch_${pi}`;
      stripeCharges.set(charge, { id: charge, payment_intent: pi, amount: 11000, amount_refunded: 11000, currency: 'usd' });
      await postWebhook(event('charge.refunded', { id: charge })).expect(200);
      await postWebhook(paymentIntentEvent('payment_intent.succeeded', succeededIntent(pi, invoiceA, userA))).expect(200);
      const body = await summary(invoiceA);
      expect(body.status).toBe(InvoiceStatus.SENT);
      expect(body.paymentSummary.state).toBe('refunded');
    });

    it('a refund in another currency or above the payment is flagged, not applied', async () => {
      const { charge } = await paidInvoice();
      stripeCharges.get(charge).currency = 'eur';
      await refund(charge, 1000).expect(200);
      stripeCharges.get(charge).currency = 'usd';
      await refund(charge, 99999).expect(200);
      expect(Number((await paymentRepository.find())[0].refundedAmount)).toBe(0);
      const refunds = (await PaymentEventRepo().find()).filter((e: any) => e.type === 'charge.refunded');
      expect(refunds.map((e: any) => e.outcome)).toEqual(['mismatch', 'mismatch']);
    });

    it('disputes: open shows as disputed, won returns to paid, lost stays visible; outcomes recorded', async () => {
      const { pi } = await paidInvoice();
      stripeDisputes.set('dp_1', { id: 'dp_1', payment_intent: pi, charge: `ch_${pi}`, amount: 11000, currency: 'usd', status: 'needs_response' });
      await postWebhook(event('charge.dispute.created', { id: 'dp_1', object: 'dispute' })).expect(200);
      expect((await summary(invoiceA)).paymentSummary).toMatchObject({ state: 'disputed', disputed: '110.00', net: '0.00' });

      stripeDisputes.get('dp_1').status = 'won';
      await postWebhook(event('charge.dispute.closed', { id: 'dp_1' })).expect(200);
      expect((await summary(invoiceA)).paymentSummary).toMatchObject({ state: 'paid', net: '110.00' });

      stripeDisputes.get('dp_1').status = 'lost';
      await postWebhook(event('charge.dispute.updated', { id: 'dp_1' })).expect(200);
      const body = await summary(invoiceA);
      expect(body.status).toBe(InvoiceStatus.PAID);
      expect(body.paymentSummary).toMatchObject({ state: 'dispute_lost', net: '0.00' });

      const history = await request(app.getHttpServer()).get(`/api/v1/invoices/${invoiceA.id}/payments`).set('Authorization', `Bearer ${tokenA}`).expect(200);
      expect(history.body.payments[0].events.map((e: any) => e.details.status).filter(Boolean)).toEqual(['succeeded', 'needs_response', 'won', 'lost']);
      expect(JSON.stringify(history.body)).not.toContain('secret');
    });

    it('reopening waits for an open dispute to be decided', async () => {
      const { pi, charge } = await paidInvoice();
      await refund(charge, 1000).expect(200);
      stripeDisputes.set('dp_open', { id: 'dp_open', payment_intent: pi, charge, amount: 10000, currency: 'usd', status: 'needs_response' });
      await postWebhook(event('charge.dispute.created', { id: 'dp_open' })).expect(200);
      expect((await summary(invoiceA)).paymentSummary).toMatchObject({ state: 'disputed', canReopen: false });
      await request(app.getHttpServer()).post(`/api/v1/invoices/${invoiceA.id}/reopen`).set('Authorization', `Bearer ${tokenA}`).expect(409);

      // Positive control: once lost, the owner may reopen
      stripeDisputes.get('dp_open').status = 'lost';
      await postWebhook(event('charge.dispute.closed', { id: 'dp_open' })).expect(200);
      expect((await summary(invoiceA)).paymentSummary).toMatchObject({ state: 'dispute_lost', canReopen: true });
      await request(app.getHttpServer()).post(`/api/v1/invoices/${invoiceA.id}/reopen`).set('Authorization', `Bearer ${tokenA}`).expect(200);
    });

    it('a dispute or refund for an intent this server did not create is recorded as unknown', async () => {
      stripeCharges.set('ch_x', { id: 'ch_x', payment_intent: 'pi_elsewhere', amount_refunded: 100, currency: 'usd' });
      await postWebhook(event('charge.refunded', { id: 'ch_x' })).expect(200);
      expect((await PaymentEventRepo().find())[0].outcome).toBe('unknown_payment');
      expect(await paymentRepository.count()).toBe(0);
    });

    it('reopening is an explicit owner action, then only the amount still due is charged', async () => {
      const { charge } = await paidInvoice();
      // Fully covered: nothing to reopen
      await request(app.getHttpServer()).post(`/api/v1/invoices/${invoiceA.id}/reopen`).set('Authorization', `Bearer ${tokenA}`).expect(409);

      await refund(charge, 3000).expect(200);
      await request(app.getHttpServer()).post(`/api/v1/invoices/${invoiceA.id}/reopen`).set('Authorization', `Bearer ${tokenB}`).expect(404);
      const { key: readKey } = await apiKeysService.generateApiKey(userA.id, 'reader', ['read:invoices']);
      await request(app.getHttpServer()).post(`/api/v1/invoices/${invoiceA.id}/reopen`).set('X-API-Key', readKey).expect(403);
      expect((await invoiceRepository.findOneByOrFail({ id: invoiceA.id })).status).toBe(InvoiceStatus.PAID);

      const reopened = await request(app.getHttpServer()).post(`/api/v1/invoices/${invoiceA.id}/reopen`).set('Authorization', `Bearer ${tokenA}`).expect(200);
      expect([InvoiceStatus.SENT, InvoiceStatus.OVERDUE]).toContain(reopened.body.status);
      // A read does not mark it paid again from the old, partly refunded payment
      expect((await summary(invoiceA)).status).toBe(reopened.body.status);

      createPaymentIntent.mockClear();
      const due = await request(app.getHttpServer()).post(`/api/v1/invoices/${invoiceA.id}/pay`).set('Authorization', `Bearer ${tokenA}`).expect(200);
      expect(due.body).toMatchObject({ amount: '30.00', currency: 'USD', reused: false });
      expect(createPaymentIntent.mock.calls[0][0]).toBe(30);
      await request(app.getHttpServer()).post(`/api/v1/invoices/${invoiceA.id}/reopen`).set('Authorization', `Bearer ${tokenA}`).expect(400);
    });
  });

  describe('checkout attempts', () => {
    const payRaw = (invoice: Invoice, token = tokenA) =>
      request(app.getHttpServer()).post(`/api/v1/invoices/${invoice.id}/pay`).set('Authorization', `Bearer ${token}`);

    it('concurrent checkouts of one invoice create one attempt; all callers get it', async () => {
      stripeLatency = 150;
      const results = await Promise.all([payRaw(invoiceA), payRaw(invoiceA), payRaw(invoiceA)]).finally(() => {
        stripeLatency = 0;
      });
      expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
      expect(new Set(results.map((r) => r.body.paymentIntentId)).size).toBe(1);
      expect(createPaymentIntent).toHaveBeenCalledTimes(1);
      expect(await paymentRepository.count()).toBe(1);
    });

    it('a changed amount retires the old attempt at Stripe and creates a new one', async () => {
      const first = (await payRaw(invoiceA).expect(200)).body.paymentIntentId;
      await invoiceRepository.update({ id: invoiceA.id }, { total: 120 });
      const second = (await payRaw(invoiceA).expect(200)).body;
      expect(second.paymentIntentId).not.toBe(first);
      expect(second.amount).toBe('120.00');
      expect(stripeIntents.get(first).status).toBe('canceled');
      const statuses = (await paymentRepository.find({ order: { createdAt: 'ASC' } })).map((p) => p.status);
      expect(statuses).toEqual([PaymentStatus.FAILED, PaymentStatus.PENDING]);
    });

    it.each([
      ['succeeded (webhook not yet received)', 'succeeded', 409],
      ['processing', 'processing', 409],
    ])('never starts a second charge while the attempt is %s', async (_label, status, code) => {
      const first = (await payRaw(invoiceA).expect(200)).body.paymentIntentId;
      stripeIntents.get(first).status = status;
      await payRaw(invoiceA).expect(code);
      expect(createPaymentIntent).toHaveBeenCalledTimes(1);
    });

    it('a cancelled or failed attempt allows a new one', async () => {
      const first = (await payRaw(invoiceA).expect(200)).body.paymentIntentId;
      stripeIntents.get(first).status = 'canceled';
      const second = (await payRaw(invoiceA).expect(200)).body.paymentIntentId;
      expect(second).not.toBe(first);
    });

    it("never returns another invoice's intent or secret", async () => {
      const own = (await payRaw(invoiceA).expect(200)).body.paymentIntentId;
      // A stored attempt whose Stripe intent names another invoice (data damage): retired, not handed out
      stripeIntents.get(own).metadata = { invoice_id: invoiceB.id };
      const next = (await payRaw(invoiceA).expect(200)).body;
      expect(next.paymentIntentId).not.toBe(own);
      expect(next.clientSecret).toBe(`${next.paymentIntentId}_secret_e2e`);
      await payRaw(invoiceA, tokenB).expect(404);
    });

    it('re-reads the invoice under the lock: one paid in the meantime is not charged', async () => {
      const stale = await invoiceRepository.findOneByOrFail({ id: invoiceA.id }); // loaded as sent
      await invoiceRepository.update({ id: invoiceA.id }, { status: InvoiceStatus.PAID });
      await expect(moduleFixture.get(PaymentsService).startCheckout(stale)).rejects.toThrow('Invoice is already paid');
      expect(createPaymentIntent).not.toHaveBeenCalled();
      // Positive control: back to sent, the same call starts a checkout
      await invoiceRepository.update({ id: invoiceA.id }, { status: InvoiceStatus.SENT });
      await expect(moduleFixture.get(PaymentsService).startCheckout(stale)).resolves.toMatchObject({ reused: false });
    });

    it('a paid invoice is not charged again; a Stripe check failure stops rather than risks a duplicate', async () => {
      const first = (await payRaw(invoiceA).expect(200)).body.paymentIntentId;
      stripeIntents.delete(first); // retrieval fails
      await payRaw(invoiceA).expect(503);
      expect(createPaymentIntent).toHaveBeenCalledTimes(1);
      await invoiceRepository.update({ id: invoiceA.id }, { status: InvoiceStatus.PAID });
      await payRaw(invoiceA).expect(400);
    });
  });
});
