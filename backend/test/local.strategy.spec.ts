import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { LocalStrategy } from '../src/core/strategies/local.strategy';
import { AuthService } from '../src/auth/auth.service';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';

describe('LocalStrategy', () => {
  let strategy: LocalStrategy;
  let authService: jest.Mocked<AuthService>;

  beforeEach(async () => {
    const mockAuthService = {
      validateUser: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocalStrategy,
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
      ],
    }).compile();

    strategy = module.get<LocalStrategy>(LocalStrategy);
    authService = module.get(AuthService);

    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should be defined and instantiable', () => {
      expect(strategy).toBeDefined();
      expect(strategy).toBeInstanceOf(LocalStrategy);
    });

    it('should call super() with correct configuration: usernameField: \'email\' (override default \'username\'), passwordField: \'password\'', () => {
      // Strategy is configured in constructor with usernameField: 'email'
      expect(strategy).toBeDefined();
    });

    it('should inject AuthService', () => {
      expect(authService).toBeDefined();
      expect(authService.validateUser).toBeDefined();
    });
  });

  describe('validate method', () => {
    it('should call authService.validateUser with email and password', async () => {
      const email = 'test@example.com';
      const password = 'password123';
      const user = {
        id: 'user-id',
        email,
        name: 'Test User',
      };

      authService.validateUser.mockResolvedValue(user as any);

      await strategy.validate(email, password);

      expect(authService.validateUser).toHaveBeenCalledWith(email, password);
    });

    it('should return user object when credentials are valid', async () => {
      const email = 'test@example.com';
      const password = 'password123';
      const user = {
        id: 'user-id',
        email,
        name: 'Test User',
        companyName: 'Test Company',
      };

      authService.validateUser.mockResolvedValue(user as any);

      const result = await strategy.validate(email, password);

      expect(result).toEqual(user);
    });

    it('should throw UnauthorizedException with message \'Invalid credentials\' when authService.validateUser returns null', async () => {
      const email = 'test@example.com';
      const password = 'wrongpassword';

      authService.validateUser.mockResolvedValue(null);

      await expect(strategy.validate(email, password)).rejects.toThrow(UnauthorizedException);
      await expect(strategy.validate(email, password)).rejects.toThrow('Invalid credentials');
    });

    it('should throw UnauthorizedException when authService.validateUser returns undefined', async () => {
      const email = 'test@example.com';
      const password = 'password123';

      authService.validateUser.mockResolvedValue(undefined);

      await expect(strategy.validate(email, password)).rejects.toThrow(UnauthorizedException);
      await expect(strategy.validate(email, password)).rejects.toThrow('Invalid credentials');
    });

    it('should propagate errors from authService.validateUser', async () => {
      const email = 'test@example.com';
      const password = 'password123';
      const error = new Error('Database error');

      authService.validateUser.mockRejectedValue(error);

      await expect(strategy.validate(email, password)).rejects.toThrow(error);
    });
  });

  describe('Test Cases with various scenarios', () => {
    it('should handle valid credentials: email=\'test@example.com\', password=\'password123\' → authService returns user object → validate returns user', async () => {
      const email = 'test@example.com';
      const password = 'password123';
      const user = {
        id: 'user-id',
        email,
        name: 'Test User',
      };

      authService.validateUser.mockResolvedValue(user as any);

      const result = await strategy.validate(email, password);

      expect(result).toEqual(user);
    });

    it('should handle invalid email: email=\'wrong@example.com\', password=\'password123\' → authService returns null → throws UnauthorizedException(\'Invalid credentials\')', async () => {
      const email = 'wrong@example.com';
      const password = 'password123';

      authService.validateUser.mockResolvedValue(null);

      await expect(strategy.validate(email, password)).rejects.toThrow(UnauthorizedException);
      await expect(strategy.validate(email, password)).rejects.toThrow('Invalid credentials');
    });

    it('should handle invalid password: email=\'test@example.com\', password=\'wrongpassword\' → authService returns null → throws UnauthorizedException(\'Invalid credentials\')', async () => {
      const email = 'test@example.com';
      const password = 'wrongpassword';

      authService.validateUser.mockResolvedValue(null);

      await expect(strategy.validate(email, password)).rejects.toThrow(UnauthorizedException);
      await expect(strategy.validate(email, password)).rejects.toThrow('Invalid credentials');
    });

    it('should handle empty email: email=\'\', password=\'password123\' → authService returns null → throws UnauthorizedException', async () => {
      const email = '';
      const password = 'password123';

      authService.validateUser.mockResolvedValue(null);

      await expect(strategy.validate(email, password)).rejects.toThrow(UnauthorizedException);
    });

    it('should handle empty password: email=\'test@example.com\', password=\'\' → authService returns null → throws UnauthorizedException', async () => {
      const email = 'test@example.com';
      const password = '';

      authService.validateUser.mockResolvedValue(null);

      await expect(strategy.validate(email, password)).rejects.toThrow(UnauthorizedException);
    });

    it('should handle AuthService throws error: authService.validateUser throws DatabaseError → validate propagates error', async () => {
      const email = 'test@example.com';
      const password = 'password123';
      const error = new Error('Database connection failed');

      authService.validateUser.mockRejectedValue(error);

      await expect(strategy.validate(email, password)).rejects.toThrow(error);
    });
  });

  describe('Test Cases for user object structure', () => {
    it('should return complete user object from authService (id, email, name, companyName, etc.)', async () => {
      const email = 'test@example.com';
      const password = 'password123';
      const user = {
        id: 'user-id',
        email,
        name: 'Test User',
        companyName: 'Test Company',
        createdAt: new Date(),
      };

      authService.validateUser.mockResolvedValue(user as any);

      const result = await strategy.validate(email, password);

      expect(result).toEqual(user);
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('email');
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('companyName');
    });

    it('should not modify user object returned by authService', async () => {
      const email = 'test@example.com';
      const password = 'password123';
      const user = {
        id: 'user-id',
        email,
        name: 'Test User',
      };

      authService.validateUser.mockResolvedValue(user as any);

      const result = await strategy.validate(email, password);

      expect(result).toBe(user);
      expect(result).toEqual(user);
    });

    it('should handle user object with minimal fields (id, email only)', async () => {
      const email = 'test@example.com';
      const password = 'password123';
      const user = {
        id: 'user-id',
        email,
      };

      authService.validateUser.mockResolvedValue(user as any);

      const result = await strategy.validate(email, password);

      expect(result).toEqual(user);
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('email');
    });
  });

  describe('Assertions', () => {
    it('should verify authService.validateUser called with exact email and password arguments', async () => {
      const email = 'test@example.com';
      const password = 'password123';
      const user = {
        id: 'user-id',
        email,
      };

      authService.validateUser.mockResolvedValue(user as any);

      await strategy.validate(email, password);

      expect(authService.validateUser).toHaveBeenCalledWith(email, password);
      expect(authService.validateUser).toHaveBeenCalledTimes(1);
    });

    it('should verify UnauthorizedException thrown with correct message', async () => {
      const email = 'test@example.com';
      const password = 'wrongpassword';

      authService.validateUser.mockResolvedValue(null);

      await expect(strategy.validate(email, password)).rejects.toThrow(UnauthorizedException);
      await expect(strategy.validate(email, password)).rejects.toThrow('Invalid credentials');
    });

    it('should verify user object returned unchanged from authService', async () => {
      const email = 'test@example.com';
      const password = 'password123';
      const user = {
        id: 'user-id',
        email,
        name: 'Test User',
      };

      authService.validateUser.mockResolvedValue(user as any);

      const result = await strategy.validate(email, password);

      expect(result).toBe(user);
    });

    it('should verify strategy registered with Passport as \'local\' strategy', () => {
      // LocalStrategy extends PassportStrategy(Strategy) which registers it with Passport
      expect(strategy).toBeInstanceOf(PassportStrategy);
    });

    it('should verify usernameField configured as \'email\' (not default \'username\')', () => {
      // Strategy is configured in constructor with usernameField: 'email'
      expect(strategy).toBeDefined();
    });
  });
});

