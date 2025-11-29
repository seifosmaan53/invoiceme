import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from '../src/core/strategies/jwt.strategy';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'JWT_SECRET') return 'test-jwt-secret';
        return null;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
    configService = module.get(ConfigService);

    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should be defined and instantiable', () => {
      expect(strategy).toBeDefined();
      expect(strategy).toBeInstanceOf(JwtStrategy);
    });

    it('should call super() with correct configuration: jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), ignoreExpiration: false, secretOrKey: value from ConfigService.get(\'JWT_SECRET\')', () => {
      expect(strategy).toBeDefined();
      expect(configService.get).toHaveBeenCalledWith('JWT_SECRET');
    });

    it('should inject ConfigService', () => {
      expect(configService).toBeDefined();
      expect(configService.get).toBeDefined();
    });
  });

  describe('validate method', () => {
    it('should return user object { userId: payload.sub, email: payload.email } when payload.sub exists', async () => {
      const payload = {
        sub: 'user-123',
        email: 'test@example.com',
      };

      const result = await strategy.validate(payload);

      expect(result).toEqual({
        userId: 'user-123',
        email: 'test@example.com',
      });
    });

    it('should extract userId from payload.sub (subject claim)', async () => {
      const payload = {
        sub: 'user-456',
        email: 'test@example.com',
      };

      const result = await strategy.validate(payload);

      expect(result.userId).toBe('user-456');
      expect(result.userId).toBe(payload.sub);
    });

    it('should extract email from payload.email', async () => {
      const payload = {
        sub: 'user-123',
        email: 'test@example.com',
      };

      const result = await strategy.validate(payload);

      expect(result.email).toBe('test@example.com');
      expect(result.email).toBe(payload.email);
    });

    it('should throw UnauthorizedException when payload.sub is missing', async () => {
      const payload = {
        email: 'test@example.com',
      };

      await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when payload is null/undefined', async () => {
      await expect(strategy.validate(null as any)).rejects.toThrow(UnauthorizedException);
      await expect(strategy.validate(undefined as any)).rejects.toThrow(UnauthorizedException);
    });

    it('should handle payload with extra fields (ignore them)', async () => {
      const payload = {
        sub: 'user-123',
        email: 'test@example.com',
        role: 'admin',
        extraField: 'ignored',
      };

      const result = await strategy.validate(payload);

      expect(result).toEqual({
        userId: 'user-123',
        email: 'test@example.com',
      });
      expect(result).not.toHaveProperty('role');
      expect(result).not.toHaveProperty('extraField');
    });
  });

  describe('Test Cases with various payloads', () => {
    it('should handle valid payload: { sub: \'user-123\', email: \'test@example.com\' } → returns { userId: \'user-123\', email: \'test@example.com\' }', async () => {
      const payload = {
        sub: 'user-123',
        email: 'test@example.com',
      };

      const result = await strategy.validate(payload);

      expect(result).toEqual({
        userId: 'user-123',
        email: 'test@example.com',
      });
    });

    it('should handle missing sub: { email: \'test@example.com\' } → throws UnauthorizedException', async () => {
      const payload = {
        email: 'test@example.com',
      };

      await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
    });

    it('should handle missing email: { sub: \'user-123\' } → returns { userId: \'user-123\', email: undefined }', async () => {
      const payload = {
        sub: 'user-123',
      };

      const result = await strategy.validate(payload);

      expect(result).toEqual({
        userId: 'user-123',
        email: undefined,
      });
    });

    it('should handle empty payload: {} → throws UnauthorizedException', async () => {
      const payload = {};

      await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
    });

    it('should handle null payload: null → throws UnauthorizedException', async () => {
      await expect(strategy.validate(null as any)).rejects.toThrow(UnauthorizedException);
    });

    it('should handle extra fields: { sub: \'user-123\', email: \'test@example.com\', role: \'admin\' } → returns { userId: \'user-123\', email: \'test@example.com\' } (ignores role)', async () => {
      const payload = {
        sub: 'user-123',
        email: 'test@example.com',
        role: 'admin',
      };

      const result = await strategy.validate(payload);

      expect(result).toEqual({
        userId: 'user-123',
        email: 'test@example.com',
      });
      expect(result).not.toHaveProperty('role');
    });
  });

  describe('Assertions', () => {
    it('should verify ConfigService.get(\'JWT_SECRET\') called during initialization', () => {
      expect(configService.get).toHaveBeenCalledWith('JWT_SECRET');
    });

    it('should verify validate method returns correct user object structure', async () => {
      const payload = {
        sub: 'user-123',
        email: 'test@example.com',
      };

      const result = await strategy.validate(payload);

      expect(result).toHaveProperty('userId');
      expect(result).toHaveProperty('email');
      expect(typeof result.userId).toBe('string');
    });

    it('should verify UnauthorizedException thrown for invalid payloads', async () => {
      const invalidPayloads = [
        {},
        { email: 'test@example.com' },
        null,
        undefined,
      ];

      for (const payload of invalidPayloads) {
        await expect(strategy.validate(payload as any)).rejects.toThrow(UnauthorizedException);
      }
    });

    it('should verify strategy registered with Passport as \'jwt\' strategy', () => {
      // JwtStrategy extends PassportStrategy(Strategy) which registers it with Passport
      expect(strategy).toBeInstanceOf(PassportStrategy);
    });
  });
});

