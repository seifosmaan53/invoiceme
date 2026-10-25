import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { Payment, PaymentStatus } from '../entities/payment.entity';
import { Invoice, InvoiceStatus } from '../entities/invoice.entity';
import { NotificationService } from '../core/services/notification.service';
import { User } from '../entities/user.entity';
import { ownedClient } from '../core/utils/cross-owner.util';

/** What a provider event did to the stored payment. */
export enum PaymentEventResult {
  APPLIED = 'applied',
  /** Already in that state (redelivery); nothing changed */
  DUPLICATE = 'duplicate',
  /** Would move a completed or refunded payment; nothing changed */
  STALE = 'stale',
  /** No payment with that provider id; nothing changed */
  UNKNOWN_PAYMENT = 'unknown_payment',
  /** The event disagrees with the stored payment; not applied */
  MISMATCH = 'mismatch',
}

const FINAL_PAYMENT_STATUSES = [PaymentStatus.COMPLETED, PaymentStatus.REFUNDED];

/**
 * The amount a succeeded PaymentIntent actually collected, in the stored
 * payment's units. Amounts were sent to Stripe as total * 100
 * (StripeService.createPaymentIntent), so they come back the same way.
 */
function receivedAmount(payment: Payment, paymentIntent: any): { amount: number } | { reason: string } {
  const currency = paymentIntent?.currency;
  if (typeof currency !== 'string' || currency.toLowerCase() !== payment.currency.toLowerCase()) {
    return { reason: 'currency_mismatch' };
  }
  const minor = paymentIntent?.amount_received;
  if (!Number.isInteger(minor) || minor <= 0) {
    return { reason: 'amount_received_missing' };
  }
  return { amount: minor / 100 };
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

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
   * Apply a provider event (Stripe payment_intent.succeeded / .payment_failed)
   * to the stored payment. Called only after the webhook signature has been
   * verified. The payment is found by the provider's id, which our server
   * created; nothing in the event can point it at another invoice.
   *
   * - Redelivered events change nothing (Stripe retries, and may deliver
   *   concurrently): the transition is a conditional UPDATE on the old status.
   * - A completed or refunded payment is never moved back by a late event.
   * - On success the amount actually received is recorded, and the invoice is
   *   marked paid only when completed payments in its currency cover its
   *   current total.
   */
  async updatePaymentStatus(
    providerPaymentId: string,
    status: PaymentStatus,
    paymentIntent?: any,
  ): Promise<PaymentEventResult> {
    const payment = await this.paymentRepository.findOne({
      where: { providerPaymentId },
      relations: ['invoice'],
    });

    if (!payment) {
      // Not created by this server (e.g. another integration on the same Stripe account)
      this.logger.warn(`Ignoring ${status} event for unknown payment ${providerPaymentId}`);
      return PaymentEventResult.UNKNOWN_PAYMENT;
    }

    const metadataInvoiceId = paymentIntent?.metadata?.invoice_id;
    if (metadataInvoiceId !== undefined && metadataInvoiceId !== payment.invoiceId) {
      this.logger.error(
        `Payment ${providerPaymentId} belongs to invoice ${payment.invoiceId} but the event names ${metadataInvoiceId}; not applied`,
      );
      return PaymentEventResult.MISMATCH;
    }

    if (payment.status === status) {
      return PaymentEventResult.DUPLICATE;
    }
    if (FINAL_PAYMENT_STATUSES.includes(payment.status)) {
      this.logger.warn(`Ignoring ${status} event for ${payment.status} payment ${providerPaymentId}`);
      return PaymentEventResult.STALE;
    }

    const metadataJson = { ...payment.metadataJson, ...(paymentIntent || {}) };
    const changes: Partial<Payment> = { status, metadataJson };

    if (status === PaymentStatus.COMPLETED) {
      const received = receivedAmount(payment, paymentIntent);
      if ('reason' in received) {
        // Money may have arrived, but it cannot be counted against this
        // invoice. Leave the payment as it is and flag it for review.
        await this.paymentRepository.update(
          { id: payment.id, status: payment.status },
          {
            // jsonb column: TypeORM's deep-partial type does not fit plain objects
            metadataJson: {
              ...payment.metadataJson,
              review_required: {
                reason: received.reason,
                amount_received: paymentIntent?.amount_received ?? null,
                currency: paymentIntent?.currency ?? null,
              },
            } as any,
          },
        );
        this.logger.error(`Payment ${providerPaymentId} succeeded but was not counted: ${received.reason}`);
        return PaymentEventResult.MISMATCH;
      }
      if (received.amount !== Number(payment.amount)) {
        metadataJson.requested_amount = Number(payment.amount);
        changes.amount = received.amount;
      }
    }

    const result = await this.paymentRepository.update({ id: payment.id, status: payment.status }, changes);
    if (!result.affected) {
      // A concurrent delivery of the same event got there first
      return PaymentEventResult.DUPLICATE;
    }

    if (status === PaymentStatus.COMPLETED && payment.invoice) {
      await this.markInvoicePaidIfCovered(payment.invoice, Number(changes.amount ?? payment.amount));
    }

    return PaymentEventResult.APPLIED;
  }

  /**
   * Marks the invoice paid once completed payments in its currency cover its
   * current total, and notifies the owner once.
   */
  private async markInvoicePaidIfCovered(invoice: Invoice, amount: number): Promise<void> {
    if (invoice.status === InvoiceStatus.PAID) {
      return;
    }

    const completed = await this.paymentRepository.find({
      where: { invoiceId: invoice.id, status: PaymentStatus.COMPLETED },
    });
    const paidCents = completed
      .filter((p) => p.currency.toLowerCase() === invoice.currency.toLowerCase())
      .reduce((sum, p) => sum + Math.round(Number(p.amount) * 100), 0);
    if (paidCents < Math.round(Number(invoice.total) * 100)) {
      return;
    }

    const result = await this.invoiceRepository.update(
      { id: invoice.id, status: Not(InvoiceStatus.PAID) },
      { status: InvoiceStatus.PAID },
    );
    if (!result.affected) {
      return;
    }

    try {
      const user = await this.userRepository.findOne({ where: { id: invoice.userId } });
      if (user) {
        await this.notificationService.notifyPaymentReceived({
          userEmail: user.email,
          userName: user.name,
          invoiceNumber: invoice.number,
          invoiceId: invoice.id,
          clientName: ownedClient(invoice)?.name || 'Unknown',
          amount,
          currency: invoice.currency,
        });
      }
    } catch (error) {
      console.error(`Failed to send payment notification: ${error}`);
    }
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

