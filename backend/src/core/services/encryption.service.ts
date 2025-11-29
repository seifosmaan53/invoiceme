import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as CryptoJS from 'crypto-js';

@Injectable()
export class EncryptionService {
  private readonly encryptionKey: string;

  constructor(private configService: ConfigService) {
    // Get encryption key from environment or generate a default (for development only)
    this.encryptionKey = this.configService.get<string>('ENCRYPTION_KEY') || 'default-dev-key-change-in-production';
    
    if (this.encryptionKey === 'default-dev-key-change-in-production') {
      console.warn('⚠️  WARNING: Using default encryption key. Set ENCRYPTION_KEY in production!');
    }
  }

  /**
   * Encrypt sensitive data
   */
  encrypt(text: string): string {
    if (!text) return text;
    try {
      return CryptoJS.AES.encrypt(text, this.encryptionKey).toString();
    } catch (error) {
      console.error('Encryption error:', error);
      throw new Error('Failed to encrypt data');
    }
  }

  /**
   * Decrypt sensitive data
   */
  decrypt(encryptedText: string): string {
    if (!encryptedText) return encryptedText;
    try {
      const bytes = CryptoJS.AES.decrypt(encryptedText, this.encryptionKey);
      const decrypted = bytes.toString(CryptoJS.enc.Utf8);
      return decrypted || encryptedText; // Return original if decryption fails (for backward compatibility)
    } catch (error) {
      console.error('Decryption error:', error);
      // Return original text if decryption fails (for backward compatibility with unencrypted data)
      return encryptedText;
    }
  }

  /**
   * Encrypt an object's sensitive fields
   */
  encryptFields<T extends Record<string, any>>(
    data: T,
    fieldsToEncrypt: (keyof T)[],
  ): T {
    const encrypted = { ...data };
    for (const field of fieldsToEncrypt) {
      if (encrypted[field] && typeof encrypted[field] === 'string') {
        encrypted[field] = this.encrypt(encrypted[field] as string) as T[keyof T];
      }
    }
    return encrypted;
  }

  /**
   * Decrypt an object's sensitive fields
   */
  decryptFields<T extends Record<string, any>>(
    data: T,
    fieldsToDecrypt: (keyof T)[],
  ): T {
    const decrypted = { ...data };
    for (const field of fieldsToDecrypt) {
      if (decrypted[field] && typeof decrypted[field] === 'string') {
        decrypted[field] = this.decrypt(decrypted[field] as string) as T[keyof T];
      }
    }
    return decrypted;
  }
}

