import { Injectable, Logger } from '@nestjs/common';
import { EmailService } from './email.service';
import { ConfigService } from '@nestjs/config';

export enum NotificationType {
  INVOICE_OVERDUE = 'invoice_overdue',
  PAYMENT_RECEIVED = 'payment_received',
  INVOICE_SENT = 'invoice_sent',
  INVOICE_PAID = 'invoice_paid',
}

export interface NotificationData {
  userEmail: string;
  userName?: string;
  invoiceNumber?: string;
  invoiceId?: string;
  clientName?: string;
  amount?: number;
  currency?: string;
  dueDate?: string;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Send notification for overdue invoice
   */
  async notifyInvoiceOverdue(data: NotificationData): Promise<void> {
    try {
      await this.emailService.sendEmail(
        data.userEmail,
        `Invoice ${data.invoiceNumber} is Overdue`,
        this.getOverdueEmailBody(data),
      );
      this.logger.log(`Overdue notification sent for invoice ${data.invoiceNumber}`);
    } catch (error) {
      this.logger.error(`Failed to send overdue notification: ${error}`);
    }
  }

  /**
   * Send notification for payment received
   */
  async notifyPaymentReceived(data: NotificationData): Promise<void> {
    try {
      await this.emailService.sendEmail(
        data.userEmail,
        `Payment Received for Invoice ${data.invoiceNumber}`,
        this.getPaymentReceivedEmailBody(data),
      );
      this.logger.log(`Payment notification sent for invoice ${data.invoiceNumber}`);
    } catch (error) {
      this.logger.error(`Failed to send payment notification: ${error}`);
    }
  }

  /**
   * Send notification when invoice is sent
   */
  async notifyInvoiceSent(data: NotificationData): Promise<void> {
    try {
      await this.emailService.sendEmail(
        data.userEmail,
        `Invoice ${data.invoiceNumber} Sent to ${data.clientName}`,
        this.getInvoiceSentEmailBody(data),
      );
      this.logger.log(`Invoice sent notification for ${data.invoiceNumber}`);
    } catch (error) {
      this.logger.error(`Failed to send invoice sent notification: ${error}`);
    }
  }

  /**
   * Send notification when invoice is marked as paid
   */
  async notifyInvoicePaid(data: NotificationData): Promise<void> {
    try {
      await this.emailService.sendEmail(
        data.userEmail,
        `Invoice ${data.invoiceNumber} Marked as Paid`,
        this.getInvoicePaidEmailBody(data),
      );
      this.logger.log(`Invoice paid notification for ${data.invoiceNumber}`);
    } catch (error) {
      this.logger.error(`Failed to send invoice paid notification: ${error}`);
    }
  }

  private getOverdueEmailBody(data: NotificationData): string {
    return `
      <h2>Invoice Overdue</h2>
      <p>Hello ${data.userName || 'there'},</p>
      <p>This is a reminder that invoice <strong>${data.invoiceNumber}</strong> for ${data.clientName} is now overdue.</p>
      <p><strong>Amount:</strong> ${data.currency}${data.amount?.toFixed(2)}</p>
      <p><strong>Due Date:</strong> ${data.dueDate}</p>
      <p>Please follow up with your client to ensure payment is received.</p>
    `;
  }

  private getPaymentReceivedEmailBody(data: NotificationData): string {
    return `
      <h2>Payment Received</h2>
      <p>Hello ${data.userName || 'there'},</p>
      <p>Great news! Payment has been received for invoice <strong>${data.invoiceNumber}</strong>.</p>
      <p><strong>Amount:</strong> ${data.currency}${data.amount?.toFixed(2)}</p>
      <p><strong>Client:</strong> ${data.clientName}</p>
    `;
  }

  private getInvoiceSentEmailBody(data: NotificationData): string {
    return `
      <h2>Invoice Sent</h2>
      <p>Hello ${data.userName || 'there'},</p>
      <p>Invoice <strong>${data.invoiceNumber}</strong> has been sent to ${data.clientName}.</p>
      <p><strong>Amount:</strong> ${data.currency}${data.amount?.toFixed(2)}</p>
    `;
  }

  private getInvoicePaidEmailBody(data: NotificationData): string {
    return `
      <h2>Invoice Paid</h2>
      <p>Hello ${data.userName || 'there'},</p>
      <p>Invoice <strong>${data.invoiceNumber}</strong> has been marked as paid.</p>
      <p><strong>Amount:</strong> ${data.currency}${data.amount?.toFixed(2)}</p>
      <p><strong>Client:</strong> ${data.clientName}</p>
    `;
  }
}

