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
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';

describe('Clients E2E Tests - Filtering', () => {
  let app: INestApplication;
  let userRepository: Repository<User>;
  let clientRepository: Repository<Client>;
  let jwtService: JwtService;
  let configService: ConfigService;
  let testUser: User;
  let authToken: string;

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
    jwtService = moduleFixture.get<JwtService>(JwtService);
    configService = moduleFixture.get<ConfigService>(ConfigService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clean tables
    await clientRepository.delete({});
    await userRepository.delete({});

    // Create test user and auth token
    const password = 'password123';
    const hashedPassword = await bcrypt.hash(password, 10);
    testUser = userRepository.create({
      email: 'client-filter-test@example.com',
      passwordHash: hashedPassword,
      name: 'Client Filter Test User',
      companyName: 'Test Company',
    });
    await userRepository.save(testUser);

    authToken = jwtService.sign(
      { userId: testUser.id, email: testUser.email },
      { secret: configService.get('JWT_SECRET'), expiresIn: '15m' },
    );
  });

  describe('GET /api/v1/clients - Filtering', () => {
    it('should filter clients by tags (single tag)', async () => {
      // Create clients with different tags
      const vipClient = clientRepository.create({
        userId: testUser.id,
        name: 'VIP Client',
        email: 'vip@example.com',
        tagsJson: ['VIP', 'Active'],
      });
      await clientRepository.save(vipClient);

      const regularClient = clientRepository.create({
        userId: testUser.id,
        name: 'Regular Client',
        email: 'regular@example.com',
        tagsJson: ['Active'],
      });
      await clientRepository.save(regularClient);

      // Filter by VIP tag
      const response = await request(app.getHttpServer())
        .get('/api/v1/clients?tags=VIP')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(0);
      const clientNames = response.body.data.map((c: Client) => c.name);
      expect(clientNames).toContain('VIP Client');
      expect(clientNames).not.toContain('Regular Client');

      // Verify all returned clients have the VIP tag
      response.body.data.forEach((c: Client) => {
        expect(c.tagsJson).toContain('VIP');
      });
    });

    it('should filter clients by multiple tags (AND logic)', async () => {
      // Create clients with different tag combinations
      const matchingClient = clientRepository.create({
        userId: testUser.id,
        name: 'Matching Client',
        email: 'matching@example.com',
        tagsJson: ['VIP', 'Active', 'Premium'],
      });
      await clientRepository.save(matchingClient);

      const partialMatchClient = clientRepository.create({
        userId: testUser.id,
        name: 'Partial Match Client',
        email: 'partial@example.com',
        tagsJson: ['VIP'],
      });
      await clientRepository.save(partialMatchClient);

      // Filter by both VIP and Active tags (comma-separated)
      const response = await request(app.getHttpServer())
        .get('/api/v1/clients?tags=VIP,Active')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(0);
      const clientNames = response.body.data.map((c: Client) => c.name);
      expect(clientNames).toContain('Matching Client');
      expect(clientNames).not.toContain('Partial Match Client');

      // Verify all returned clients have both tags
      response.body.data.forEach((c: Client) => {
        expect(c.tagsJson).toContain('VIP');
        expect(c.tagsJson).toContain('Active');
      });
    });

    it('should filter clients by tags (array format)', async () => {
      const matchingClient = clientRepository.create({
        userId: testUser.id,
        name: 'Array Test Client',
        email: 'array@example.com',
        tagsJson: ['VIP', 'Active'],
      });
      await clientRepository.save(matchingClient);

      // Filter using array format
      const response = await request(app.getHttpServer())
        .get('/api/v1/clients?tags[]=VIP&tags[]=Active')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(0);
      const clientNames = response.body.data.map((c: Client) => c.name);
      expect(clientNames).toContain('Array Test Client');
    });

    it('should filter clients by dateFrom', async () => {
      // Create clients with different creation dates
      const oldClient = clientRepository.create({
        userId: testUser.id,
        name: 'Old Client',
        email: 'old@example.com',
        createdAt: new Date('2024-01-01'),
      });
      await clientRepository.save(oldClient);

      const newClient = clientRepository.create({
        userId: testUser.id,
        name: 'New Client',
        email: 'new@example.com',
        createdAt: new Date('2025-06-01'),
      });
      await clientRepository.save(newClient);

      // Filter by dateFrom (2025-01-01)
      const response = await request(app.getHttpServer())
        .get('/api/v1/clients?dateFrom=2025-01-01')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(0);
      const clientNames = response.body.data.map((c: Client) => c.name);
      expect(clientNames).toContain('New Client');
      expect(clientNames).not.toContain('Old Client');
    });

    it('should filter clients by dateTo', async () => {
      const oldClient = clientRepository.create({
        userId: testUser.id,
        name: 'Old Client 2',
        email: 'old2@example.com',
        createdAt: new Date('2024-12-31'),
      });
      await clientRepository.save(oldClient);

      const newClient = clientRepository.create({
        userId: testUser.id,
        name: 'New Client 2',
        email: 'new2@example.com',
        createdAt: new Date('2025-06-01'),
      });
      await clientRepository.save(newClient);

      // Filter by dateTo (2024-12-31)
      const response = await request(app.getHttpServer())
        .get('/api/v1/clients?dateTo=2024-12-31')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(0);
      const clientNames = response.body.data.map((c: Client) => c.name);
      expect(clientNames).toContain('Old Client 2');
      expect(clientNames).not.toContain('New Client 2');
    });

    it('should filter clients by date range', async () => {
      const oldClient = clientRepository.create({
        userId: testUser.id,
        name: 'Old Client 3',
        email: 'old3@example.com',
        createdAt: new Date('2024-06-01'),
      });
      await clientRepository.save(oldClient);

      const middleClient = clientRepository.create({
        userId: testUser.id,
        name: 'Middle Client',
        email: 'middle@example.com',
        createdAt: new Date('2025-03-15'),
      });
      await clientRepository.save(middleClient);

      const newClient = clientRepository.create({
        userId: testUser.id,
        name: 'New Client 3',
        email: 'new3@example.com',
        createdAt: new Date('2025-06-01'),
      });
      await clientRepository.save(newClient);

      // Filter by date range (2025-01-01 to 2025-04-30)
      const response = await request(app.getHttpServer())
        .get('/api/v1/clients?dateFrom=2025-01-01&dateTo=2025-04-30')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(0);
      const clientNames = response.body.data.map((c: Client) => c.name);
      expect(clientNames).toContain('Middle Client');
      expect(clientNames).not.toContain('Old Client 3');
      expect(clientNames).not.toContain('New Client 3');
    });

    it('should filter clients with combined filters (tags + date range)', async () => {
      // Create clients with various tag and date combinations
      const matchingClient = clientRepository.create({
        userId: testUser.id,
        name: 'Perfect Match',
        email: 'perfect@example.com',
        tagsJson: ['VIP', 'Active'],
        createdAt: new Date('2025-03-15'),
      });
      await clientRepository.save(matchingClient);

      const wrongTagsClient = clientRepository.create({
        userId: testUser.id,
        name: 'Wrong Tags',
        email: 'wrongtags@example.com',
        tagsJson: ['VIP'],
        createdAt: new Date('2025-03-15'),
      });
      await clientRepository.save(wrongTagsClient);

      const wrongDateClient = clientRepository.create({
        userId: testUser.id,
        name: 'Wrong Date',
        email: 'wrongdate@example.com',
        tagsJson: ['VIP', 'Active'],
        createdAt: new Date('2024-03-15'),
      });
      await clientRepository.save(wrongDateClient);

      // Filter with tags and date range
      const response = await request(app.getHttpServer())
        .get('/api/v1/clients?tags=VIP,Active&dateFrom=2025-01-01&dateTo=2025-12-31')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(0);
      const clientNames = response.body.data.map((c: Client) => c.name);
      expect(clientNames).toContain('Perfect Match');
      expect(clientNames).not.toContain('Wrong Tags');
      expect(clientNames).not.toContain('Wrong Date');

      // Verify all returned clients match all filters
      response.body.data.forEach((c: Client) => {
        expect(c.tagsJson).toContain('VIP');
        expect(c.tagsJson).toContain('Active');
        const createdAt = new Date(c.createdAt);
        expect(createdAt.getFullYear()).toBe(2025);
      });
    });

    it('should combine tag filtering with search', async () => {
      const client1 = clientRepository.create({
        userId: testUser.id,
        name: 'VIP Corporation',
        email: 'vipcorp@example.com',
        tagsJson: ['VIP'],
      });
      await clientRepository.save(client1);

      const client2 = clientRepository.create({
        userId: testUser.id,
        name: 'VIP Industries',
        email: 'vipind@example.com',
        tagsJson: ['VIP'],
      });
      await clientRepository.save(client2);

      const client3 = clientRepository.create({
        userId: testUser.id,
        name: 'Regular Company',
        email: 'regular@example.com',
        tagsJson: ['Regular'],
      });
      await clientRepository.save(client3);

      // Filter by VIP tag and search for "Corporation"
      const response = await request(app.getHttpServer())
        .get('/api/v1/clients?tags=VIP&search=Corporation')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(0);
      const clientNames = response.body.data.map((c: Client) => c.name);
      expect(clientNames).toContain('VIP Corporation');
      expect(clientNames).not.toContain('VIP Industries');
      expect(clientNames).not.toContain('Regular Company');
    });
  });
});

