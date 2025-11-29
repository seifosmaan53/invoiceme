import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment, PaymentStatus } from '../entities/payment.entity';
import { Invoice, InvoiceStatus } from '../entities/invoice.entity';
import { NotificationService } from '../core/services/notification.service';
import { User } from '../entities/user.entity';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(Payment)
    private paymentRepository: Repository<Payment>,
    @InjectRepository(Invoice)
    private invoiceRepository: Repository<Invoice>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private notificationService: NotificationService,
  ) {}

  /**
   * Create a payment record for an invoice
   */
  async createPayment(
    invoiceId: string,
    providerPaymentId: string,
    amount: number,
    currency: string,
    metadata?: Record<string, any>,
  ): Promise<Payment> {
    // Check if payment already exists
    const existingPayment = await this.paymentRepository.findOne({
      where: { providerPaymentId },
    });

    if (existingPayment) {
      return existingPayment;
    }

    const payment = this.paymentRepository.create({
      invoiceId,
      providerPaymentId,
      amount,
      currency,
      status: PaymentStatus.PENDING,
      metadataJson: metadata,
    });

    return this.paymentRepository.save(payment);
  }

  /**
   * Update payment status from webhook
   * Updates invoice status to 'paid' when payment is completed
   */
  async updatePaymentStatus(
    providerPaymentId: string,
    status: PaymentStatus,
    metadata?: any,
  ): Promise<Payment> {
    const payment = await this.paymentRepository.findOne({
      where: { providerPaymentId },
      relations: ['invoice'],
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    // Update payment status
    payment.status = status;
    if (metadata) {
      payment.metadataJson = { ...payment.metadataJson, ...metadata };
    }

    const updatedPayment = await this.paymentRepository.save(payment);

    // Update invoice status if payment completed
    if (status === PaymentStatus.COMPLETED && payment.invoice) {
      payment.invoice.status = InvoiceStatus.PAID;
      await this.invoiceRepository.save(payment.invoice);
      
      // Send notification
      try {
        const user = await this.userRepository.findOne({ where: { id: payment.invoice.userId } });
        if (user) {
          await this.notificationService.notifyPaymentReceived({
            userEmail: user.email,
            userName: user.name,
            invoiceNumber: payment.invoice.number,
            invoiceId: payment.invoice.id,
            clientName: payment.invoice.client?.name || 'Unknown',
            amount: parseFloat(payment.amount.toString()),
            currency: payment.currency,
          });
        }
      } catch (error) {
        console.error(`Failed to send payment notification: ${error}`);
      }
    }

    return updatedPayment;
  }

  /**
   * Get all payments for an invoice
   */
  async findByInvoiceId(invoiceId: string): Promise<Payment[]> {
    return this.paymentRepository.find({
      where: { invoiceId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Get payment by provider payment ID
   */
  async findByProviderPaymentId(providerPaymentId: string): Promise<Payment | null> {
    return this.paymentRepository.findOne({
      where: { providerPaymentId },
      relations: ['invoice'],
    });
  }
}

