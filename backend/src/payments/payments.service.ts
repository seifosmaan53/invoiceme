import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Not, Repository } from 'typeorm';
import { Payment, PaymentProvider, PaymentStatus } from '../entities/payment.entity';
import { PaymentEvent } from '../entities/payment-event.entity';
import { StripeService } from '../core/services/stripe.service';
import { Invoice, InvoiceStatus, InvoiceType } from '../entities/invoice.entity';
import { NotificationService } from '../core/services/notification.service';
import { User } from '../entities/user.entity';
import { ownedClient } from '../core/utils/cross-owner.util';
import { isOnlinePaymentCurrency, UnsupportedPaymentCurrencyError, withoutClientSecret } from './payment-currency';
import { businessToday, toCalendarDate } from '../common/calendar-date';
import { paymentSummary, PaymentSummaryDto, paymentTotals } from './payment-state';

/** The parts of a verified provider event the webhook acts on. */
export interface ProviderEvent {
  id: string;
  type: string;
  created?: number;
  data: { object: any };
}

export interface CheckoutAttempt {
  clientSecret: string;
  paymentIntentId: string;
  /** Amount of this attempt (the amount still due), in invoice currency units. */
  amount: number;
  currency: string;
  /** An open attempt for the same amount was returned instead of a new one. */
  reused: boolean;
}

/** PaymentIntent statuses in which the customer can still complete the payment. */
const REUSABLE_INTENT = new Set(['requires_payment_method', 'requires_confirmation', 'requires_action']);

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
    @InjectRepository(PaymentEvent)
    private eventRepository: Repository<PaymentEvent>,
    private notificationService: NotificationService,
    private stripeService: StripeService,
    private dataSource: DataSource,
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

    // Keep the PaymentIntent for reference, without its client_secret
    const metadataJson = { ...payment.metadataJson, ...(withoutClientSecret(paymentIntent) || {}) };
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

    // Net of refunds and disputes (payments/payment-state.ts), so an event
    // arriving after a refund cannot mark the invoice paid again.
    const completed = await this.paymentRepository.find({
      where: { invoiceId: invoice.id, status: PaymentStatus.COMPLETED },
    });
    if (paymentTotals(completed, invoice.currency).netCents < Math.round(Number(invoice.total) * 100)) {
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

  /** Payment state of an invoice, shown beside its own status. */
  async summaryFor(invoice: Invoice): Promise<PaymentSummaryDto> {
    const payments = await this.paymentRepository.find({ where: { invoiceId: invoice.id } });
    const totals = paymentTotals(payments, invoice.currency);
    const summary = paymentSummary(totals, invoice.status);
    // Reopening only makes sense when part of the money went back, and not
    // while a dispute is open: if it is won, the customer would pay twice.
    summary.canReopen =
      summary.canReopen && totals.state !== 'disputed' && totals.netCents < Math.round(Number(invoice.total) * 100);
    return summary;
  }

  /** Payments of an invoice with their provider events, without provider objects or secrets. */
  async historyFor(invoiceId: string) {
    const payments = await this.paymentRepository.find({ where: { invoiceId }, order: { createdAt: 'ASC' } });
    const events = payments.length
      ? await this.eventRepository
          .createQueryBuilder('e')
          .where('e.paymentId IN (:...ids)', { ids: payments.map((p) => p.id) })
          .orderBy('e.receivedAt', 'ASC')
          .getMany()
      : [];
    return payments.map((p) => ({
      id: p.id,
      status: p.status,
      amount: Number(p.amount).toFixed(2),
      currency: p.currency,
      refundedAmount: Number(p.refundedAmount ?? 0).toFixed(2),
      disputeStatus: p.disputeStatus,
      disputedAmount: Number(p.disputedAmount ?? 0).toFixed(2),
      reviewRequired: !!p.metadataJson?.review_required,
      createdAt: p.createdAt,
      events: events
        .filter((e) => e.paymentId === p.id)
        .map((e) => ({ type: e.type, outcome: e.outcome, details: e.details, receivedAt: e.receivedAt })),
    }));
  }

  /**
   * Process one verified Stripe event (signature checked by the webhook
   * controller). Every event id is acted on at most once to completion;
   * refund and dispute state is read back from Stripe (authoritative), so
   * duplicate or out-of-order deliveries cannot move it backwards.
   */
  async handleProviderEvent(event: ProviderEvent): Promise<string> {
    // Stripe events always carry an id; without one the event is still
    // processed (the state it sets is idempotent) but cannot be recorded.
    const done = event.id ? await this.eventRepository.findOne({ where: { providerEventId: event.id } }) : null;
    if (done) return PaymentEventResult.DUPLICATE;

    const object = event.data?.object ?? {};
    let outcome: string;
    let paymentId: string | null = null;
    let details: Record<string, any> = { object_id: object.id ?? null };

    switch (event.type) {
      case 'payment_intent.succeeded':
      case 'payment_intent.payment_failed':
      case 'payment_intent.canceled': {
        const status = event.type === 'payment_intent.succeeded' ? PaymentStatus.COMPLETED : PaymentStatus.FAILED;
        outcome = await this.updatePaymentStatus(object.id, status, object);
        paymentId = (await this.paymentRepository.findOne({ where: { providerPaymentId: object.id } }))?.id ?? null;
        details = { ...details, status: object.status ?? null, amount_received: object.amount_received ?? null, currency: object.currency ?? null };
        break;
      }
      case 'charge.refunded':
      case 'charge.refund.updated':
      case 'refund.created':
      case 'refund.updated':
      case 'refund.failed': {
        const chargeId = event.type === 'charge.refunded' ? object.id : object.charge;
        ({ outcome, paymentId, details } = await this.applyRefundState(chargeId));
        break;
      }
      default:
        if (event.type.startsWith('charge.dispute.')) {
          ({ outcome, paymentId, details } = await this.applyDisputeState(object.id));
        } else {
          outcome = 'ignored';
        }
    }

    if (!event.id) return outcome;
    await this.eventRepository
      .createQueryBuilder()
      .insert()
      .values({
        providerEventId: event.id,
        paymentId,
        type: event.type,
        outcome,
        details,
        providerCreatedAt: event.created ? new Date(event.created * 1000) : null,
      })
      .orIgnore()
      .execute();
    return outcome;
  }

  private async paymentForIntent(intentId: string | null | undefined): Promise<Payment | null> {
    if (!intentId) return null;
    return this.paymentRepository.findOne({ where: { providerPaymentId: intentId } });
  }

  /** Refunded amount from the charge as Stripe holds it now. */
  private async applyRefundState(chargeId: string) {
    const charge: any = await this.stripeService.retrieveCharge(chargeId);
    const details = {
      object_id: chargeId,
      amount_refunded: charge.amount_refunded ?? null,
      currency: charge.currency ?? null,
      payment_intent: typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id ?? null,
    };
    const payment = await this.paymentForIntent(details.payment_intent);
    if (!payment) return { outcome: PaymentEventResult.UNKNOWN_PAYMENT as string, paymentId: null, details };

    const refunded = Number(charge.amount_refunded) / 100;
    if (
      typeof charge.currency !== 'string' ||
      charge.currency.toLowerCase() !== payment.currency.toLowerCase() ||
      !Number.isInteger(charge.amount_refunded) ||
      refunded < 0 ||
      refunded > Number(payment.amount)
    ) {
      this.logger.error(`Refund state for payment ${payment.id} does not match it (amount or currency); not applied`);
      return { outcome: PaymentEventResult.MISMATCH as string, paymentId: payment.id, details };
    }
    if (Number(payment.refundedAmount) === refunded && payment.providerChargeId === chargeId) {
      return { outcome: PaymentEventResult.DUPLICATE as string, paymentId: payment.id, details };
    }
    await this.paymentRepository.update(payment.id, { refundedAmount: refunded, providerChargeId: chargeId });
    return { outcome: PaymentEventResult.APPLIED as string, paymentId: payment.id, details };
  }

  /** Dispute status and amount as Stripe holds them now. */
  private async applyDisputeState(disputeId: string) {
    const dispute: any = await this.stripeService.retrieveDispute(disputeId);
    let intentId = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : dispute.payment_intent?.id ?? null;
    const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id ?? null;
    if (!intentId && chargeId) {
      const charge: any = await this.stripeService.retrieveCharge(chargeId);
      intentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id ?? null;
    }
    const details = { object_id: disputeId, status: dispute.status ?? null, amount: dispute.amount ?? null, currency: dispute.currency ?? null, payment_intent: intentId };
    const payment = await this.paymentForIntent(intentId);
    if (!payment) return { outcome: PaymentEventResult.UNKNOWN_PAYMENT as string, paymentId: null, details };

    const amount = Number(dispute.amount) / 100;
    if (
      typeof dispute.currency !== 'string' ||
      dispute.currency.toLowerCase() !== payment.currency.toLowerCase() ||
      !Number.isInteger(dispute.amount) ||
      amount < 0 ||
      amount > Number(payment.amount) ||
      typeof dispute.status !== 'string'
    ) {
      this.logger.error(`Dispute state for payment ${payment.id} does not match it (amount or currency); not applied`);
      return { outcome: PaymentEventResult.MISMATCH as string, paymentId: payment.id, details };
    }
    if (payment.disputeStatus === dispute.status && Number(payment.disputedAmount) === amount) {
      return { outcome: PaymentEventResult.DUPLICATE as string, paymentId: payment.id, details };
    }
    await this.paymentRepository.update(payment.id, { disputeStatus: dispute.status, disputedAmount: amount, providerChargeId: chargeId ?? payment.providerChargeId });
    return { outcome: PaymentEventResult.APPLIED as string, paymentId: payment.id, details };
  }

  /**
   * Start or resume online payment of an invoice (docs/PAYMENTS.md). Runs
   * under a per-invoice lock, so concurrent requests see each other's
   * attempt. An open attempt for the same amount and currency is returned
   * again (its client_secret read back from Stripe, never stored); one for a
   * different amount is cancelled first; a succeeded or processing one stops
   * a second charge. The caller has checked ownership and invoice status.
   */
  async startCheckout(invoice: Invoice): Promise<CheckoutAttempt> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pay:${invoice.id}`]);
      // Read the invoice again under the lock: it may have been paid, cancelled
      // or changed since the caller loaded it (review F6).
      const fresh = await manager.getRepository(Invoice).findOne({ where: { id: invoice.id }, loadEagerRelations: false });
      if (!fresh || fresh.deletedAt) throw new BadRequestException('Invoice not found');
      if (fresh.status === InvoiceStatus.PAID) throw new BadRequestException('Invoice is already paid');
      if (fresh.status === InvoiceStatus.CANCELLED) throw new BadRequestException('Cannot create payment for cancelled invoice');
      // The caller's checks, again on the fresh row (review N4)
      if (fresh.type === InvoiceType.ESTIMATE) throw new BadRequestException('Cannot create payment for estimate. Convert to invoice first.');
      if (!(Number(fresh.total) > 0)) throw new BadRequestException('Invoice total must be greater than zero');
      if (!isOnlinePaymentCurrency(fresh.currency)) throw new BadRequestException(new UnsupportedPaymentCurrencyError(fresh.currency).message);
      invoice = { ...invoice, total: fresh.total, currency: fresh.currency, status: fresh.status } as Invoice;
      const payments = manager.getRepository(Payment);
      const all = await payments.find({ where: { invoiceId: invoice.id }, order: { createdAt: 'DESC' } });
      const currency = invoice.currency.trim().toUpperCase();
      const totals = paymentTotals(all, currency);
      // An open dispute may still be won: asking again could make the customer pay twice (review N6)
      if (totals.state === 'disputed') {
        throw new ConflictException('A dispute on this invoice is open; online payment waits for its outcome');
      }
      const dueCents = Math.round(Number(invoice.total) * 100) - totals.netCents;
      if (dueCents <= 0) {
        throw new BadRequestException('Nothing is due on this invoice');
      }

      for (const attempt of all.filter((p) => p.status === PaymentStatus.PENDING && p.provider === PaymentProvider.STRIPE)) {
        let intent: any;
        try {
          intent = await this.stripeService.retrievePaymentIntent(attempt.providerPaymentId);
        } catch {
          throw new ServiceUnavailableException('Could not check the previous payment attempt; try again shortly');
        }
        if (intent?.metadata?.invoice_id !== invoice.id) {
          // Never hand out an intent that is not this invoice's
          await payments.update(attempt.id, { status: PaymentStatus.FAILED, metadataJson: { ...attempt.metadataJson, closed_reason: 'invoice_mismatch' } as any });
          continue;
        }
        if (intent.status === 'succeeded') {
          throw new ConflictException('A payment for this invoice succeeded and is being recorded; refresh in a moment');
        }
        if (!REUSABLE_INTENT.has(intent.status) && intent.status !== 'canceled') {
          throw new ConflictException('A payment for this invoice is being processed');
        }
        if (intent.status !== 'canceled' && intent.amount === dueCents && String(intent.currency).toUpperCase() === currency) {
          return { clientSecret: intent.client_secret, paymentIntentId: intent.id, amount: dueCents / 100, currency, reused: true };
        }
        if (intent.status !== 'canceled') {
          try {
            await this.stripeService.cancelPaymentIntent(intent.id);
          } catch {
            throw new ServiceUnavailableException('Could not cancel the previous payment attempt; try again shortly');
          }
        }
        await payments.update(attempt.id, {
          status: PaymentStatus.FAILED,
          metadataJson: { ...attempt.metadataJson, closed_reason: intent.status === 'canceled' ? 'canceled' : 'superseded' } as any,
        });
      }

      const idempotencyKey = `invoiceme-pay-${invoice.id}-${all.length + 1}-${dueCents}-${currency.toLowerCase()}`;
      const intent = await this.stripeService.createPaymentIntent(
        dueCents / 100,
        currency,
        { invoice_id: invoice.id, user_id: invoice.userId, invoice_number: invoice.number },
        idempotencyKey,
      );
      await payments.save(
        payments.create({
          invoiceId: invoice.id,
          providerPaymentId: intent.id,
          amount: dueCents / 100,
          currency,
          status: PaymentStatus.PENDING,
          idempotencyKey,
          // client_secret goes only to the caller; it is not stored
          metadataJson: { payment_intent_id: intent.id, status: intent.status },
        }),
      );
      return { clientSecret: intent.client_secret, paymentIntentId: intent.id, amount: dueCents / 100, currency, reused: false };
    });
  }

  /**
   * Reopen a paid invoice after money went back to the customer (refund or
   * lost dispute). Explicit owner action: provider events never reopen an
   * invoice. Decided under the same per-invoice lock as checkout, on the
   * invoice and payments as they are inside it (review N5). The invoice
   * becomes sent, or overdue past its due date (business-timezone today);
   * online payment then asks only for the amount still due.
   */
  async reopenInvoice(invoiceId: string, userId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pay:${invoiceId}`]);
      const invoices = manager.getRepository(Invoice);
      const invoice = await invoices.findOne({
        where: { id: invoiceId, userId, deletedAt: IsNull() },
        loadEagerRelations: false,
        lock: { mode: 'pessimistic_write' },
      });
      if (!invoice) throw new NotFoundException('Invoice not found');
      if (invoice.status !== InvoiceStatus.PAID) {
        throw new BadRequestException('Only a paid invoice can be reopened');
      }
      const totals = paymentTotals(await manager.getRepository(Payment).find({ where: { invoiceId } }), invoice.currency);
      if (totals.state === 'disputed') {
        throw new ConflictException('A dispute on this invoice is still open; reopen it once the dispute is decided');
      }
      if (totals.netCents >= Math.round(Number(invoice.total) * 100)) {
        throw new ConflictException('Nothing would be due: the payments received still cover this invoice');
      }
      const overdue = invoice.dueDate && toCalendarDate(invoice.dueDate) < businessToday();
      await invoices.update(invoice.id, { status: overdue ? InvoiceStatus.OVERDUE : InvoiceStatus.SENT });
    });
  }
}
