/**
 * Attachment URL validation, end to end (real AppModule, real PostgreSQL,
 * production ValidationPipe options). S3 is mocked; nothing is uploaded or
 * fetched. Every rejection here is on the user's own invoice, so ownership
 * checks cannot be what blocks it; each batch carries a valid control.
 *
 * See docs/security/2026-10-25-payments-attachments.md.
 */
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
import { Attachment, AttachmentOwnerType } from '../src/entities/attachment.entity';
import { ChangeType, ChangeObjectType } from '../src/entities/device-change.entity';
import { S3Service } from '../src/core/services/s3.service';
import { listenForTests } from './listen';

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

// Shapes S3Service.getSignedUrl produces: AWS (virtual-hosted or path style)
// and the docker-compose MinIO default (S3_ENDPOINT=http://minio:9000).
const PRESIGNED_AWS =
  'https://invoiceme.s3.us-east-1.amazonaws.com/invoices/x/attachments/1-receipt.pdf' +
  '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIDEXAMPLE%2F20261025%2Fus-east-1%2Fs3%2Faws4_request' +
  '&X-Amz-Date=20261025T000000Z&X-Amz-Expires=604800&X-Amz-Signature=0123abcd&X-Amz-SignedHeaders=host';
const PRESIGNED_MINIO =
  'http://minio:9000/invoiceme/invoices/x/attachments/1-receipt.pdf?AWSAccessKeyId=minioadmin&Expires=1793000000&Signature=abc%2Bdef%3D';
const S3_KEY = 'invoices/x/attachments/1761350400000-receipt.pdf';

const DANGEROUS_URLS = [
  'javascript:alert(document.cookie)',
  'JavaScript:alert(1)',
  ' javascript:alert(1)',
  'java\tscript:alert(1)',
  'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  'file:///etc/passwd',
  'vbscript:msgbox(1)',
  'intent://scan/#Intent;scheme=zxing;end',
  'tel:+15550100',
  '//evil.example.test/x.pdf',
  'https://user:pass@evil.example.test/x.pdf',
  'https:\\\\evil.example.test\\x.pdf',
  '/etc/passwd',
  '../../secrets.pdf',
];

const mockS3Service = {
  isAvailable: jest.fn().mockReturnValue(true),
  uploadFile: jest.fn(async (key: string) => key),
  getSignedUrl: jest.fn().mockReturnValue(PRESIGNED_AWS),
};

describe('Attachment URLs (E2E)', () => {
  let app: INestApplication;
  let moduleFixture: TestingModule;
  let userRepository: Repository<User>;
  let clientRepository: Repository<Client>;
  let invoiceRepository: Repository<Invoice>;
  let attachmentRepository: Repository<Attachment>;
  let user: User;
  let token: string;
  let invoice: Invoice;

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
      .overrideProvider(S3Service)
      .useValue(mockS3Service)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe(PRODUCTION_PIPE));
    app.setGlobalPrefix('api');
    await listenForTests(app);

    userRepository = moduleFixture.get(getRepositoryToken(User));
    clientRepository = moduleFixture.get(getRepositoryToken(Client));
    invoiceRepository = moduleFixture.get(getRepositoryToken(Invoice));
    attachmentRepository = moduleFixture.get(getRepositoryToken(Attachment));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const ds = userRepository.manager.connection;
    await ds.query(
      'TRUNCATE TABLE ' + ds.entityMetadatas.map((m) => `"${m.tableName}"`).join(', ') + ' RESTART IDENTITY CASCADE',
    );
    jest.clearAllMocks();

    user = await userRepository.save(
      userRepository.create({
        email: 'attachments@example.test',
        passwordHash: await bcrypt.hash('password123', 4),
        name: 'Attachment Owner',
      }),
    );
    token = moduleFixture
      .get(JwtService)
      .sign({ sub: user.id, email: user.email }, { secret: moduleFixture.get(ConfigService).get('JWT_SECRET'), expiresIn: '15m' });
    const client = await clientRepository.save(clientRepository.create({ userId: user.id, name: 'Own Client' }));
    invoice = await invoiceRepository.save(
      invoiceRepository.create({
        userId: user.id,
        clientId: client.id,
        type: InvoiceType.INVOICE,
        number: 'ATT-0001',
        issueDate: new Date(),
        dueDate: new Date(),
        currency: 'USD',
        subtotal: 10,
        taxTotal: 0,
        discountTotal: 0,
        total: 10,
        status: InvoiceStatus.SENT,
      }),
    );
  });

  const push = (changes: any[]) =>
    request(app.getHttpServer())
      .post('/api/v1/sync/push')
      .set('Authorization', `Bearer ${token}`)
      .send({ deviceId: 'device-test', changes })
      .expect(200);

  const attachmentChange = (id: string, changeType: ChangeType, data: Record<string, any>) => ({
    object_type: ChangeObjectType.ATTACHMENT,
    object_id: id,
    change_type: changeType,
    data,
    device_id: 'device-test',
    updated_at: new Date().toISOString(),
  });

  const seed = (url: string, filename = 'seeded.pdf') =>
    attachmentRepository.save(
      attachmentRepository.create({ ownerType: AttachmentOwnerType.INVOICE, ownerId: invoice.id, url, filename }),
    );

  describe('sync push', () => {
    it('rejects creating attachments with dangerous or malformed URLs; storage URLs and keys are accepted', async () => {
      const bad = DANGEROUS_URLS.map((url) => ({ id: uuidv4(), url }));
      const good = [PRESIGNED_AWS, PRESIGNED_MINIO, S3_KEY, 'https://cdn.example.test/receipts/r1.png'].map((url) => ({
        id: uuidv4(),
        url,
      }));

      const res = await push(
        [...bad, ...good].map(({ id, url }) =>
          attachmentChange(id, ChangeType.CREATE, { ownerType: 'invoice', ownerId: invoice.id, url, filename: 'f.pdf' }),
        ),
      );

      expect(res.body).toMatchObject({ synced: good.length, failed: bad.length });
      const stored = await attachmentRepository.find();
      expect(stored.map((a) => a.url).sort()).toEqual(good.map((g) => g.url).sort());
    });

    it('rejects a non-string URL', async () => {
      const id = uuidv4();
      const res = await push([
        attachmentChange(id, ChangeType.CREATE, { ownerType: 'invoice', ownerId: invoice.id, url: ['https://a.example.test/x.pdf'], filename: 'f.pdf' }),
      ]);
      expect(res.body).toMatchObject({ synced: 0, failed: 1 });
      expect(await attachmentRepository.findOneBy({ id })).toBeNull();
    });

    it('rejects changing an attachment URL to a dangerous one; a storage URL is accepted', async () => {
      const own = await seed('https://files.example.test/own.pdf');

      const denied = await push([attachmentChange(own.id, ChangeType.UPDATE, { url: 'javascript:alert(1)' })]);
      expect(denied.body).toMatchObject({ synced: 0, failed: 1 });
      expect((await attachmentRepository.findOneByOrFail({ id: own.id })).url).toBe('https://files.example.test/own.pdf');

      // Positive control: same attachment, same owner
      const ok = await push([attachmentChange(own.id, ChangeType.UPDATE, { url: PRESIGNED_MINIO })]);
      expect(ok.body).toMatchObject({ synced: 1, failed: 0 });
      expect((await attachmentRepository.findOneByOrFail({ id: own.id })).url).toBe(PRESIGNED_MINIO);
    });

    it('leaves a historical invalid URL untouched when another field changes', async () => {
      const legacy = await seed('javascript:alert(1)', 'legacy.pdf');

      const res = await push([attachmentChange(legacy.id, ChangeType.UPDATE, { filename: 'renamed.pdf' })]);

      expect(res.body).toMatchObject({ synced: 1, failed: 0 });
      const after = await attachmentRepository.findOneByOrFail({ id: legacy.id });
      expect(after).toMatchObject({ filename: 'renamed.pdf', url: 'javascript:alert(1)' });
    });
  });

  describe('reading', () => {
    it('GET /invoices/:id/attachments leaves out historical invalid URLs without changing them', async () => {
      const valid = await Promise.all([seed(PRESIGNED_AWS), seed(PRESIGNED_MINIO), seed(S3_KEY)]);
      const invalid = await Promise.all([
        seed('javascript:alert(document.cookie)'),
        seed('data:text/html,<script>alert(1)</script>'),
        seed('//evil.example.test/x.pdf'),
      ]);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/invoices/${invoice.id}/attachments`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.map((a: Attachment) => a.id).sort()).toEqual(valid.map((a) => a.id).sort());
      for (const row of invalid) {
        expect((await attachmentRepository.findOneByOrFail({ id: row.id })).url).toBe(row.url);
      }
    });

    // GET /sync/pull returns the same rows to the mobile app, which opens them
    // with url_launcher, so pull applies the same filter.
    it('GET /sync/pull leaves out historical invalid URLs without changing them', async () => {
      const valid = await seed(PRESIGNED_AWS);
      const invalid = await seed('javascript:alert(1)');

      const res = await request(app.getHttpServer())
        .get('/api/v1/sync/pull')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.attachments.map((a: Attachment) => a.id)).toEqual([valid.id]);
      expect((await attachmentRepository.findOneByOrFail({ id: invalid.id })).url).toBe('javascript:alert(1)');
    });
  });

  it('REST upload still stores and lists the presigned storage URL', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/invoices/${invoice.id}/attachments`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('%PDF-1.4\n%%EOF\n'), { filename: 'receipt.pdf', contentType: 'application/pdf' })
      .expect(201);

    expect(res.body.url).toBe(PRESIGNED_AWS);
    expect(mockS3Service.uploadFile).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^invoices/${invoice.id}/attachments/\\d+-receipt\\.pdf$`)),
      expect.any(Buffer),
      'application/pdf',
      false,
    );
    const list = await request(app.getHttpServer())
      .get(`/api/v1/invoices/${invoice.id}/attachments`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(list.body.map((a: Attachment) => a.url)).toEqual([PRESIGNED_AWS]);
  });
});
