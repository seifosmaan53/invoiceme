import { Injectable } from '@nestjs/common';
import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';

@Injectable()
export class TotpService {
  /**
   * Generate a new TOTP secret for a user
   */
  generateSecret(userEmail: string, serviceName: string = 'InvoiceMe'): {
    secret: string;
    otpauthUrl: string;
  } {
    const secret = speakeasy.generateSecret({
      name: `${serviceName} (${userEmail})`,
      length: 32,
    });

    return {
      secret: secret.base32,
      otpauthUrl: secret.otpauth_url!,
    };
  }

  /**
   * Generate QR code data URL for TOTP setup
   */
  async generateQRCode(otpauthUrl: string): Promise<string> {
    return QRCode.toDataURL(otpauthUrl);
  }

  /**
   * Verify a TOTP token
   */
  verifyToken(secret: string, token: string, window: number = 2): boolean {
    return speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token,
      window, // Allow tokens from ±2 time steps (60 seconds each)
    });
  }

  /**
   * Generate backup codes (one-time use codes for recovery)
   */
  generateBackupCodes(count: number = 10): string[] {
    const codes: string[] = [];
    for (let i = 0; i < count; i++) {
      // Generate 8-digit backup code
      const code = Math.floor(10000000 + Math.random() * 90000000).toString();
      codes.push(code);
    }
    return codes;
  }

  /**
   * Verify a backup code and remove it if valid
   */
  verifyBackupCode(backupCodesJson: string | null, code: string): {
    valid: boolean;
    remainingCodes: string[];
  } {
    if (!backupCodesJson) {
      return { valid: false, remainingCodes: [] };
    }

    try {
      const codes = JSON.parse(backupCodesJson) as string[];
      const index = codes.indexOf(code);

      if (index === -1) {
        return { valid: false, remainingCodes: codes };
      }

      // Remove used code
      codes.splice(index, 1);
      return { valid: true, remainingCodes: codes };
    } catch {
      return { valid: false, remainingCodes: [] };
    }
  }
}

