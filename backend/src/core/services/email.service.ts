import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: nodemailer.Transporter | null;
  private readonly emailFrom: string;
  private readonly frontendUrl: string;
  private readonly supportEmail: string;
  private readonly smtpConfigured: boolean;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;

  constructor(private readonly configService: ConfigService) {
    const smtpHost = this.configService.get<string>('SMTP_HOST');
    const smtpPort = this.configService.get<number>('SMTP_PORT') || 587;
    const smtpUser = this.configService.get<string>('SMTP_USER');
    const smtpPass = this.configService.get<string>('SMTP_PASS');
    this.emailFrom = this.configService.get<string>('EMAIL_FROM') || 'noreply@invoiceme.com';
    this.frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:8080';
    this.supportEmail = this.configService.get<string>('SUPPORT_EMAIL') || 'support@invoiceme.com';
    
    // Email retry configuration (optional - defaults are suitable for most scenarios)
    // Exponential backoff: baseDelay * 2^attempt (e.g., 1000ms, 2000ms, 4000ms)
    this.maxRetries = this.configService.get<number>('EMAIL_MAX_RETRIES') || 3;
    this.retryBaseDelayMs = this.configService.get<number>('EMAIL_RETRY_BASE_DELAY_MS') || 1000;

    if (!smtpHost) {
      this.logger.warn('SMTP_HOST not configured. Email sending will be disabled.');
      this.smtpConfigured = false;
      this.transporter = null;
      return;
    }

    this.smtpConfigured = true;
    const transporterConfig: any = {
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465, // true for 465, false for other ports
      auth: smtpUser && smtpPass ? {
        user: smtpUser,
        pass: smtpPass,
      } : undefined,
    };

    this.transporter = nodemailer.createTransport(transporterConfig);
    this.logger.log(`Email service initialized with SMTP host: ${smtpHost}:${smtpPort}`);
  }

  /**
   * Generic email sending method
   */
  async sendEmail(
    to: string,
    subject: string,
    html: string,
    text?: string,
  ): Promise<void> {
    const nodeEnv = this.configService.get<string>('NODE_ENV');
    if (nodeEnv === 'test') {
      this.logger.log(`[TEST MODE] Email would be sent to: ${to}`);
      return;
    }

    if (!this.smtpConfigured) {
      if (nodeEnv === 'production') {
        throw new Error('SMTP is not configured. Email sending is disabled in production.');
      }
      this.logger.warn('SMTP is not configured. Email sending is disabled.');
      return;
    }

    const mailOptions: nodemailer.SendMailOptions = {
      from: this.emailFrom,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, ''), // Strip HTML for text version
    };

    await this.sendEmailWithRetry(mailOptions);
    this.logger.log(`Email sent successfully to: ${to}`);
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(
    email: string,
    resetToken: string,
    userName?: string,
  ): Promise<void> {
    const nodeEnv = this.configService.get<string>('NODE_ENV');
    if (nodeEnv === 'test') {
      this.logger.log(`[TEST MODE] Password reset email would be sent to: ${email}`);
      return;
    }

    if (!this.smtpConfigured) {
      if (nodeEnv === 'production') {
        throw new Error('SMTP is not configured. Email sending is disabled in production.');
      }
      this.logger.warn('SMTP is not configured. Email sending is disabled.');
      return;
    }

    try {
      const resetUrl = `${this.frontendUrl}/reset-password?token=${resetToken}`;
      const expirationTime = '1 hour';

      // Load template
      const template = this.loadTemplate('password-reset.html');

      // Replace template variables
      let html = template
        .replace(/\{\{userName\}\}/g, userName || 'there')
        .replace(/\{\{resetUrl\}\}/g, resetUrl)
        .replace(/\{\{resetToken\}\}/g, resetToken)
        .replace(/\{\{expirationTime\}\}/g, expirationTime);

      const mailOptions = {
        from: this.emailFrom,
        to: email,
        subject: 'Reset Your Password - InvoiceMe',
        html,
      };

      await this.sendEmailWithRetry(mailOptions);
      this.logger.log(`Password reset email sent successfully to: ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send password reset email to ${email}:`, error);
      throw error;
    }
  }

  /**
   * Send invoice email
   */
  async sendInvoiceEmail(
    recipientEmail: string,
    invoiceData: {
      invoiceNumber: string;
      total: number;
      currency: string;
      clientName: string;
      companyName?: string;
      dueDate?: string;
    },
    pdfUrl?: string,
  ): Promise<void> {
    const nodeEnv = this.configService.get<string>('NODE_ENV');
    if (nodeEnv === 'test') {
      this.logger.log(`[TEST MODE] Invoice email would be sent to: ${recipientEmail}`);
      return;
    }

    if (!this.smtpConfigured) {
      if (nodeEnv === 'production') {
        throw new Error('SMTP is not configured. Email sending is disabled in production.');
      }
      this.logger.warn('SMTP is not configured. Email sending is disabled.');
      return;
    }

    try {
      const companyName = invoiceData.companyName || 'InvoiceMe';
      const viewUrl = `${this.frontendUrl}/invoices/${invoiceData.invoiceNumber}`;

      // Load template
      const template = this.loadTemplate('invoice-email.html');

      // Replace template variables
      let html = template
        .replace(/\{\{companyName\}\}/g, companyName)
        .replace(/\{\{clientName\}\}/g, invoiceData.clientName)
        .replace(/\{\{invoiceNumber\}\}/g, invoiceData.invoiceNumber)
        .replace(/\{\{total\}\}/g, invoiceData.total.toFixed(2))
        .replace(/\{\{currency\}\}/g, invoiceData.currency)
        .replace(/\{\{viewUrl\}\}/g, viewUrl)
        .replace(/\{\{supportEmail\}\}/g, this.supportEmail);

      // Handle optional fields
      if (invoiceData.dueDate) {
        html = html.replace(/\{\{dueDate\}\}/g, invoiceData.dueDate);
      } else {
        html = html.replace(/<p><strong>Due Date:<\/strong> \{\{dueDate\}\}<\/p>/g, '');
      }

      if (pdfUrl) {
        html = html.replace(/\{\{pdfUrl\}\}/g, pdfUrl);
      } else {
        // Remove PDF download button if no PDF URL
        html = html.replace(/<a href="\{\{pdfUrl\}\}"[^>]*>.*?Download PDF.*?<\/a>/gs, '');
      }

      const mailOptions = {
        from: this.emailFrom,
        to: recipientEmail,
        subject: `Invoice #${invoiceData.invoiceNumber} from ${companyName}`,
        html,
      };

      await this.sendEmailWithRetry(mailOptions);
      this.logger.log(`Invoice email sent successfully to: ${recipientEmail}`);
    } catch (error) {
      this.logger.error(`Failed to send invoice email to ${recipientEmail}:`, error);
      throw error;
    }
  }

  /**
   * Send email with exponential backoff retry logic
   * 
   * Uses configurable retry settings (EMAIL_MAX_RETRIES, EMAIL_RETRY_BASE_DELAY_MS)
   * Exponential backoff: baseDelay * 2^attempt (e.g., 1000ms, 2000ms, 4000ms)
   */
  private async sendEmailWithRetry(
    mailOptions: nodemailer.SendMailOptions,
  ): Promise<void> {
    if (!this.smtpConfigured || !this.transporter) {
      throw new Error('SMTP is not configured');
    }

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        await this.transporter.sendMail(mailOptions);
        if (attempt > 1) {
          this.logger.log(`Email sent successfully on attempt ${attempt}`);
        }
        return;
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(
          `Email send attempt ${attempt}/${this.maxRetries} failed: ${error instanceof Error ? error.message : String(error)}`,
        );

        if (attempt < this.maxRetries) {
          // Exponential backoff: baseDelay * 2^attempt
          const delayMs = this.retryBaseDelayMs * Math.pow(2, attempt - 1);
          this.logger.log(`Retrying in ${delayMs}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    // All retries exhausted
    throw new Error(
      `Failed to send email after ${this.maxRetries} attempts: ${lastError?.message || 'Unknown error'}`,
    );
  }

  /**
   * Verify SMTP connection
   */
  async verifyConnection(): Promise<boolean> {
    if (!this.smtpConfigured || !this.transporter) {
      this.logger.warn('SMTP is not configured. Connection verification skipped.');
      return false;
    }

    try {
      await this.transporter.verify();
      this.logger.log('SMTP connection verified successfully');
      return true;
    } catch (error) {
      this.logger.error('SMTP connection verification failed:', error);
      return false;
    }
  }

  /**
   * Load HTML template from templates directory
   */
  private loadTemplate(templateName: string): string {
    try {
      const isProduction = __dirname.includes('dist');
      const templatePath = isProduction
        ? path.join(__dirname, '..', 'templates', templateName)
        : path.join(__dirname, '..', 'templates', templateName);

      if (!fs.existsSync(templatePath)) {
        throw new Error(`Email template not found: ${templatePath}`);
      }

      return fs.readFileSync(templatePath, 'utf-8');
    } catch (error) {
      this.logger.error(`Failed to load email template ${templateName}:`, error);
      throw new Error(`Email template loading failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

