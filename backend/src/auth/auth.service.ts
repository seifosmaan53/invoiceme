import { Injectable, UnauthorizedException, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { User } from '../entities/user.entity';
import { RefreshToken } from '../entities/refresh-token.entity';
import { PasswordResetToken } from '../entities/password-reset-token.entity';
import { RegisterDto, LoginDto, RefreshTokenDto, PasswordResetRequestDto, PasswordResetDto, ChangePasswordDto } from './dto/auth.dto';
import { AuthResponseDto, TokenResponseDto } from './dto/auth-response.dto';
import { EmailService } from '../core/services/email.service';
import { TotpService } from '../core/services/totp.service';
import { SetupTotpDto, VerifyTotpSetupDto, VerifyTotpLoginDto, DisableTotpDto } from './dto/totp.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(RefreshToken)
    private refreshTokenRepository: Repository<RefreshToken>,
    @InjectRepository(PasswordResetToken)
    private passwordResetTokenRepository: Repository<PasswordResetToken>,
    private jwtService: JwtService,
    private configService: ConfigService,
    private emailService: EmailService,
    private totpService: TotpService,
  ) {}

  /**
   * Register a new user
   * 
   * IMPORTANT: Password Security Guidelines
   * - Always hash passwords with bcrypt.hash() before storing
   * - Never store plain text passwords
   * - Never overwrite existing user passwords in seed/migration scripts
   * - If creating seed data, always check if user exists first:
   *   const existing = await this.userRepository.findOne({ where: { email } });
   *   if (existing) return; // Do NOT overwrite password
   */
  async register(registerDto: RegisterDto): Promise<AuthResponseDto> {
    const existingUser = await this.userRepository.findOne({
      where: { email: registerDto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    // Hash password once before storing - never hash an already hashed password
    const passwordHash = await bcrypt.hash(registerDto.password, 10);

    const user = this.userRepository.create({
      email: registerDto.email,
      passwordHash,
      name: registerDto.name,
      companyName: registerDto.companyName,
    });

    const savedUser = await this.userRepository.save(user);

    const tokens = await this.generateTokens(savedUser);

    return {
      ...tokens,
      user: {
        id: savedUser.id,
        email: savedUser.email,
        name: savedUser.name,
        companyName: savedUser.companyName,
      },
    };
  }

  /**
   * Login user with email and password
   * 
   * IMPORTANT: Password Verification
   * - Always use bcrypt.compare() to verify passwords
   * - Never hash the input password and compare hashes directly
   * - bcrypt.compare() handles the hashing and comparison correctly
   */
  async login(loginDto: LoginDto & { totpToken?: string; backupCode?: string }): Promise<AuthResponseDto | { requiresTotp: boolean; tempToken?: string }> {
    const user = await this.userRepository.findOne({
      where: { email: loginDto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Use bcrypt.compare() - it hashes the input and compares with stored hash
    // Never hash the password here and compare hashes directly
    const isPasswordValid = await bcrypt.compare(loginDto.password, user.passwordHash);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if 2FA is enabled
    if (user.totpEnabled && user.totpSecret) {
      // If TOTP token not provided, return requiresTotp flag
      if (!loginDto.totpToken && !loginDto.backupCode) {
        // Generate temporary token for 2FA verification
        const tempToken = this.jwtService.sign(
          { sub: user.id, email: user.email, type: 'totp_verification' },
          { expiresIn: '5m' },
        );
        return { requiresTotp: true, tempToken };
      }

      // Verify TOTP token or backup code
      let isValid = false;
      if (loginDto.totpToken) {
        isValid = this.totpService.verifyToken(user.totpSecret, loginDto.totpToken);
      } else if (loginDto.backupCode && user.backupCodes) {
        const result = this.totpService.verifyBackupCode(user.backupCodes, loginDto.backupCode);
        isValid = result.valid;
        if (isValid) {
          // Update backup codes (remove used one)
          user.backupCodes = JSON.stringify(result.remainingCodes);
          await this.userRepository.save(user);
        }
      }

      if (!isValid) {
        throw new UnauthorizedException('Invalid 2FA code');
      }
    }

    const tokens = await this.generateTokens(user);

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        companyName: user.companyName,
      },
    };
  }

  async refresh(refreshTokenDto: RefreshTokenDto): Promise<TokenResponseDto> {
    const refreshToken = await this.refreshTokenRepository.findOne({
      where: { token: refreshTokenDto.refreshToken },
      relations: ['user'],
    });

    if (!refreshToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (refreshToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token has expired');
    }

    if (!refreshToken.user) {
      throw new UnauthorizedException('User associated with refresh token not found');
    }

    const user = refreshToken.user;

    // Delete old refresh token
    await this.refreshTokenRepository.remove(refreshToken);

    // Generate new tokens
    return await this.generateTokens(user);
  }

  private async generateTokens(user: User): Promise<TokenResponseDto> {
    if (!user || !user.id || !user.email) {
      throw new BadRequestException('Invalid user data for token generation');
    }

    const payload = { sub: user.id, email: user.email };

    const accessToken = this.jwtService.sign(payload);

    const refreshTokenValue = this.jwtService.sign(
      { sub: user.id },
      {
        secret: this.configService.get('JWT_REFRESH_SECRET'),
        expiresIn: this.configService.get('JWT_REFRESH_EXPIRES_IN'),
      },
    );

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    const refreshTokenEntity = this.refreshTokenRepository.create({
      userId: user.id,
      token: refreshTokenValue,
      expiresAt,
    });

    await this.refreshTokenRepository.save(refreshTokenEntity);

    return {
      accessToken,
      refreshToken: refreshTokenValue,
    };
  }

  async validateUser(email: string, password: string): Promise<User | null> {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) {
      return null;
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      return null;
    }

    return user;
  }

  async requestPasswordReset(passwordResetRequestDto: PasswordResetRequestDto): Promise<{ message: string }> {
    const user = await this.userRepository.findOne({
      where: { email: passwordResetRequestDto.email },
    });

    if (!user) {
      // Don't reveal if email exists for security
      return { message: 'If an account exists, a password reset email has been sent' };
    }

    // Generate reset token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1); // 1 hour expiration

    // Invalidate any existing tokens
    await this.passwordResetTokenRepository.update(
      { userId: user.id, used: false },
      { used: true },
    );

    // Create new token
    const resetToken = this.passwordResetTokenRepository.create({
      userId: user.id,
      token,
      expiresAt,
    });

    await this.passwordResetTokenRepository.save(resetToken);

    // Send password reset email
    try {
      await this.emailService.sendPasswordResetEmail(
        user.email,
        token,
        user.name,
      );
    } catch (error) {
      // Log error but don't expose to user for security
      console.error('Failed to send password reset email:', error);
      // Still return success message to prevent email enumeration
    }

    return { message: 'If an account exists, a password reset email has been sent' };
  }

  async resetPassword(passwordResetDto: PasswordResetDto): Promise<{ message: string }> {
    const resetToken = await this.passwordResetTokenRepository.findOne({
      where: { token: passwordResetDto.token },
      relations: ['user'],
    });

    if (!resetToken || resetToken.used || resetToken.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const user = resetToken.user;

    // Hash new password - always hash plain text passwords, never hash already hashed passwords
    const passwordHash = await bcrypt.hash(passwordResetDto.newPassword, 10);

    // Update password
    user.passwordHash = passwordHash;
    await this.userRepository.save(user);

    // Mark token as used
    resetToken.used = true;
    await this.passwordResetTokenRepository.save(resetToken);

    return { message: 'Password reset successfully' };
  }

  async changePassword(userId: string, changePasswordDto: ChangePasswordDto): Promise<{ message: string }> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(
      changePasswordDto.currentPassword,
      user.passwordHash,
    );

    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    // Check if new password is different from current password
    const isSamePassword = await bcrypt.compare(
      changePasswordDto.newPassword,
      user.passwordHash,
    );

    if (isSamePassword) {
      throw new BadRequestException('New password must be different from current password');
    }

    // Hash new password - always hash plain text passwords, never hash already hashed passwords
    const newPasswordHash = await bcrypt.hash(changePasswordDto.newPassword, 10);

    // Update password
    user.passwordHash = newPasswordHash;
    await this.userRepository.save(user);

    // Invalidate all refresh tokens for security (force re-login on other devices)
    await this.refreshTokenRepository.delete({ userId: user.id });

    return { message: 'Password changed successfully. Please log in again on other devices.' };
  }

  async setupTotp(userId: string): Promise<{ secret: string; qrCode: string; backupCodes: string[] }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Generate TOTP secret
    const { secret, otpauthUrl } = this.totpService.generateSecret(user.email);
    
    // Generate QR code
    const qrCode = await this.totpService.generateQRCode(otpauthUrl);
    
    // Generate backup codes
    const backupCodes = this.totpService.generateBackupCodes(10);
    
    // Store secret and backup codes (but don't enable yet - user needs to verify first)
    user.totpSecret = secret;
    user.backupCodes = JSON.stringify(backupCodes);
    await this.userRepository.save(user);

    return {
      secret,
      qrCode,
      backupCodes,
    };
  }

  async verifyTotpSetup(userId: string, token: string): Promise<{ message: string }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.totpSecret) {
      throw new BadRequestException('TOTP setup not initiated. Please call /2fa/setup first.');
    }

    // Verify the token
    const isValid = this.totpService.verifyToken(user.totpSecret, token);
    if (!isValid) {
      throw new BadRequestException('Invalid TOTP token');
    }

    // Enable 2FA
    user.totpEnabled = true;
    await this.userRepository.save(user);

    return { message: '2FA enabled successfully' };
  }

  async disableTotp(userId: string, token: string): Promise<{ message: string }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.totpEnabled || !user.totpSecret) {
      throw new BadRequestException('2FA is not enabled');
    }

    // Verify the token before disabling
    const isValid = this.totpService.verifyToken(user.totpSecret, token);
    if (!isValid) {
      throw new BadRequestException('Invalid TOTP token');
    }

    // Disable 2FA
    user.totpEnabled = false;
    user.totpSecret = null;
    user.backupCodes = null;
    await this.userRepository.save(user);

    return { message: '2FA disabled successfully' };
  }

  /**
   * Update user profile (name and company name)
   */
  async updateProfile(userId: string, updateProfileDto: UpdateProfileDto): Promise<{ id: string; email: string; name: string; companyName?: string }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (updateProfileDto.name !== undefined) {
      user.name = updateProfileDto.name.trim();
    }
    if (updateProfileDto.companyName !== undefined) {
      user.companyName = updateProfileDto.companyName.trim() || null;
    }

    await this.userRepository.save(user);

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      companyName: user.companyName,
    };
  }
}

