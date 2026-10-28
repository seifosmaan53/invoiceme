/**
 * Currencies the online payment flow (POST /invoices/:id/pay and the Stripe
 * webhook) handles correctly.
 *
 * Amounts are sent to Stripe as total * 100 and read back / 100
 * (StripeService.createPaymentIntent, PaymentsService). That is right only for
 * plain two-decimal currencies. Zero-decimal currencies (such as JPY or KRW)
 * would be charged 100 times the invoice total, and Stripe has other
 * per-currency rules (three-decimal currencies; ISK and UGX need whole
 * units). So the flow allows a short, verified list and refuses the rest.
 *
 * To add a currency: confirm in Stripe's currency documentation that it is a
 * plain two-decimal presentment currency for the account, then add it here.
 * Invoices in other currencies can still be created and marked paid by hand.
 */
export const ONLINE_PAYMENT_CURRENCIES: ReadonlySet<string> = new Set(['USD', 'EUR', 'GBP', 'CAD', 'AUD']);

export function isOnlinePaymentCurrency(currency: string | null | undefined): boolean {
  return typeof currency === 'string' && ONLINE_PAYMENT_CURRENCIES.has(currency.trim().toUpperCase());
}

export class UnsupportedPaymentCurrencyError extends Error {
  constructor(currency: string | null | undefined) {
    super(
      `Online payment is not available for ${currency || 'this currency'}. ` +
        `Supported: ${[...ONLINE_PAYMENT_CURRENCIES].join(', ')}.`,
    );
  }
}

/** The fields of a Stripe PaymentIntent worth keeping, without client_secret. */
export function withoutClientSecret<T extends Record<string, any> | null | undefined>(value: T): T {
  if (!value || typeof value !== 'object') return value;
  const copy: Record<string, any> = { ...value };
  delete copy.client_secret;
  return copy as T;
}
