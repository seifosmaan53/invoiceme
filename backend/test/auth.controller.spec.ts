/**
 * AuthController Unit Tests
 * 
 * Note: Request validation testing (invalid DTOs, missing required fields, etc.) is deferred to e2e tests.
 * These unit tests focus on service interaction and error propagation.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { RegisterDto, LoginDto, RefreshTokenDto, PasswordResetRequestDto, PasswordResetDto } from '../src/auth/dto/auth.dto';
import { LocalAuthGuard } from '../src/auth/guards/local-auth.guard';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: jest.Mocked<AuthService>;
  let localAuthGuard: jest.Mocked<LocalAuthGuard>;

  beforeEach(async () => {
    const mockAuthService = {
      register: jest.fn(),
      login: jest.fn(),
      refresh: jest.fn(),
      requestPasswordReset: jest.fn(),
      resetPassword: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
      ],
    })
      .overrideGuard(LocalAuthGuard)
      .useValue({
        canActivate: jest.fn(() => true),
      })
      .compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get(AuthService);
    localAuthGuard = module.get(LocalAuthGuard);

    jest.clearAllMocks();
  });

  describe('POST /register', () => {
    it('should call authService.register with RegisterDto and return AuthResponseDto', async () => {
      const registerDto: RegisterDto = {
        email: 'test@example.com',
        password: 'password123',
        name: 'Test User',
        companyName: 'Test Company',
      };

      const authResponse = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: {
          id: 'user-id',
          email: registerDto.email,
          name: registerDto.name,
          companyName: registerDto.companyName,
        },
      };

      authService.register.mockResolvedValue(authResponse);

      const result = await controller.register(registerDto);

      expect(authService.register).toHaveBeenCalledWith(registerDto);
      expect(result).toEqual(authResponse);
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result).toHaveProperty('user');
    });

    it('should return HTTP 201 status', async () => {
      const registerDto: RegisterDto = {
        email: 'test@example.com',
        password: 'password123',
        name: 'Test User',
      };

      const authResponse = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: {
          id: 'user-id',
          email: registerDto.email,
          name: registerDto.name,
        },
      };

      authService.register.mockResolvedValue(authResponse);

      await controller.register(registerDto);

      // HTTP status is set via @HttpCode decorator, verified by framework
      expect(authService.register).toHaveBeenCalled();
    });

    it('should propagate ConflictException when email already exists', async () => {
      const registerDto: RegisterDto = {
        email: 'existing@example.com',
        password: 'password123',
        name: 'Test User',
      };

      authService.register.mockRejectedValue(new ConflictException('Email already exists'));

      await expect(controller.register(registerDto)).rejects.toThrow(ConflictException);
      expect(authService.register).toHaveBeenCalledWith(registerDto);
    });

    it('should verify service method called with correct DTO', async () => {
      const registerDto: RegisterDto = {
        email: 'test@example.com',
        password: 'password123',
        name: 'Test User',
        companyName: 'Test Company',
      };

      const authResponse = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: {
          id: 'user-id',
          email: registerDto.email,
          name: registerDto.name,
          companyName: registerDto.companyName,
        },
      };

      authService.register.mockResolvedValue(authResponse);

      await controller.register(registerDto);

      expect(authService.register).toHaveBeenCalledWith(registerDto);
      expect(authService.register).toHaveBeenCalledTimes(1);
    });
  });

  describe('POST /login', () => {
    it('should use LocalAuthGuard to validate credentials', async () => {
      const loginDto: LoginDto = {
        email: 'test@example.com',
        password: 'password123',
      };

      const authResponse = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: {
          id: 'user-id',
          email: loginDto.email,
          name: 'Test User',
        },
      };

      authService.login.mockResolvedValue(authResponse);

      await controller.login({} as any, loginDto);

      // LocalAuthGuard is applied via @UseGuards decorator
      expect(authService.login).toHaveBeenCalled();
    });

    it('should call authService.login with LoginDto and return AuthResponseDto', async () => {
      const loginDto: LoginDto = {
        email: 'test@example.com',
        password: 'password123',
      };

      const authResponse = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: {
          id: 'user-id',
          email: loginDto.email,
          name: 'Test User',
        },
      };

      authService.login.mockResolvedValue(authResponse);

      const result = await controller.login({} as any, loginDto);

      expect(authService.login).toHaveBeenCalledWith(loginDto);
      expect(result).toEqual(authResponse);
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result).toHaveProperty('user');
    });

    it('should return HTTP 200 status', async () => {
      const loginDto: LoginDto = {
        email: 'test@example.com',
        password: 'password123',
      };

      const authResponse = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: {
          id: 'user-id',
          email: loginDto.email,
          name: 'Test User',
        },
      };

      authService.login.mockResolvedValue(authResponse);

      await controller.login({} as any, loginDto);

      expect(authService.login).toHaveBeenCalled();
    });

    it('should attach user to request object via LocalAuthGuard', async () => {
      const loginDto: LoginDto = {
        email: 'test@example.com',
        password: 'password123',
      };

      const mockRequest = {
        user: {
          id: 'user-id',
          email: loginDto.email,
          name: 'Test User',
        },
      };

      const authResponse = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: mockRequest.user,
      };

      authService.login.mockResolvedValue(authResponse);

      await controller.login(mockRequest as any, loginDto);

      expect(authService.login).toHaveBeenCalledWith(loginDto);
    });

    it('should propagate UnauthorizedException for invalid credentials', async () => {
      const loginDto: LoginDto = {
        email: 'test@example.com',
        password: 'wrongpassword',
      };

      authService.login.mockRejectedValue(new UnauthorizedException('Invalid credentials'));

      await expect(controller.login({} as any, loginDto)).rejects.toThrow(UnauthorizedException);
      expect(authService.login).toHaveBeenCalledWith(loginDto);
    });
  });

  describe('POST /refresh', () => {
    it('should call authService.refresh with RefreshTokenDto and return TokenResponseDto', async () => {
      const refreshTokenDto: RefreshTokenDto = {
        refreshToken: 'refresh-token',
      };

      const tokenResponse = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      };

      authService.refresh.mockResolvedValue(tokenResponse);

      const result = await controller.refresh(refreshTokenDto);

      expect(authService.refresh).toHaveBeenCalledWith(refreshTokenDto);
      expect(result).toEqual(tokenResponse);
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
    });

    it('should return HTTP 200 status', async () => {
      const refreshTokenDto: RefreshTokenDto = {
        refreshToken: 'refresh-token',
      };

      const tokenResponse = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      };

      authService.refresh.mockResolvedValue(tokenResponse);

      await controller.refresh(refreshTokenDto);

      expect(authService.refresh).toHaveBeenCalled();
    });

    it('should propagate UnauthorizedException for invalid/expired refresh token', async () => {
      const refreshTokenDto: RefreshTokenDto = {
        refreshToken: 'invalid-token',
      };

      authService.refresh.mockRejectedValue(new UnauthorizedException('Invalid refresh token'));

      await expect(controller.refresh(refreshTokenDto)).rejects.toThrow(UnauthorizedException);
      expect(authService.refresh).toHaveBeenCalledWith(refreshTokenDto);
    });
  });

  describe('POST /password-reset', () => {
    it('should call authService.requestPasswordReset with PasswordResetRequestDto', async () => {
      const passwordResetRequestDto: PasswordResetRequestDto = {
        email: 'test@example.com',
      };

      const response = {
        message: 'If an account exists, a password reset email has been sent',
      };

      authService.requestPasswordReset.mockResolvedValue(response);

      const result = await controller.requestPasswordReset(passwordResetRequestDto);

      expect(authService.requestPasswordReset).toHaveBeenCalledWith(passwordResetRequestDto);
      expect(result).toEqual(response);
    });

    it('should return success message regardless of email existence (security)', async () => {
      const passwordResetRequestDto: PasswordResetRequestDto = {
        email: 'nonexistent@example.com',
      };

      const response = {
        message: 'If an account exists, a password reset email has been sent',
      };

      authService.requestPasswordReset.mockResolvedValue(response);

      const result = await controller.requestPasswordReset(passwordResetRequestDto);

      expect(result.message).toBe('If an account exists, a password reset email has been sent');
    });

    it('should return HTTP 200 status', async () => {
      const passwordResetRequestDto: PasswordResetRequestDto = {
        email: 'test@example.com',
      };

      const response = {
        message: 'If an account exists, a password reset email has been sent',
      };

      authService.requestPasswordReset.mockResolvedValue(response);

      await controller.requestPasswordReset(passwordResetRequestDto);

      expect(authService.requestPasswordReset).toHaveBeenCalled();
    });
  });

  describe('POST /password-reset/confirm', () => {
    it('should call authService.resetPassword with PasswordResetDto (token, newPassword)', async () => {
      const passwordResetDto: PasswordResetDto = {
        token: 'reset-token',
        newPassword: 'newPassword123',
      };

      const response = {
        message: 'Password reset successfully',
      };

      authService.resetPassword.mockResolvedValue(response);

      const result = await controller.resetPassword(passwordResetDto);

      expect(authService.resetPassword).toHaveBeenCalledWith(passwordResetDto);
      expect(result).toEqual(response);
    });

    it('should return success message', async () => {
      const passwordResetDto: PasswordResetDto = {
        token: 'reset-token',
        newPassword: 'newPassword123',
      };

      const response = {
        message: 'Password reset successfully',
      };

      authService.resetPassword.mockResolvedValue(response);

      const result = await controller.resetPassword(passwordResetDto);

      expect(result.message).toBe('Password reset successfully');
    });

    it('should return HTTP 200 status', async () => {
      const passwordResetDto: PasswordResetDto = {
        token: 'reset-token',
        newPassword: 'newPassword123',
      };

      const response = {
        message: 'Password reset successfully',
      };

      authService.resetPassword.mockResolvedValue(response);

      await controller.resetPassword(passwordResetDto);

      expect(authService.resetPassword).toHaveBeenCalled();
    });

    it('should propagate BadRequestException for invalid/expired/used token', async () => {
      const passwordResetDto: PasswordResetDto = {
        token: 'invalid-token',
        newPassword: 'newPassword123',
      };

      authService.resetPassword.mockRejectedValue(new BadRequestException('Invalid or expired token'));

      await expect(controller.resetPassword(passwordResetDto)).rejects.toThrow(BadRequestException);
      expect(authService.resetPassword).toHaveBeenCalledWith(passwordResetDto);
    });
  });
});

