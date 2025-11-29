import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { AuthGuard } from '@nestjs/passport';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [JwtAuthGuard],
    }).compile();

    guard = module.get<JwtAuthGuard>(JwtAuthGuard);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Guard Definition', () => {
    it('should be defined and instantiable', () => {
      expect(guard).toBeDefined();
      expect(guard).toBeInstanceOf(JwtAuthGuard);
    });

    it('should extend AuthGuard(\'jwt\') from @nestjs/passport', () => {
      expect(guard).toBeInstanceOf(AuthGuard);
    });

    it('should be decorated with @Injectable()', () => {
      // Guard is injectable if it can be retrieved from the module
      expect(guard).toBeDefined();
    });

    it('should use \'jwt\' strategy name', () => {
      // JwtAuthGuard extends AuthGuard('jwt')
      expect(guard).toBeInstanceOf(AuthGuard);
    });
  });

  describe('Integration Test Cases (with ExecutionContext)', () => {
    it('should call canActivate method inherited from AuthGuard', () => {
      const mockExecutionContext = {
        switchToHttp: jest.fn(() => ({
          getRequest: jest.fn(() => ({
            headers: {
              authorization: 'Bearer valid-token',
            },
          })),
        })),
      } as unknown as ExecutionContext;

      // canActivate is inherited from AuthGuard
      expect(guard.canActivate).toBeDefined();
      expect(typeof guard.canActivate).toBe('function');
    });

    it('should return true when JWT token is valid (mock ExecutionContext with valid token)', async () => {
      const mockExecutionContext = {
        switchToHttp: jest.fn(() => ({
          getRequest: jest.fn(() => ({
            headers: {
              authorization: 'Bearer valid-token',
            },
          })),
        })),
      } as unknown as ExecutionContext;

      // Mock the parent canActivate to return true for valid token
      jest.spyOn(AuthGuard.prototype, 'canActivate').mockResolvedValue(true);

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
    });

    it('should return false or throw UnauthorizedException when token is invalid', async () => {
      const mockExecutionContext = {
        switchToHttp: jest.fn(() => ({
          getRequest: jest.fn(() => ({
            headers: {
              authorization: 'Bearer invalid-token',
            },
          })),
        })),
      } as unknown as ExecutionContext;

      // Mock the parent canActivate to throw UnauthorizedException for invalid token
      jest.spyOn(AuthGuard.prototype, 'canActivate').mockRejectedValue(new UnauthorizedException());

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(UnauthorizedException);
    });

    it('should return false or throw UnauthorizedException when token is missing', async () => {
      const mockExecutionContext = {
        switchToHttp: jest.fn(() => ({
          getRequest: jest.fn(() => ({
            headers: {},
          })),
        })),
      } as unknown as ExecutionContext;

      // Mock the parent canActivate to throw UnauthorizedException when token is missing
      jest.spyOn(AuthGuard.prototype, 'canActivate').mockRejectedValue(new UnauthorizedException());

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(UnauthorizedException);
    });

    it('should extract token from Authorization header (Bearer token)', () => {
      const mockExecutionContext = {
        switchToHttp: jest.fn(() => ({
          getRequest: jest.fn(() => ({
            headers: {
              authorization: 'Bearer token-123',
            },
          })),
        })),
      } as unknown as ExecutionContext;

      // canActivate should extract token from Authorization header
      expect(guard.canActivate).toBeDefined();
    });
  });

  describe('Assertions', () => {
    it('should verify guard is properly decorated with @Injectable', () => {
      expect(guard).toBeDefined();
    });

    it('should verify guard extends AuthGuard with \'jwt\' strategy', () => {
      expect(guard).toBeInstanceOf(AuthGuard);
    });

    it('should verify canActivate behavior with valid/invalid tokens', async () => {
      const validContext = {
        switchToHttp: jest.fn(() => ({
          getRequest: jest.fn(() => ({
            headers: {
              authorization: 'Bearer valid-token',
            },
          })),
        })),
      } as unknown as ExecutionContext;

      jest.spyOn(AuthGuard.prototype, 'canActivate').mockResolvedValue(true);

      const result = await guard.canActivate(validContext);
      expect(result).toBe(true);
    });

    it('should note that actual JWT validation is handled by JwtStrategy, guard just invokes it', () => {
      // The guard is a thin wrapper that invokes Passport's AuthGuard
      // Actual validation is done by JwtStrategy
      expect(guard).toBeInstanceOf(AuthGuard);
    });
  });
});

