import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../src/core/services/email.service';
import * as nodemailer from 'nodemailer';
import * as fs from 'fs';

jest.mock('nodemailer');
jest.mock('fs');

// Stable, non-mock default config lookup. Overrides below fall back to THIS
// (not mockConfigService.get) — falling back to the mock being redefined
// recurses into itself infinitely and blows the stack.
const DEFAULT_CONFIG: Record<string, any> = {
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: 587,
  SMTP_USER: 'test@example.com',
  SMTP_PASS: 'test-password',
  EMAIL_FROM: 'noreply@invoiceme.com',
  FRONTEND_URL: 'http://localhost:8080',
  SUPPORT_EMAIL: 'support@invoiceme.com',
  NODE_ENV: 'development',
};
const getDefaultConfig = (key: string) => DEFAULT_CONFIG[key] ?? null;

describe('EmailService', () => {
  let service: EmailService;
  let mockConfigService: any;
  let mockTransporter: any;
  let mockSendMail: jest.Mock;
  let mockVerify: jest.Mock;

  beforeEach(async () => {
    // Mock nodemailer transporter
    mockSendMail = jest.fn();
    mockVerify = jest.fn();
    mockTransporter = {
      sendMail: mockSendMail,
      verify: mockVerify,
    };

    (nodemailer.createTransport as jest.Mock) = jest.fn().mockReturnValue(mockTransporter);

    // Mock ConfigService
    mockConfigService = {
      get: jest.fn(getDefaultConfig),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<EmailService>(EmailService);

    // Reset all mocks
    jest.clearAllMocks();

    // Mock fs.readFileSync
    (fs.readFileSync as jest.Mock) = jest.fn((path: string) => {
      if (path.includes('password-reset.html')) {
        return '<html>Password Reset Template - {{userName}}, {{resetUrl}}, {{resetToken}}, {{expirationTime}}</html>';
      }
      if (path.includes('invoice-email.html')) {
        return '<html>Invoice Template - {{companyName}}, {{clientName}}, {{invoiceNumber}}, {{total}}, {{currency}}, {{dueDate}}, {{viewUrl}}, {{pdfUrl}}, {{supportEmail}}</html>';
      }
      return '';
    });

    // Mock fs.existsSync
    (fs.existsSync as jest.Mock) = jest.fn().mockReturnValue(true);
  });

  describe('sendPasswordResetEmail', () => {
    it('should successfully send password reset email with all parameters', async () => {
      mockSendMail.mockResolvedValue({ messageId: 'test-message-id' });

      await service.sendPasswordResetEmail('test@example.com', 'reset-token-123', 'Test User');

      expect(mockSendMail).toHaveBeenCalledTimes(1);
      const callArgs = mockSendMail.mock.calls[0][0];
      expect(callArgs.to).toBe('test@example.com');
      expect(callArgs.from).toBe('noreply@invoiceme.com');
      expect(callArgs.subject).toBe('Reset Your Password - InvoiceMe');
      expect(callArgs.html).toContain('Test User');
      expect(callArgs.html).toContain('reset-token-123');
      expect(callArgs.html).toContain('http://localhost:8080/reset-password?token=reset-token-123');
    });

    it('should handle missing user name gracefully', async () => {
      mockSendMail.mockResolvedValue({ messageId: 'test-message-id' });

      await service.sendPasswordResetEmail('test@example.com', 'reset-token-123');

      expect(mockSendMail).toHaveBeenCalledTimes(1);
      const callArgs = mockSendMail.mock.calls[0][0];
      expect(callArgs.html).toContain('there');
    });

    it('should retry on failure and succeed on second attempt', async () => {
      jest.useFakeTimers();
      mockSendMail
        .mockRejectedValueOnce(new Error('Connection failed'))
        .mockResolvedValueOnce({ messageId: 'test-message-id' });

      const sendPromise = service.sendPasswordResetEmail('test@example.com', 'reset-token-123');

      // Wait for first attempt to fail and retry delay
      await Promise.resolve();
      jest.advanceTimersByTime(1000);
      await sendPromise;

      expect(mockSendMail).toHaveBeenCalledTimes(2);
      jest.useRealTimers();
    });

    it('should throw error after max retries exceeded', async () => {
      mockSendMail.mockRejectedValue(new Error('Connection failed'));

      await expect(
        service.sendPasswordResetEmail('test@example.com', 'reset-token-123'),
      ).rejects.toThrow('Failed to send email after 3 attempts');
      expect(mockSendMail).toHaveBeenCalledTimes(3);
    });

    it('should log instead of send in test environment', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'test';
        return getDefaultConfig(key);
      });

      // Recreate service with test NODE_ENV
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          EmailService,
          {
            provide: ConfigService,
            useValue: mockConfigService,
          },
        ],
      }).compile();

      const testService = module.get<EmailService>(EmailService);
      const logSpy = jest.spyOn(testService['logger'], 'log');

      await testService.sendPasswordResetEmail('test@example.com', 'reset-token-123');

      expect(mockSendMail).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[TEST MODE] Password reset email would be sent'),
      );

      logSpy.mockRestore();
    });
  });

  describe('sendInvoiceEmail', () => {
    it('should successfully send invoice email with PDF URL', async () => {
      mockSendMail.mockResolvedValue({ messageId: 'test-message-id' });

      const invoiceData = {
        invoiceNumber: 'INV-001',
        total: 1000.5,
        currency: 'USD',
        clientName: 'Test Client',
        companyName: 'Test Company',
        dueDate: '2024-12-31',
      };

      await service.sendInvoiceEmail('client@example.com', invoiceData, 'https://example.com/invoice.pdf');

      expect(mockSendMail).toHaveBeenCalledTimes(1);
      const callArgs = mockSendMail.mock.calls[0][0];
      expect(callArgs.to).toBe('client@example.com');
      expect(callArgs.from).toBe('noreply@invoiceme.com');
      expect(callArgs.subject).toBe('Invoice #INV-001 from Test Company');
      expect(callArgs.html).toContain('INV-001');
      expect(callArgs.html).toContain('1000.50');
      expect(callArgs.html).toContain('USD');
      expect(callArgs.html).toContain('Test Client');
      expect(callArgs.html).toContain('Test Company');
      expect(callArgs.html).toContain('https://example.com/invoice.pdf');
    });

    it('should send invoice email without PDF URL', async () => {
      mockSendMail.mockResolvedValue({ messageId: 'test-message-id' });

      const invoiceData = {
        invoiceNumber: 'INV-002',
        total: 500,
        currency: 'EUR',
        clientName: 'Test Client',
        companyName: 'Test Company',
      };

      await service.sendInvoiceEmail('client@example.com', invoiceData);

      expect(mockSendMail).toHaveBeenCalledTimes(1);
      const callArgs = mockSendMail.mock.calls[0][0];
      expect(callArgs.html).not.toContain('pdfUrl');
    });

    it('should use default company name if not provided', async () => {
      mockSendMail.mockResolvedValue({ messageId: 'test-message-id' });

      const invoiceData = {
        invoiceNumber: 'INV-003',
        total: 750,
        currency: 'GBP',
        clientName: 'Test Client',
      };

      await service.sendInvoiceEmail('client@example.com', invoiceData);

      expect(mockSendMail).toHaveBeenCalledTimes(1);
      const callArgs = mockSendMail.mock.calls[0][0];
      expect(callArgs.subject).toContain('InvoiceMe');
    });

    it('should retry on failure and succeed', async () => {
      jest.useFakeTimers();
      mockSendMail
        .mockRejectedValueOnce(new Error('SMTP error'))
        .mockResolvedValueOnce({ messageId: 'test-message-id' });

      const invoiceData = {
        invoiceNumber: 'INV-004',
        total: 200,
        currency: 'USD',
        clientName: 'Test Client',
      };

      const sendPromise = service.sendInvoiceEmail('client@example.com', invoiceData);

      await Promise.resolve();
      jest.advanceTimersByTime(1000);
      await sendPromise;

      expect(mockSendMail).toHaveBeenCalledTimes(2);
      jest.useRealTimers();
    });

    it('should throw error after max retries', async () => {
      mockSendMail.mockRejectedValue(new Error('Persistent SMTP error'));

      const invoiceData = {
        invoiceNumber: 'INV-005',
        total: 300,
        currency: 'USD',
        clientName: 'Test Client',
      };

      await expect(service.sendInvoiceEmail('client@example.com', invoiceData)).rejects.toThrow(
        'Failed to send email after 3 attempts',
      );
      expect(mockSendMail).toHaveBeenCalledTimes(3);
    });
  });

  describe('verifyConnection', () => {
    it('should return true when connection successful', async () => {
      mockVerify.mockResolvedValue(true);

      const result = await service.verifyConnection();

      expect(result).toBe(true);
      expect(mockVerify).toHaveBeenCalledTimes(1);
    });

    it('should return false when connection fails', async () => {
      mockVerify.mockRejectedValue(new Error('Connection failed'));

      const result = await service.verifyConnection();

      expect(result).toBe(false);
      expect(mockVerify).toHaveBeenCalledTimes(1);
    });
  });

  describe('sendEmailWithRetry', () => {
    it('should succeed on first attempt', async () => {
      mockSendMail.mockResolvedValue({ messageId: 'test-message-id' });

      const mailOptions = {
        to: 'test@example.com',
        subject: 'Test',
        html: '<html>Test</html>',
      };

      // Access private method through any cast
      await (service as any).sendEmailWithRetry(mailOptions);

      expect(mockSendMail).toHaveBeenCalledTimes(1);
    });

    it('should implement exponential backoff', async () => {
      jest.useFakeTimers();
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

      mockSendMail
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockRejectedValueOnce(new Error('Error 2'))
        .mockResolvedValueOnce({ messageId: 'test-message-id' });

      const mailOptions = {
        to: 'test@example.com',
        subject: 'Test',
        html: '<html>Test</html>',
      };

      const sendPromise = (service as any).sendEmailWithRetry(mailOptions);

      // advanceTimersByTimeAsync advances the fake clock AND drains the
      // microtask queue between fired timers, so the async retry chain
      // (reject -> backoff -> retry) progresses without real waiting.
      await jest.advanceTimersByTimeAsync(1000); // first backoff: 1s
      await jest.advanceTimersByTimeAsync(2000); // second backoff: 2s
      await sendPromise;

      expect(mockSendMail).toHaveBeenCalledTimes(3);
      // Verify delays were used (exponential backoff: 1s, 2s)
      expect(setTimeoutSpy).toHaveBeenCalled();

      setTimeoutSpy.mockRestore();
      jest.useRealTimers();
    });

    it('should throw error with retry count after max retries', async () => {
      jest.useFakeTimers();
      mockSendMail.mockRejectedValue(new Error('Persistent error'));

      const mailOptions = {
        to: 'test@example.com',
        subject: 'Test',
        html: '<html>Test</html>',
      };

      const assertion = expect(
        (service as any).sendEmailWithRetry(mailOptions),
      ).rejects.toThrow('Failed to send email after 3 attempts');

      // Drive both backoff delays so all 3 attempts run without real waiting.
      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(2000);
      await assertion;

      expect(mockSendMail).toHaveBeenCalledTimes(3);
      jest.useRealTimers();
    });
  });

  describe('configuration', () => {
    it('should handle missing SMTP_HOST gracefully', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'SMTP_HOST') return null;
        return getDefaultConfig(key);
      });

      // The warning is emitted inside the constructor, so the spy must be in
      // place on the Logger prototype BEFORE the service is instantiated.
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          EmailService,
          {
            provide: ConfigService,
            useValue: mockConfigService,
          },
        ],
      }).compile();

      module.get<EmailService>(EmailService);

      // Service should be created but warn about missing config
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('SMTP_HOST not configured'));

      warnSpy.mockRestore();
    });

    it('should create transporter with correct configuration', async () => {
      // beforeEach clears mocks after constructing `service`, so build a fresh
      // instance here to capture its createTransport call.
      const module = await Test.createTestingModule({
        providers: [
          EmailService,
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();
      module.get<EmailService>(EmailService);

      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'smtp.example.com',
          port: 587,
          secure: false,
          auth: {
            user: 'test@example.com',
            pass: 'test-password',
          },
        }),
      );
    });

    it('should use secure connection for port 465', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'SMTP_PORT') return 465;
        return getDefaultConfig(key);
      });

      const module = await Test.createTestingModule({
        providers: [
          EmailService,
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();
      module.get<EmailService>(EmailService);

      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          secure: true,
        }),
      );
    });
  });

  describe('template loading', () => {
    it('should load password reset template', async () => {
      mockSendMail.mockResolvedValue({ messageId: 'test-message-id' });

      await service.sendPasswordResetEmail('test@example.com', 'token', 'User');

      expect(fs.readFileSync).toHaveBeenCalledWith(
        expect.stringContaining('password-reset.html'),
        'utf-8',
      );
    });

    it('should load invoice email template', async () => {
      mockSendMail.mockResolvedValue({ messageId: 'test-message-id' });

      await service.sendInvoiceEmail(
        'client@example.com',
        {
          invoiceNumber: 'INV-001',
          total: 100,
          currency: 'USD',
          clientName: 'Client',
        },
      );

      expect(fs.readFileSync).toHaveBeenCalledWith(
        expect.stringContaining('invoice-email.html'),
        'utf-8',
      );
    });

    it('should throw error when template not found', async () => {
      (fs.existsSync as jest.Mock) = jest.fn().mockReturnValue(false);

      await expect(
        service.sendPasswordResetEmail('test@example.com', 'token'),
      ).rejects.toThrow('Email template not found');
    });
  });
});

