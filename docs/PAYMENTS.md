# Online payments, refunds and disputes

How InvoiceMe handles Stripe payments (`backend/src/payments/`,
`POST /api/v1/invoices/:id/pay`, `POST /api/v1/webhooks/stripe`). Tests:
`backend/test/payments-authz.e2e-spec.ts` and `payments.e2e-spec.ts` (real
PostgreSQL; Stripe calls are mocked, signatures are real).

## Invoice status and payment state are separate

An invoice's **status** (draft, sent, overdue, paid, cancelled) is a business
status. Provider events set it to `paid` only when completed payments cover
the total; **refunds and disputes never change it**. Beside it, every invoice
read (`GET /invoices/:id`) returns a **payment summary**:

| field | meaning |
|---|---|
| `grossPaid` | completed payments in the invoice's currency |
| `refunded` | amount returned to the customer by refunds |
| `disputed` | amount in an open or lost dispute |
| `net` | `grossPaid - refunded - disputed`: what the business keeps |
| `state` | `none`, `paid`, `partially_refunded`, `refunded`, `disputed`, `dispute_lost` |
| `canReopen` | the invoice is paid, `net` no longer covers the total, and no dispute is open |

The three amounts are separate figures; none of them is "the" total.
Payments in another currency, or flagged for review (amount or currency
mismatch), are not counted at all.

- **Partial refund:** the refunded amount is recorded on the payment (which
  stays `completed`, so the original successful payment is kept). The invoice
  stays `paid`; no new amount is owed.
- **Full refund:** state `refunded`, invoice still `paid`, nothing owed.
- **Dispute:** state `disputed` while open; `won` returns the money and the
  state to `paid`; `lost` shows `dispute_lost`. The provider's status and
  amount are recorded on the payment and every update in the event history.
- **Reopen:** `POST /invoices/:id/reopen` (`write:invoices`) is the only way a
  paid invoice owes money again. It is allowed when `canReopen` is true (never
  while a dispute is open: if it were won the customer would pay twice) and
  sets the status to `sent` (or `overdue` past its due date). Online payment
  then asks only for the amount still due (`total - net`).
- **Reads** recompute the status from **net** amounts, so a refunded payment
  does not mark a reopened invoice paid again.

`GET /invoices/:id/payments` (`read:invoices`) lists the payments with their
refund, dispute and event history (provider ids, amounts, statuses; never
provider objects or secrets).

## Provider events

The webhook verifies Stripe's signature on the raw request bytes, then hands
the event over. Every event id is processed at most once to completion
(`payment_events`, unique on the provider event id); a processing error
answers 5xx so Stripe redelivers.

| event | action |
|---|---|
| `payment_intent.succeeded` | payment completed if amount and currency match; invoice paid when net covers the total |
| `payment_intent.payment_failed`, `.canceled` | pending payment marked failed |
| `charge.refunded`, `charge.refund.updated`, `refund.*` | the **charge is retrieved from Stripe** and its `amount_refunded` recorded |
| `charge.dispute.*` | the **dispute is retrieved from Stripe** and its status and amount recorded |
| anything else | recorded as `ignored` |

Refund and dispute state is always taken from the object Stripe holds now,
not from the event, so duplicate or out-of-order deliveries cannot move it
backwards, and a refund that arrives before the success event still keeps
the invoice from being marked paid. A refund or dispute whose currency
differs from the payment, or whose amount exceeds it, is recorded as
`mismatch` and not applied. Events for intents this server did not create are
recorded as `unknown_payment`. Stripe must be configured to send the refund
and dispute events to the webhook endpoint for these states to appear.

## Checkout attempts (`POST /invoices/:id/pay`)

Requests for one invoice run one at a time (a database lock), so concurrent
requests see each other's attempt; the invoice is read again under that lock,
so one paid, cancelled or changed in the meantime (currency, type, total) is
not charged on stale data. Reopening runs under the same lock.

| previous attempt (as Stripe reports it now) | result |
|---|---|
| none | new PaymentIntent for the amount due |
| open (`requires_payment_method`, `_confirmation`, `_action`), same amount and currency | returned again (`reused: true`); its client_secret is read back from Stripe, not stored |
| open, different amount or currency (invoice changed) | cancelled at Stripe, marked failed (`superseded`), new attempt created |
| `canceled` | marked failed, new attempt created |
| a dispute on the invoice is open | 409, no new charge until it is decided |
| `processing` | 409, no new charge |
| `succeeded`, webhook not yet received | 409, no new charge |
| Stripe cannot be reached to check it | 503, no new charge |
| belongs to another invoice (damaged data) | retired, never returned |

Before any of this: a paid invoice answers 400 (no second charge), so do
cancelled invoices, estimates, zero totals, nothing due, and currencies
outside USD, EUR, GBP, CAD, AUD. A refunded or disputed invoice stays paid
until the owner reopens it. New intents carry the Stripe idempotency key
`invoiceme-pay-<invoice id>-<attempt number>-<amount in cents>-<currency>`
(no secrets), so a retried creation request returns the same intent.

## Not handled

- Refunds and disputes created before migration 020 are not reconstructed;
  only events received afterwards are applied.
- Zero- and three-decimal currencies are refused for online payment (see
  `payments/payment-currency.ts`).
- Stored `client_secret` values from before PR #16: see
  `npm run payments:scrub-secrets` (owner-run; docs/operations/customer-update.md).
