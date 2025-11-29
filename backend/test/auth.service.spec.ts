import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { AuthService } from '../src/auth/auth.service';
import { User } from '../src/entities/user.entity';
import { RefreshToken } from '../src/entities/refresh-token.entity';
import { PasswordResetToken } from '../src/entities/password-reset-token.entity';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

jest.mock('bcrypt');
jest.mock('crypto');

describe('AuthService', () => {
  let service: AuthService;
  let mockUserRepository: any;
  let mockRefreshTokenRepository: any;
  let mockPasswordResetTokenRepository: any;
  let mockJwtService: any;
  let mockConfigService: any;

  beforeEach(async () => {
    mockUserRepository = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };

    mockRefreshTokenRepository = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      remove: jest.fn(),
    };

    mockPasswordResetTokenRepository = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
    };

    mockJwtService = {
      sign: jest.fn(),
    };

    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'JWT_REFRESH_SECRET') return 'refresh-secret';
        if (key === 'JWT_REFRESH_EXPIRES_IN') return '7d';
        return null;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
        {
          provide: getRepositoryToken(RefreshToken),
          useValue: mockRefreshTokenRepository,
        },
        {
          provide: getRepositoryToken(PasswordResetToken),
          useValue: mockPasswordResetTokenRepository,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);

    // Reset all mocks
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('should successfully register a new user', async () => {
      const registerDto = {
        email: 'test@example.com',
        password: 'password123',
        name: 'Test User',
        companyName: 'Test Company',
      };

      const hashedPassword = 'hashedPassword123';
      const accessToken = 'accessToken123';
      const refreshToken = 'refreshToken123';

      const savedUser = {
        id: 'user-id',
        email: registerDto.email,
        passwordHash: hashedPassword,
        name: registerDto.name,
        companyName: registerDto.companyName,
      };

      const refreshTokenEntity = {
        id: 'refresh-token-id',
        userId: savedUser.id,
        token: refreshToken,
        expiresAt: new Date(),
      };

      mockUserRepository.findOne.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue(hashedPassword);
      mockUserRepository.create.mockReturnValue(savedUser);
      mockUserRepository.save.mockResolvedValue(savedUser);
      mockJwtService.sign
        .mockReturnValueOnce(accessToken)
        .mockReturnValueOnce(refreshToken);
      mockRefreshTokenRepository.create.mockReturnValue(refreshTokenEntity);
      mockRefreshTokenRepository.save.mockResolvedValue(refreshTokenEntity);

      const result = await service.register(registerDto);

      expect(mockUserRepository.findOne).toHaveBeenCalledWith({
        where: { email: registerDto.email },
      });
      expect(bcrypt.hash).toHaveBeenCalledWith(registerDto.password, 10);
      expect(mockUserRepository.create).toHaveBeenCalledWith({
        email: registerDto.email,
        passwordHash: hashedPassword,
        name: registerDto.name,
        companyName: registerDto.companyName,
      });
      expect(mockUserRepository.save).toHaveBeenCalledWith(savedUser);
      expect(mockRefreshTokenRepository.save).toHaveBeenCalled();
      expect(result).toHaveProperty('accessToken', accessToken);
      expect(result).toHaveProperty('refreshToken', refreshToken);
      expect(result.user).toEqual({
        id: savedUser.id,
        email: savedUser.email,
        name: savedUser.name,
        companyName: savedUser.companyName,
      });
    });

    it('should throw ConflictException when email already exists', async () => {
      const registerDto = {
        email: 'existing@example.com',
        password: 'password123',
        name: 'Test User',
      };

      const existingUser = {
        id: 'existing-id',
        email: registerDto.email,
      };

      mockUserRepository.findOne.mockResolvedValue(existingUser);

      await expect(service.register(registerDto)).rejects.toThrow(
        ConflictException,
      );
      expect(mockUserRepository.findOne).toHaveBeenCalledWith({
        where: { email: registerDto.email },
      });
      expect(mockUserRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('should successfully login with valid credentials', async () => {
      const loginDto = {
        email: 'test@example.com',
        password: 'password123',
      };

      const user = {
        id: 'user-id',
        email: loginDto.email,
        passwordHash: 'hashedPassword123',
        name: 'Test User',
        companyName: 'Test Company',
      };

      const accessToken = 'accessToken123';
      const refreshToken = 'refreshToken123';

      const refreshTokenEntity = {
        id: 'refresh-token-id',
        userId: user.id,
        token: refreshToken,
        expiresAt: new Date(),
      };

      mockUserRepository.findOne.mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockJwtService.sign
        .mockReturnValueOnce(accessToken)
        .mockReturnValueOnce(refreshToken);
      mockRefreshTokenRepository.create.mockReturnValue(refreshTokenEntity);
      mockRefreshTokenRepository.save.mockResolvedValue(refreshTokenEntity);

      const result = await service.login(loginDto);

      expect(mockUserRepository.findOne).toHaveBeenCalledWith({
        where: { email: loginDto.email },
      });
      expect(bcrypt.compare).toHaveBeenCalledWith(
        loginDto.password,
        user.passwordHash,
      );
      expect(result).toHaveProperty('accessToken', accessToken);
      expect(result).toHaveProperty('refreshToken', refreshToken);
      expect(result.user).toEqual({
        id: user.id,
        email: user.email,
        name: user.name,
        companyName: user.companyName,
      });
    });

    it('should throw UnauthorizedException when email does not exist', async () => {
      const loginDto = {
        email: 'nonexistent@example.com',
        password: 'password123',
      };

      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when password is invalid', async () => {
      const loginDto = {
        email: 'test@example.com',
        password: 'wrongpassword',
      };

      const user = {
        id: 'user-id',
        email: loginDto.email,
        passwordHash: 'hashedPassword123',
      };

      mockUserRepository.findOne.mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(bcrypt.compare).toHaveBeenCalledWith(
        loginDto.password,
        user.passwordHash,
      );
    });
  });

  describe('refresh', () => {
    it('should successfully refresh tokens with valid refresh token', async () => {
      const refreshTokenDto = {
        refreshToken: 'validRefreshToken',
      };

      const user = {
        id: 'user-id',
        email: 'test@example.com',
      };

      const existingRefreshToken = {
        id: 'refresh-token-id',
        token: refreshTokenDto.refreshToken,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60), // 1 hour from now
        user,
      };

      const accessToken = 'newAccessToken';
      const newRefreshToken = 'newRefreshToken';

      const newRefreshTokenEntity = {
        id: 'new-refresh-token-id',
        userId: user.id,
        token: newRefreshToken,
        expiresAt: new Date(),
      };

      mockRefreshTokenRepository.findOne.mockResolvedValue(
        existingRefreshToken,
      );
      mockRefreshTokenRepository.remove.mockResolvedValue(undefined);
      mockJwtService.sign
        .mockReturnValueOnce(accessToken)
        .mockReturnValueOnce(newRefreshToken);
      mockRefreshTokenRepository.create.mockReturnValue(
        newRefreshTokenEntity,
      );
      mockRefreshTokenRepository.save.mockResolvedValue(newRefreshTokenEntity);

      const result = await service.refresh(refreshTokenDto);

      expect(mockRefreshTokenRepository.findOne).toHaveBeenCalledWith({
        where: { token: refreshTokenDto.refreshToken },
        relations: ['user'],
      });
      expect(mockRefreshTokenRepository.remove).toHaveBeenCalledWith(
        existingRefreshToken,
      );
      expect(mockRefreshTokenRepository.save).toHaveBeenCalled();
      expect(result).toHaveProperty('accessToken', accessToken);
      expect(result).toHaveProperty('refreshToken', newRefreshToken);
    });

    it('should throw UnauthorizedException when refresh token does not exist', async () => {
      const refreshTokenDto = {
        refreshToken: 'invalidToken',
      };

      mockRefreshTokenRepository.findOne.mockResolvedValue(null);

      await expect(service.refresh(refreshTokenDto)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockRefreshTokenRepository.remove).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when refresh token is expired', async () => {
      const refreshTokenDto = {
        refreshToken: 'expiredToken',
      };

      const expiredRefreshToken = {
        id: 'refresh-token-id',
        token: refreshTokenDto.refreshToken,
        expiresAt: new Date(Date.now() - 1000 * 60 * 60), // 1 hour ago
        user: { id: 'user-id' },
      };

      mockRefreshTokenRepository.findOne.mockResolvedValue(expiredRefreshToken);

      await expect(service.refresh(refreshTokenDto)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockRefreshTokenRepository.remove).not.toHaveBeenCalled();
    });
  });

  describe('validateUser', () => {
    it('should return user when credentials are valid', async () => {
      const email = 'test@example.com';
      const password = 'password123';

      const user = {
        id: 'user-id',
        email,
        passwordHash: 'hashedPassword123',
      };

      mockUserRepository.findOne.mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.validateUser(email, password);

      expect(mockUserRepository.findOne).toHaveBeenCalledWith({
        where: { email },
      });
      expect(bcrypt.compare).toHaveBeenCalledWith(password, user.passwordHash);
      expect(result).toEqual(user);
    });

    it('should return null when user does not exist', async () => {
      const email = 'nonexistent@example.com';
      const password = 'password123';

      mockUserRepository.findOne.mockResolvedValue(null);

      const result = await service.validateUser(email, password);

      expect(mockUserRepository.findOne).toHaveBeenCalledWith({
        where: { email },
      });
      expect(bcrypt.compare).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('should return null when password is invalid', async () => {
      const email = 'test@example.com';
      const password = 'wrongpassword';

      const user = {
        id: 'user-id',
        email,
        passwordHash: 'hashedPassword123',
      };

      mockUserRepository.findOne.mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      const result = await service.validateUser(email, password);

      expect(mockUserRepository.findOne).toHaveBeenCalledWith({
        where: { email },
      });
      expect(bcrypt.compare).toHaveBeenCalledWith(password, user.passwordHash);
      expect(result).toBeNull();
    });
  });

  describe('requestPasswordReset', () => {
    it('should create password reset token when user exists', async () => {
      const passwordResetRequestDto = {
        email: 'test@example.com',
      };

      const user = {
        id: 'user-id',
        email: passwordResetRequestDto.email,
      };

      const resetToken = 'resetToken123';
      const expiresAt = new Date(Date.now() + 1000 * 60 * 60); // 1 hour from now

      const resetTokenEntity = {
        id: 'reset-token-id',
        userId: user.id,
        token: resetToken,
        expiresAt,
        used: false,
      };

      mockUserRepository.findOne.mockResolvedValue(user);
      (crypto.randomBytes as jest.Mock).mockReturnValue({
        toString: jest.fn().mockReturnValue(resetToken),
      });
      mockPasswordResetTokenRepository.update.mockResolvedValue(undefined);
      mockPasswordResetTokenRepository.create.mockReturnValue(resetTokenEntity);
      mockPasswordResetTokenRepository.save.mockResolvedValue(resetTokenEntity);

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      const result = await service.requestPasswordReset(passwordResetRequestDto);

      expect(mockUserRepository.findOne).toHaveBeenCalledWith({
        where: { email: passwordResetRequestDto.email },
      });
      expect(crypto.randomBytes).toHaveBeenCalledWith(32);
      expect(mockPasswordResetTokenRepository.update).toHaveBeenCalledWith(
        { userId: user.id, used: false },
        { used: true },
      );
      expect(mockPasswordResetTokenRepository.create).toHaveBeenCalled();
      expect(mockPasswordResetTokenRepository.save).toHaveBeenCalled();
      expect(result.message).toBe(
        'If an account exists, a password reset email has been sent',
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        `Password reset token for ${user.email}: ${resetToken}`,
      );

      consoleLogSpy.mockRestore();
    });

    it('should return same message when user does not exist (security)', async () => {
      const passwordResetRequestDto = {
        email: 'nonexistent@example.com',
      };

      mockUserRepository.findOne.mockResolvedValue(null);

      const result = await service.requestPasswordReset(passwordResetRequestDto);

      expect(mockUserRepository.findOne).toHaveBeenCalledWith({
        where: { email: passwordResetRequestDto.email },
      });
      expect(crypto.randomBytes).not.toHaveBeenCalled();
      expect(result.message).toBe(
        'If an account exists, a password reset email has been sent',
      );
    });
  });

  describe('resetPassword', () => {
    it('should successfully reset password with valid token', async () => {
      const passwordResetDto = {
        token: 'validResetToken',
        newPassword: 'newPassword123',
      };

      const user = {
        id: 'user-id',
        email: 'test@example.com',
        passwordHash: 'oldHashedPassword',
      };

      const resetToken = {
        id: 'reset-token-id',
        token: passwordResetDto.token,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60), // 1 hour from now
        used: false,
        user,
      };

      const newPasswordHash = 'newHashedPassword';

      mockPasswordResetTokenRepository.findOne.mockResolvedValue(resetToken);
      (bcrypt.hash as jest.Mock).mockResolvedValue(newPasswordHash);
      mockUserRepository.save.mockResolvedValue({
        ...user,
        passwordHash: newPasswordHash,
      });
      mockPasswordResetTokenRepository.save.mockResolvedValue({
        ...resetToken,
        used: true,
      });

      const result = await service.resetPassword(passwordResetDto);

      expect(mockPasswordResetTokenRepository.findOne).toHaveBeenCalledWith({
        where: { token: passwordResetDto.token },
        relations: ['user'],
      });
      expect(bcrypt.hash).toHaveBeenCalledWith(passwordResetDto.newPassword, 10);
      expect(mockUserRepository.save).toHaveBeenCalledWith({
        ...user,
        passwordHash: newPasswordHash,
      });
      expect(mockPasswordResetTokenRepository.save).toHaveBeenCalledWith({
        ...resetToken,
        used: true,
      });
      expect(result.message).toBe('Password reset successfully');
    });

    it('should throw BadRequestException when token does not exist', async () => {
      const passwordResetDto = {
        token: 'invalidToken',
        newPassword: 'newPassword123',
      };

      mockPasswordResetTokenRepository.findOne.mockResolvedValue(null);

      await expect(service.resetPassword(passwordResetDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockUserRepository.save).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when token is expired', async () => {
      const passwordResetDto = {
        token: 'expiredToken',
        newPassword: 'newPassword123',
      };

      const expiredResetToken = {
        id: 'reset-token-id',
        token: passwordResetDto.token,
        expiresAt: new Date(Date.now() - 1000 * 60 * 60), // 1 hour ago
        used: false,
        user: { id: 'user-id' },
      };

      mockPasswordResetTokenRepository.findOne.mockResolvedValue(
        expiredResetToken,
      );

      await expect(service.resetPassword(passwordResetDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockUserRepository.save).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when token is already used', async () => {
      const passwordResetDto = {
        token: 'usedToken',
        newPassword: 'newPassword123',
      };

      const usedResetToken = {
        id: 'reset-token-id',
        token: passwordResetDto.token,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60), // 1 hour from now
        used: true,
        user: { id: 'user-id' },
      };

      mockPasswordResetTokenRepository.findOne.mockResolvedValue(usedResetToken);

      await expect(service.resetPassword(passwordResetDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockUserRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('generateTokens', () => {
    it('should generate access and refresh tokens', async () => {
      const user = {
        id: 'user-id',
        email: 'test@example.com',
      };

      const accessToken = 'accessToken123';
      const refreshToken = 'refreshToken123';

      const refreshTokenEntity = {
        id: 'refresh-token-id',
        userId: user.id,
        token: refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      };

      mockJwtService.sign
        .mockReturnValueOnce(accessToken)
        .mockReturnValueOnce(refreshToken);
      mockRefreshTokenRepository.create.mockReturnValue(refreshTokenEntity);
      mockRefreshTokenRepository.save.mockResolvedValue(refreshTokenEntity);

      // Test through register method
      const registerDto = {
        email: 'newuser@example.com',
        password: 'password123',
        name: 'New User',
      };

      mockUserRepository.findOne.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashedPassword');
      mockUserRepository.create.mockReturnValue({ ...user, ...registerDto });
      mockUserRepository.save.mockResolvedValue({ ...user, ...registerDto });

      const result = await service.register(registerDto);

      expect(mockJwtService.sign).toHaveBeenCalledTimes(2);
      expect(mockRefreshTokenRepository.save).toHaveBeenCalled();
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');

      // Verify refresh token expiration is 7 days
      const savedRefreshToken = mockRefreshTokenRepository.save.mock.calls[0][0];
      const expectedExpiresAt = new Date();
      expectedExpiresAt.setDate(expectedExpiresAt.getDate() + 7);
      expect(savedRefreshToken.expiresAt.getTime()).toBeCloseTo(
        expectedExpiresAt.getTime(),
        -1000, // Allow 1 second tolerance
      );
    });
  });
});

