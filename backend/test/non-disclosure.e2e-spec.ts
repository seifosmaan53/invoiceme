/**
 * Non-disclosing responses: for a record the caller does not own, every
 * endpoint must answer exactly like for an id that does not exist (same
 * status, same body apart from the echoed path/timestamp), so the response
 * does not reveal that the record exists. Each group has a positive control:
 * the owner gets the record, and the other user's attempt did not change it.
 *
 * Real AppModule + PostgreSQL, synthetic users, GlobalExceptionFilter as in
 * main.ts. Email/PDF/S3 are never reached: denied requests stop at the
 * ownership lookup, and the owner controls use routes that touch none of them.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { randomUUID, randomBytes } from 'crypto';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/core/filters/global-exception.filter';
import { User } from '../src/entities/user.entity';
import { Client } from '../src/entities/client.entity';
import { Invoice } from '../src/entities/invoice.entity';
import { InvoiceTemplate } from '../src/entities/invoice-template.entity';
import { ApiKey } from '../src/entities/api-key.entity';
import { listenForTests } from './listen';

type Method = 'get' | 'post' | 'patch' | 'delete';

describe('Non-disclosing responses for records of another user (E2E)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let owner: User;
  let other: User;
  let ownerToken: string;
  let otherToken: string;
  let client: Client;
  let invoice: Invoice;
  let template: InvoiceTemplate;
  let apiKey: ApiKey;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.test', '.env'] }), AppModule],
    })
      .overrideModule(TypeOrmModule)
      .useModule(
        TypeOrmModule.forRootAsync({
          imports: [ConfigModule],
          useFactory: (c: ConfigService) => ({
            type: 'postgres',
            host: c.get('DB_TEST_HOST') || c.get('DB_HOST'),
            port: c.get('DB_TEST_PORT') || c.get('DB_PORT'),
            username: c.get('DB_TEST_USERNAME') || c.get('DB_USERNAME'),
            password: c.get('DB_TEST_PASSWORD') || c.get('DB_PASSWORD'),
            database: c.get('DB_TEST_DATABASE') || c.get('DB_DATABASE') + '_test',
            entities: [__dirname + '/../src/entities/**/*.entity.ts'],
            synchronize: false,
            logging: false,
          }),
          inject: [ConfigService],
        }),
      )
      .compile();

    app = moduleFixture.createNestApplication({ logger: false });
    const config = moduleFixture.get(ConfigService);
    app.useGlobalFilters(new GlobalExceptionFilter(config));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    app.setGlobalPrefix('api');
    await listenForTests(app);

    ds = moduleFixture.get(DataSource);
    await ds.query('TRUNCATE TABLE ' + ds.entityMetadatas.map((m) => `"${m.tableName}"`).join(', ') + ' RESTART IDENTITY CASCADE');

    const users = ds.getRepository(User);
    owner = await users.save({ email: 'nd-owner@example.test', passwordHash: 'x', name: 'Owner' });
    other = await users.save({ email: 'nd-other@example.test', passwordHash: 'x', name: 'Other' });
    const jwt = moduleFixture.get(JwtService);
    const sign = (u: User) => jwt.sign({ sub: u.id, email: u.email }, { secret: config.get('JWT_SECRET'), expiresIn: '15m' });
    ownerToken = sign(owner);
    otherToken = sign(other);

    client = await ds.getRepository(Client).save({ userId: owner.id, name: 'Owner Client', email: 'client@example.test' });
    invoice = await ds.getRepository(Invoice).save({ userId: owner.id, clientId: client.id, number: 'ND-0001', issueDate: new Date('2026-01-10'), notes: 'original' });
    template = await ds.getRepository(InvoiceTemplate).save({ userId: owner.id, name: 'Owner Template', lineItemsJson: [{ description: 'Service', quantity: 1, unitPrice: 100 }] });
    apiKey = await ds.getRepository(ApiKey).save({ userId: owner.id, name: 'Owner Key', keyHash: randomBytes(32).toString('hex') });
  });

  afterAll(async () => {
    await app.close();
  });

  const send = (token: string, method: Method, url: string, body?: object) => {
    const r = request(app.getHttpServer())[method](url).set('Authorization', `Bearer ${token}`);
    return body ? r.send(body) : r;
  };

  /** Body without the per-request fields, with the id replaced by a placeholder. */
  const normalise = (body: any, id: string) => {
    const rest = { ...(body ?? {}) };
    for (const perRequest of ['timestamp', 'path', 'requestId']) delete rest[perRequest];
    return JSON.parse(JSON.stringify(rest).split(id).join('<id>'));
  };

  /** Another user's id and a random id must be indistinguishable. */
  async function expectIndistinguishable(method: Method, pathFor: (id: string) => string, existingId: string, body?: object) {
    const randomId = randomUUID();
    const foreign = await send(otherToken, method, pathFor(existingId), body);
    const missing = await send(otherToken, method, pathFor(randomId), body);
    expect({ status: foreign.status, body: normalise(foreign.body, existingId) }).toEqual({
      status: missing.status,
      body: normalise(missing.body, randomId),
    });
    expect(foreign.status).toBe(404);
    return foreign;
  }

  describe('clients', () => {
    const p = (id: string) => `/api/v1/clients/${id}`;

    it('GET/PATCH/DELETE of another user\'s client look exactly like a missing one', async () => {
      const res = await expectIndistinguishable('get', p, client.id);
      expect(res.body).toMatchObject({ message: ['Client not found'], errorCode: 'NOT_FOUND_ERROR' });
      await expectIndistinguishable('patch', p, client.id, { name: 'Hijacked' });
      await expectIndistinguishable('delete', p, client.id);
    });

    it('positive control: the owner reads and updates the client, unchanged by the attempts', async () => {
      const got = await send(ownerToken, 'get', p(client.id)).expect(200);
      expect(got.body).toMatchObject({ id: client.id, name: 'Owner Client' });
      await send(ownerToken, 'patch', p(client.id), { name: 'Owner Client' }).expect(200);
      const row = await ds.getRepository(Client).findOneByOrFail({ id: client.id });
      expect(row.deletedAt).toBeNull();
    });
  });

  describe('invoices', () => {
    const p = (suffix = '') => (id: string) => `/api/v1/invoices/${id}${suffix}`;

    it('every per-invoice route answers another user\'s invoice exactly like a missing one', async () => {
      const res = await expectIndistinguishable('get', p(), invoice.id);
      expect(res.body).toMatchObject({ message: ['Invoice not found'], errorCode: 'NOT_FOUND_ERROR' });
      await expectIndistinguishable('patch', p(), invoice.id, { notes: 'hijacked' });
      await expectIndistinguishable('delete', p(), invoice.id);
      await expectIndistinguishable('post', p('/duplicate'), invoice.id);
      await expectIndistinguishable('post', p('/convert'), invoice.id);
      await expectIndistinguishable('post', p('/send'), invoice.id);
      await expectIndistinguishable('get', p('/attachments'), invoice.id);
      await expectIndistinguishable('post', p('/pdf'), invoice.id);
    });

    it('positive control: the owner reads and updates the invoice, unchanged by the attempts', async () => {
      const got = await send(ownerToken, 'get', p()(invoice.id)).expect(200);
      expect(got.body).toMatchObject({ id: invoice.id, notes: 'original' });
      await send(ownerToken, 'get', p('/attachments')(invoice.id)).expect(200);
      await send(ownerToken, 'patch', p()(invoice.id), { notes: 'original' }).expect(200);
      const row = await ds.getRepository(Invoice).findOneByOrFail({ id: invoice.id });
      expect(row.deletedAt).toBeNull();
      expect(await ds.getRepository(Invoice).countBy({ userId: other.id })).toBe(0);
    });
  });

  describe('invoice templates', () => {
    const p = (id: string) => `/api/v1/invoice-templates/${id}`;

    it('GET/PATCH/DELETE of another user\'s template look exactly like a missing one', async () => {
      const res = await expectIndistinguishable('get', p, template.id);
      expect(res.body).toMatchObject({ message: ['Template not found'], errorCode: 'NOT_FOUND_ERROR' });
      await expectIndistinguishable('patch', p, template.id, { name: 'Hijacked' });
      await expectIndistinguishable('delete', p, template.id);
    });

    it('positive control: the owner reads the template, unchanged by the attempts', async () => {
      const got = await send(ownerToken, 'get', p(template.id)).expect(200);
      expect(got.body).toMatchObject({ id: template.id, name: 'Owner Template' });
    });
  });

  describe('API keys (already scoped by owner; regression)', () => {
    it('stats and delete of another user\'s key look exactly like a missing one', async () => {
      const res = await expectIndistinguishable('get', (id) => `/api/v1/api-keys/${id}/stats`, apiKey.id);
      expect(res.body).toMatchObject({ message: ['API key not found'], errorCode: 'NOT_FOUND_ERROR' });
      await expectIndistinguishable('delete', (id) => `/api/v1/api-keys/${id}`, apiKey.id);
    });

    it('positive control: the owner reads the stats, the key still exists', async () => {
      await send(ownerToken, 'get', `/api/v1/api-keys/${apiKey.id}/stats`).expect(200);
      expect(await ds.getRepository(ApiKey).countBy({ id: apiKey.id })).toBe(1);
    });
  });
});
