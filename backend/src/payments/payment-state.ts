import { Payment, PaymentStatus } from '../entities/payment.entity';

/**
 * How provider events show on an invoice (docs/PAYMENTS.md).
 *
 * The invoice's own status (draft, sent, paid, ...) is a business status that
 * provider events never change on their own: a refund or dispute does not
 * reopen an invoice; the owner reopens it explicitly. Payment state is shown
 * beside it, from the completed payments in the invoice's currency:
 *   gross    = sum of completed payments
 *   refunded = sum of refunded amounts
 *   disputed = sum of disputed amounts while a dispute is open or was lost
 *   net      = gross - refunded - disputed (what the business keeps)
 * Money that cannot be counted (currency mismatch, flagged for review) is
 * excluded everywhere.
 */
export type PaymentState = 'none' | 'paid' | 'partially_refunded' | 'refunded' | 'disputed' | 'dispute_lost';

/** Provider dispute statuses after which the funds are returned to the merchant or never left. */
const DISPUTE_SETTLED_FOR_MERCHANT = new Set(['won', 'warning_closed']);

export function disputeIsOpen(status: string | null | undefined): boolean {
  return !!status && status !== 'lost' && !DISPUTE_SETTLED_FOR_MERCHANT.has(status);
}

export interface PaymentTotals {
  currency: string;
  grossCents: number;
  refundedCents: number;
  disputedCents: number;
  netCents: number;
  state: PaymentState;
}

const cents = (value: unknown) => Math.round(Number(value ?? 0) * 100);

export function counted(payment: Payment, currency: string): boolean {
  return (
    payment.status === PaymentStatus.COMPLETED &&
    payment.currency.toLowerCase() === currency.toLowerCase() &&
    !payment.metadataJson?.review_required
  );
}

export function paymentTotals(payments: Payment[], currency: string): PaymentTotals {
  let grossCents = 0;
  let refundedCents = 0;
  let disputedCents = 0;
  let openDispute = false;
  let lostDispute = false;
  for (const payment of payments) {
    if (!counted(payment, currency)) continue;
    const gross = cents(payment.amount);
    const refunded = Math.min(cents(payment.refundedAmount), gross);
    grossCents += gross;
    refundedCents += refunded;
    if (disputeIsOpen(payment.disputeStatus) || payment.disputeStatus === 'lost') {
      disputedCents += Math.min(cents(payment.disputedAmount) || gross - refunded, gross - refunded);
      if (payment.disputeStatus === 'lost') lostDispute = true;
      else openDispute = true;
    }
  }
  const netCents = Math.max(0, grossCents - refundedCents - disputedCents);
  let state: PaymentState = 'none';
  if (openDispute) state = 'disputed';
  else if (lostDispute) state = 'dispute_lost';
  else if (grossCents > 0 && refundedCents >= grossCents) state = 'refunded';
  else if (refundedCents > 0) state = 'partially_refunded';
  else if (grossCents > 0) state = 'paid';
  return { currency, grossCents, refundedCents, disputedCents, netCents, state };
}

export interface PaymentSummaryDto {
  currency: string;
  grossPaid: string;
  refunded: string;
  disputed: string;
  net: string;
  state: PaymentState;
  canReopen: boolean;
}

const money = (value: number) => (value / 100).toFixed(2);

export function paymentSummary(totals: PaymentTotals, invoiceStatus: string): PaymentSummaryDto {
  return {
    currency: totals.currency,
    grossPaid: money(totals.grossCents),
    refunded: money(totals.refundedCents),
    disputed: money(totals.disputedCents),
    net: money(totals.netCents),
    state: totals.state,
    canReopen: invoiceStatus === 'paid',
  };
}
