import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppModule } from '../src/app.module';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../src/entities/user.entity';
import { RefreshToken } from '../src/entities/refresh-token.entity';
import { PasswordResetToken } from '../src/entities/password-reset-token.entity';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';

describe('Auth E2E Tests', () => {
  let app: INestApplication;
  let userRepository: Repository<User>;
  let refreshTokenRepository: Repository<RefreshToken>;
  let passwordResetTokenRepository: Repository<PasswordResetToken>;
  let jwtService: JwtService;
  let configService: ConfigService;

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
    refreshTokenRepository = moduleFixture.get<Repository<RefreshToken>>(getRepositoryToken(RefreshToken));
    passwordResetTokenRepository = moduleFixture.get<Repository<PasswordResetToken>>(
      getRepositoryToken(PasswordResetToken),
    );
    jwtService = moduleFixture.get<JwtService>(JwtService);
    configService = moduleFixture.get<ConfigService>(ConfigService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clean auth-related tables
    await passwordResetTokenRepository.delete({});
    await refreshTokenRepository.delete({});
    await userRepository.delete({});
  });

  describe('POST /api/v1/auth/register', () => {
    it('should register a new user successfully', async () => {
      const registerDto = {
        email: 'test@example.com',
        password: 'password123',
        name: 'Test User',
        companyName: 'Test Company',
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(registerDto)
        .expect(201);

      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.email).toBe(registerDto.email);
      expect(response.body.user.name).toBe(registerDto.name);
      expect(response.body.user.companyName).toBe(registerDto.companyName);

      // Verify user is created in database
      const user = await userRepository.findOne({ where: { email: registerDto.email } });
      expect(user).toBeDefined();
      expect(user.email).toBe(registerDto.email);
      expect(user.passwordHash).not.toBe(registerDto.password); // Password should be hashed
      expect(await bcrypt.compare(registerDto.password, user.passwordHash)).toBe(true);
    });

    it('should return 409 Conflict for duplicate email', async () => {
      const registerDto = {
        email: 'duplicate@example.com',
        password: 'password123',
        name: 'Test User',
      };

      // Register first time
      await request(app.getHttpServer()).post('/api/v1/auth/register').send(registerDto).expect(201);

      // Try to register again with same email
      await request(app.getHttpServer()).post('/api/v1/auth/register').send(registerDto).expect(409);
    });

    it('should return 400 Bad Request for invalid email format', async () => {
      const registerDto = {
        email: 'invalid-email',
        password: 'password123',
        name: 'Test User',
      };

      await request(app.getHttpServer()).post('/api/v1/auth/register').send(registerDto).expect(400);
    });

    it('should return 400 Bad Request for missing required fields', async () => {
      const registerDto = {
        email: 'test@example.com',
        // Missing password and name
      };

      await request(app.getHttpServer()).post('/api/v1/auth/register').send(registerDto).expect(400);
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('should login with valid credentials', async () => {
      // Create test user
      const password = 'password123';
      const hashedPassword = await bcrypt.hash(password, 10);
      const user = userRepository.create({
        email: 'login@example.com',
        passwordHash: hashedPassword,
        name: 'Login User',
      });
      await userRepository.save(user);

      const loginDto = {
        email: 'login@example.com',
        password: password,
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send(loginDto)
        .expect(200);

      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.email).toBe(loginDto.email);

      // Verify refresh token is stored in database
      const refreshToken = await refreshTokenRepository.findOne({
        where: { userId: user.id },
      });
      expect(refreshToken).toBeDefined();
    });

    it('should return 401 Unauthorized for invalid email', async () => {
      const loginDto = {
        email: 'nonexistent@example.com',
        password: 'password123',
      };

      await request(app.getHttpServer()).post('/api/v1/auth/login').send(loginDto).expect(401);
    });

    it('should return 401 Unauthorized for invalid password', async () => {
      // Create test user
      const password = 'password123';
      const hashedPassword = await bcrypt.hash(password, 10);
      const user = userRepository.create({
        email: 'wrongpass@example.com',
        passwordHash: hashedPassword,
        name: 'Wrong Pass User',
      });
      await userRepository.save(user);

      const loginDto = {
        email: 'wrongpass@example.com',
        password: 'wrongpassword',
      };

      await request(app.getHttpServer()).post('/api/v1/auth/login').send(loginDto).expect(401);
    });

    it('should return 400 Bad Request for missing credentials', async () => {
      const loginDto = {
        email: 'test@example.com',
        // Missing password
      };

      await request(app.getHttpServer()).post('/api/v1/auth/login').send(loginDto).expect(400);
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('should refresh tokens successfully', async () => {
      // Create test user
      const password = 'password123';
      const hashedPassword = await bcrypt.hash(password, 10);
      const user = userRepository.create({
        email: 'refresh@example.com',
        passwordHash: hashedPassword,
        name: 'Refresh User',
      });
      await userRepository.save(user);

      // Create valid refresh token
      const refreshTokenValue = jwtService.sign(
        { userId: user.id, email: user.email },
        { secret: configService.get('JWT_REFRESH_SECRET'), expiresIn: '7d' },
      );
      const refreshToken = refreshTokenRepository.create({
        userId: user.id,
        token: refreshTokenValue,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
      await refreshTokenRepository.save(refreshToken);

      const refreshDto = {
        refreshToken: refreshTokenValue,
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send(refreshDto)
        .expect(200);

      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');

      // Verify old refresh token is removed
      const oldToken = await refreshTokenRepository.findOne({
        where: { token: refreshTokenValue },
      });
      expect(oldToken).toBeNull();

      // Verify new refresh token is stored
      const newToken = await refreshTokenRepository.findOne({
        where: { userId: user.id },
      });
      expect(newToken).toBeDefined();
      expect(newToken.token).not.toBe(refreshTokenValue);
    });

    it('should return 401 Unauthorized for invalid token', async () => {
      const refreshDto = {
        refreshToken: 'invalid-token',
      };

      await request(app.getHttpServer()).post('/api/v1/auth/refresh').send(refreshDto).expect(401);
    });

    it('should return 401 Unauthorized for expired token', async () => {
      // Create test user
      const password = 'password123';
      const hashedPassword = await bcrypt.hash(password, 10);
      const user = userRepository.create({
        email: 'expired@example.com',
        passwordHash: hashedPassword,
        name: 'Expired User',
      });
      await userRepository.save(user);

      // Create expired refresh token
      const expiredToken = refreshTokenRepository.create({
        userId: user.id,
        token: 'expired-token',
        expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
      });
      await refreshTokenRepository.save(expiredToken);

      const refreshDto = {
        refreshToken: 'expired-token',
      };

      await request(app.getHttpServer()).post('/api/v1/auth/refresh').send(refreshDto).expect(401);
    });
  });

  describe('Complete Registration → Login → Refresh Flow', () => {
    it('should complete full authentication flow', async () => {
      // Register
      const registerDto = {
        email: 'flow@example.com',
        password: 'password123',
        name: 'Flow User',
        companyName: 'Flow Company',
      };

      const registerResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(registerDto)
        .expect(201);

      const { accessToken, refreshToken } = registerResponse.body;

      // Use access token to make authenticated request
      await request(app.getHttpServer())
        .get('/api/v1/invoices')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // Refresh tokens
      const refreshResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      const newAccessToken = refreshResponse.body.accessToken;

      // Use new access token to make another authenticated request
      await request(app.getHttpServer())
        .get('/api/v1/invoices')
        .set('Authorization', `Bearer ${newAccessToken}`)
        .expect(200);
    });
  });

  describe('POST /api/v1/auth/password-reset', () => {
    it('should request password reset successfully', async () => {
      // Create test user
      const password = 'password123';
      const hashedPassword = await bcrypt.hash(password, 10);
      const user = userRepository.create({
        email: 'reset@example.com',
        passwordHash: hashedPassword,
        name: 'Reset User',
      });
      await userRepository.save(user);

      const resetRequestDto = {
        email: 'reset@example.com',
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/password-reset')
        .send(resetRequestDto)
        .expect(200);

      expect(response.body).toHaveProperty('message');

      // Verify password reset token is created
      const resetToken = await passwordResetTokenRepository.findOne({
        where: { userId: user.id },
      });
      expect(resetToken).toBeDefined();
      expect(resetToken.used).toBe(false);
      expect(resetToken.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(resetToken.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(60 * 60 * 1000); // Within 1 hour
    });

    it('should return same generic message for non-existent email (security)', async () => {
      const resetRequestDto = {
        email: 'nonexistent@example.com',
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/password-reset')
        .send(resetRequestDto)
        .expect(200);

      expect(response.body).toHaveProperty('message');
      // Should not reveal that email doesn't exist
    });
  });

  describe('POST /api/v1/auth/password-reset/confirm', () => {
    it('should reset password successfully', async () => {
      // Create test user
      const oldPassword = 'oldpassword123';
      const hashedPassword = await bcrypt.hash(oldPassword, 10);
      const user = userRepository.create({
        email: 'confirm@example.com',
        passwordHash: hashedPassword,
        name: 'Confirm User',
      });
      await userRepository.save(user);

      // Create password reset token
      const resetToken = passwordResetTokenRepository.create({
        userId: user.id,
        token: 'valid-reset-token',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
        used: false,
      });
      await passwordResetTokenRepository.save(resetToken);

      const newPassword = 'newpassword123';
      const resetDto = {
        token: 'valid-reset-token',
        newPassword: newPassword,
      };

      await request(app.getHttpServer())
        .post('/api/v1/auth/password-reset/confirm')
        .send(resetDto)
        .expect(200);

      // Verify password is updated
      const updatedUser = await userRepository.findOne({ where: { id: user.id } });
      expect(await bcrypt.compare(newPassword, updatedUser.passwordHash)).toBe(true);
      expect(updatedUser.passwordHash).not.toBe(hashedPassword);

      // Verify token is marked as used
      const usedToken = await passwordResetTokenRepository.findOne({
        where: { token: 'valid-reset-token' },
      });
      expect(usedToken.used).toBe(true);

      // Verify user can login with new password
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'confirm@example.com', password: newPassword })
        .expect(200);
    });

    it('should return 400 Bad Request for invalid token', async () => {
      const resetDto = {
        token: 'invalid-token',
        newPassword: 'newpassword123',
      };

      await request(app.getHttpServer())
        .post('/api/v1/auth/password-reset/confirm')
        .send(resetDto)
        .expect(400);
    });

    it('should return 400 Bad Request for expired token', async () => {
      // Create test user
      const password = 'password123';
      const hashedPassword = await bcrypt.hash(password, 10);
      const user = userRepository.create({
        email: 'expiredreset@example.com',
        passwordHash: hashedPassword,
        name: 'Expired Reset User',
      });
      await userRepository.save(user);

      // Create expired reset token
      const expiredToken = passwordResetTokenRepository.create({
        userId: user.id,
        token: 'expired-reset-token',
        expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
        used: false,
      });
      await passwordResetTokenRepository.save(expiredToken);

      const resetDto = {
        token: 'expired-reset-token',
        newPassword: 'newpassword123',
      };

      await request(app.getHttpServer())
        .post('/api/v1/auth/password-reset/confirm')
        .send(resetDto)
        .expect(400);
    });

    it('should return 400 Bad Request for already-used token', async () => {
      // Create test user
      const password = 'password123';
      const hashedPassword = await bcrypt.hash(password, 10);
      const user = userRepository.create({
        email: 'usedtoken@example.com',
        passwordHash: hashedPassword,
        name: 'Used Token User',
      });
      await userRepository.save(user);

      // Create already-used reset token
      const usedToken = passwordResetTokenRepository.create({
        userId: user.id,
        token: 'used-reset-token',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        used: true,
      });
      await passwordResetTokenRepository.save(usedToken);

      const resetDto = {
        token: 'used-reset-token',
        newPassword: 'newpassword123',
      };

      await request(app.getHttpServer())
        .post('/api/v1/auth/password-reset/confirm')
        .send(resetDto)
        .expect(400);
    });
  });

  describe('Unauthorized Access to Protected Resources', () => {
    it('should return 401 Unauthorized when accessing protected endpoint without Authorization header', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/invoices')
        .expect(401);
    });

    it('should return 401 Unauthorized when accessing protected endpoint with invalid Bearer token', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/invoices')
        .set('Authorization', 'Bearer invalid-token-12345')
        .expect(401);
    });

    it('should return 401 Unauthorized when accessing protected endpoint with malformed Authorization header', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/invoices')
        .set('Authorization', 'InvalidFormat token-12345')
        .expect(401);
    });

    it('should return 401 Unauthorized when accessing protected endpoint with expired token', async () => {
      // Create test user
      const password = 'password123';
      const hashedPassword = await bcrypt.hash(password, 10);
      const user = userRepository.create({
        email: 'expiredtoken@example.com',
        passwordHash: hashedPassword,
        name: 'Expired Token User',
      });
      await userRepository.save(user);

      // Create expired token (expired 1 hour ago by setting exp in the past)
      const pastDate = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      const expiredToken = jwtService.sign(
        { userId: user.id, email: user.email, exp: pastDate },
        { secret: configService.get('JWT_SECRET') },
      );

      await request(app.getHttpServer())
        .get('/api/v1/invoices')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);
    });
  });
});

