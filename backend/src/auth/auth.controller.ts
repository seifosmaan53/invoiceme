import { Controller, Post, Body, Patch, HttpCode, HttpStatus, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto, LoginDto, RefreshTokenDto, PasswordResetRequestDto, PasswordResetDto, ChangePasswordDto } from './dto/auth.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AuthResponseDto, TokenResponseDto } from './dto/auth-response.dto';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { SetupTotpDto, VerifyTotpSetupDto, VerifyTotpLoginDto, DisableTotpDto } from './dto/totp.dto';

@ApiTags('Authentication')
@Controller('v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user', description: 'Creates a new user account and returns authentication tokens' })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({ status: 201, description: 'User registered successfully', type: AuthResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error or user already exists' })
  async register(@Body() registerDto: RegisterDto): Promise<AuthResponseDto> {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(LocalAuthGuard)
  @ApiOperation({ summary: 'Login user', description: 'Authenticates a user and returns access and refresh tokens' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, description: 'Login successful', type: AuthResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Request() req, @Body() loginDto: LoginDto): Promise<AuthResponseDto | { requiresTotp: boolean; tempToken?: string }> {
    return this.authService.login(loginDto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token', description: 'Generates a new access token using a valid refresh token' })
  @ApiBody({ type: RefreshTokenDto })
  @ApiResponse({ status: 200, description: 'Token refreshed successfully', type: TokenResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  @ApiResponse({ status: 500, description: 'Internal server error during token refresh' })
  async refresh(@Body() refreshTokenDto: RefreshTokenDto): Promise<TokenResponseDto> {
    try {
      return await this.authService.refresh(refreshTokenDto);
    } catch (error) {
      // Log the error for debugging
      console.error('Token refresh error:', error);
      // Re-throw to let the exception filter handle it
      throw error;
    }
  }

  @Post('password-reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request password reset', description: 'Sends a password reset email to the user' })
  @ApiBody({ type: PasswordResetRequestDto })
  @ApiResponse({ status: 200, description: 'Password reset email sent successfully', schema: { type: 'object', properties: { message: { type: 'string' } } } })
  @ApiResponse({ status: 404, description: 'User not found' })
  async requestPasswordReset(@Body() passwordResetRequestDto: PasswordResetRequestDto): Promise<{ message: string }> {
    return this.authService.requestPasswordReset(passwordResetRequestDto);
  }

  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm password reset', description: 'Resets the user password using a valid reset token' })
  @ApiBody({ type: PasswordResetDto })
  @ApiResponse({ status: 200, description: 'Password reset successfully', schema: { type: 'object', properties: { message: { type: 'string' } } } })
  @ApiResponse({ status: 400, description: 'Invalid or expired reset token' })
  async resetPassword(@Body() passwordResetDto: PasswordResetDto): Promise<{ message: string }> {
    return this.authService.resetPassword(passwordResetDto);
  }

  @Post('2fa/setup')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Setup 2FA (TOTP)', description: 'Generate TOTP secret and QR code for 2FA setup' })
  @ApiResponse({
    status: 200,
    description: '2FA setup initiated',
    schema: {
      type: 'object',
      properties: {
        secret: { type: 'string' },
        qrCode: { type: 'string' },
        backupCodes: { type: 'array', items: { type: 'string' } },
      },
    },
  })
  async setupTotp(@CurrentUser() user: any) {
    return this.authService.setupTotp(user.userId);
  }

  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Verify and enable 2FA', description: 'Verify TOTP token to complete 2FA setup' })
  @ApiBody({ type: VerifyTotpSetupDto })
  @ApiResponse({ status: 200, description: '2FA enabled successfully' })
  async verifyTotpSetup(@CurrentUser() user: any, @Body() dto: VerifyTotpSetupDto) {
    return this.authService.verifyTotpSetup(user.userId, dto.token);
  }

  @Post('2fa/disable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Disable 2FA', description: 'Disable 2FA for the current user' })
  @ApiBody({ type: DisableTotpDto })
  @ApiResponse({ status: 200, description: '2FA disabled successfully' })
  async disableTotp(@CurrentUser() user: any, @Body() dto: DisableTotpDto) {
    return this.authService.disableTotp(user.userId, dto.token);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ 
    summary: 'Change password', 
    description: 'Change the current user\'s password. Requires current password for security. All refresh tokens will be invalidated.' 
  })
  @ApiBody({ type: ChangePasswordDto })
  @ApiResponse({ 
    status: 200, 
    description: 'Password changed successfully', 
    schema: { type: 'object', properties: { message: { type: 'string' } } } 
  })
  @ApiResponse({ status: 401, description: 'Current password is incorrect' })
  @ApiResponse({ status: 400, description: 'New password must be different from current password' })
  async changePassword(@CurrentUser() user: any, @Body() changePasswordDto: ChangePasswordDto) {
    return this.authService.changePassword(user.userId, changePasswordDto);
  }

  @Patch('profile')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ 
    summary: 'Update user profile', 
    description: 'Update the current user\'s name and/or company name.' 
  })
  @ApiBody({ type: UpdateProfileDto })
  @ApiResponse({ 
    status: 200, 
    description: 'Profile updated successfully',
    schema: { 
      type: 'object', 
      properties: { 
        id: { type: 'string' },
        email: { type: 'string' },
        name: { type: 'string' },
        companyName: { type: 'string', nullable: true },
      } 
    } 
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  async updateProfile(@CurrentUser() user: any, @Body() updateProfileDto: UpdateProfileDto) {
    return this.authService.updateProfile(user.userId, updateProfileDto);
  }
}

