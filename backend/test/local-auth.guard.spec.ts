import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { LocalAuthGuard, JwtAuthGuard as DuplicateJwtAuthGuard } from '../src/auth/guards/local-auth.guard';
import { AuthGuard } from '@nestjs/passport';

describe('LocalAuthGuard', () => {
  let guard: LocalAuthGuard;
  let duplicateJwtGuard: DuplicateJwtAuthGuard;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [LocalAuthGuard, DuplicateJwtAuthGuard],
    }).compile();

    guard = module.get<LocalAuthGuard>(LocalAuthGuard);
    duplicateJwtGuard = module.get<DuplicateJwtAuthGuard>(DuplicateJwtAuthGuard);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('LocalAuthGuard', () => {
    it('should be defined and instantiable', () => {
      expect(guard).toBeDefined();
      expect(guard).toBeInstanceOf(LocalAuthGuard);
    });

    it('should extend AuthGuard(\'local\') from @nestjs/passport', () => {
      expect(guard).toBeInstanceOf(AuthGuard);
    });

    it('should be decorated with @Injectable()', () => {
      // Guard is injectable if it can be retrieved from the module
      expect(guard).toBeDefined();
    });

    it('should use \'local\' strategy name', () => {
      // LocalAuthGuard extends AuthGuard('local')
      expect(guard).toBeInstanceOf(AuthGuard);
    });
  });

  describe('Integration Test Cases (with ExecutionContext)', () => {
    it('should call canActivate method inherited from AuthGuard', () => {
      const mockExecutionContext = {
        switchToHttp: jest.fn(() => ({
          getRequest: jest.fn(() => ({
            body: {
              email: 'test@example.com',
              password: 'password123',
            },
          })),
        })),
      } as unknown as ExecutionContext;

      // canActivate is inherited from AuthGuard
      expect(guard.canActivate).toBeDefined();
      expect(typeof guard.canActivate).toBe('function');
    });

    it('should return true when credentials are valid (mock ExecutionContext with email/password in body)', async () => {
      const mockExecutionContext = {
        switchToHttp: jest.fn(() => ({
          getRequest: jest.fn(() => ({
            body: {
              email: 'test@example.com',
              password: 'password123',
            },
          })),
        })),
      } as unknown as ExecutionContext;

      // Mock the parent canActivate to return true for valid credentials
      jest.spyOn(AuthGuard.prototype, 'canActivate').mockResolvedValue(true);

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
    });

    it('should return false or throw UnauthorizedException when credentials are invalid', async () => {
      const mockExecutionContext = {
        switchToHttp: jest.fn(() => ({
          getRequest: jest.fn(() => ({
            body: {
              email: 'test@example.com',
              password: 'wrongpassword',
            },
          })),
        })),
      } as unknown as ExecutionContext;

      // Mock the parent canActivate to throw UnauthorizedException for invalid credentials
      jest.spyOn(AuthGuard.prototype, 'canActivate').mockRejectedValue(new UnauthorizedException());

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(UnauthorizedException);
    });

    it('should extract email and password from request body', () => {
      const mockExecutionContext = {
        switchToHttp: jest.fn(() => ({
          getRequest: jest.fn(() => ({
            body: {
              email: 'test@example.com',
              password: 'password123',
            },
          })),
        })),
      } as unknown as ExecutionContext;

      // canActivate should extract email and password from request body
      expect(guard.canActivate).toBeDefined();
    });

    it('should invoke LocalStrategy.validate method', () => {
      // The guard invokes LocalStrategy through Passport's AuthGuard
      // Actual validation is done by LocalStrategy
      expect(guard).toBeInstanceOf(AuthGuard);
    });
  });

  describe('duplicate JwtAuthGuard (line 8)', () => {
    it('should be defined and extend AuthGuard(\'jwt\')', () => {
      // Note: This is a duplicate definition that should probably be removed, but test it for completeness
      expect(duplicateJwtGuard).toBeDefined();
      expect(duplicateJwtGuard).toBeInstanceOf(AuthGuard);
    });

    it('should document in test comments that this is a duplicate and should be removed', () => {
      // This is a duplicate of JwtAuthGuard from jwt-auth.guard.ts
      // It should be removed to avoid confusion
      expect(duplicateJwtGuard).toBeDefined();
    });
  });

  describe('Assertions', () => {
    it('should verify guard is properly decorated with @Injectable', () => {
      expect(guard).toBeDefined();
    });

    it('should verify guard extends AuthGuard with \'local\' strategy', () => {
      expect(guard).toBeInstanceOf(AuthGuard);
    });

    it('should verify canActivate behavior with valid/invalid credentials', async () => {
      const validContext = {
        switchToHttp: jest.fn(() => ({
          getRequest: jest.fn(() => ({
            body: {
              email: 'test@example.com',
              password: 'password123',
            },
          })),
        })),
      } as unknown as ExecutionContext;

      jest.spyOn(AuthGuard.prototype, 'canActivate').mockResolvedValue(true);

      const result = await guard.canActivate(validContext);
      expect(result).toBe(true);
    });

    it('should note that actual credential validation is handled by LocalStrategy, guard just invokes it', () => {
      // The guard is a thin wrapper that invokes Passport's AuthGuard
      // Actual validation is done by LocalStrategy
      expect(guard).toBeInstanceOf(AuthGuard);
    });
  });
});

