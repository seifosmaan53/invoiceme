/**
 * Shared E2E bootstrap for the PDF / API-key scope / login suites: real
 * AppModule on the DB_TEST_* PostgreSQL database, production ValidationPipe,
 * /api prefix. Email and notifications are recorders; PdfService is replaced
 * by a stub (real rendering is covered by pdf-network.spec.ts); S3 reports
 * itself unavailable so nothing is uploaded.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { User } from '../src/entities/user.entity';
import { EmailService } from '../src/core/services/email.service';
import { NotificationService } from '../src/core/services/notification.service';
import { PdfService } from '../src/core/services/pdf.service';
import { S3Service } from '../src/core/services/s3.service';
import { listenForTests } from './listen';

export const mockEmailService = {
  sendInvoiceEmail: jest.fn(),
  sendEmail: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
};
export const mockNotificationService = {
  notifyInvoiceOverdue: jest.fn(),
  notifyPaymentReceived: jest.fn(),
  notifyInvoiceSent: jest.fn(),
  notifyInvoicePaid: jest.fn(),
};
export const mockPdfService = {
  generateInvoicePdf: jest.fn(async () => Buffer.from('%PDF-1.4\n%stub\n%%EOF\n')),
};
export const mockS3Service = {
  isAvailable: () => false,
  uploadFile: jest.fn(async (key: string) => key),
  getSignedUrl: jest.fn((key: string) => `https://s3.example.test/${key}?sig=stub`),
};

export interface E2eApp {
  app: INestApplication;
  moduleFixture: TestingModule;
  dataSource: DataSource;
  users: Repository<User>;
  truncateAll(): Promise<void>;
  createUser(email: string): Promise<{ user: User; token: string }>;
}

export async function createE2eApp(options: { controllers?: any[]; imports?: any[] } = {}): Promise<E2eApp> {
  const moduleFixture = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.test', '.env'] }),
      AppModule,
      ...(options.imports ?? []),
    ],
    controllers: options.controllers ?? [],
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
          synchronize: process.env.DB_SYNCHRONIZE === 'true',
          logging: false,
        }),
        inject: [ConfigService],
      }),
    )
    .overrideProvider(EmailService)
    .useValue(mockEmailService)
    .overrideProvider(NotificationService)
    .useValue(mockNotificationService)
    .overrideProvider(PdfService)
    .useValue(mockPdfService)
    .overrideProvider(S3Service)
    .useValue(mockS3Service)
    .compile();

  const app = moduleFixture.createNestApplication();
  // Same options as src/main.ts
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      forbidUnknownValues: true,
      validateCustomDecorators: true,
      stopAtFirstError: false,
    }),
  );
  app.setGlobalPrefix('api');
  await listenForTests(app);

  const users = moduleFixture.get<Repository<User>>(getRepositoryToken(User));
  const dataSource = users.manager.connection;
  const jwt = moduleFixture.get(JwtService);
  const secret = moduleFixture.get(ConfigService).get('JWT_SECRET');

  return {
    app,
    moduleFixture,
    dataSource,
    users,
    async truncateAll() {
      await dataSource.query(
        'TRUNCATE TABLE ' + dataSource.entityMetadatas.map((m) => `"${m.tableName}"`).join(', ') + ' RESTART IDENTITY CASCADE',
      );
    },
    async createUser(email: string) {
      const passwordHash = await bcrypt.hash('password123', 4);
      const user = await users.save(users.create({ email, passwordHash, name: email.split('@')[0] }));
      const token = jwt.sign({ sub: user.id, email: user.email }, { secret, expiresIn: '15m' });
      return { user, token };
    },
  };
}
