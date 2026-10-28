# Proposal: refunds and disputes

Status: **proposal, not implemented.** It needs the owner's decision below.
Nothing here changes behaviour.

## What happens today

The Stripe webhook acts on two events only: `payment_intent.succeeded` (the
payment becomes `completed` and the invoice `paid` once completed payments in
its currency cover the total) and `payment_intent.payment_failed`. Every
other event, including `charge.refunded` and `charge.dispute.*`, is logged as
unhandled and answered 200.

So when money goes back to the customer, through a refund issued in the
Stripe Dashboard or a lost dispute, InvoiceMe keeps the invoice `paid` and
the payment `completed`. The owner's reports and the client's balance then
overstate what was collected, and nobody is told. `PaymentStatus.REFUNDED`
exists in the schema but nothing sets it.

## Decision needed

**When money paid on an invoice is returned (refund or lost dispute), what
should InvoiceMe do?** One choice covers both cases:

- **A. Record and reopen (recommended).** Record the returned amount on the
  payment. A full refund marks the payment `refunded`. The invoice goes back
  to `sent` (or `overdue` if past due) when the remaining completed payments
  no longer cover its total, and the owner is notified. A dispute that is
  still open is only flagged for review.
- **B. Record only.** Record the refund or dispute on the payment and notify
  the owner, but leave the invoice status for the owner to change by hand.
- **C. Keep ignoring.** Leave it to the owner to notice in Stripe. Then
  document that InvoiceMe statuses do not reflect refunds.

A and B need: the webhook events subscribed in Stripe, idempotent handling
like the existing events, partial-refund amounts in the invoice currency, and
tests with signed synthetic events. Past refunds are not reconstructed; only
events received after the change are applied.

## Stored client_secret (already fixed going forward)

Since the fix that accompanies this proposal, `client_secret` is no longer
stored in `payments.metadata_json`. Rows created earlier still contain it.
InvoiceMe never uses them again (each `/pay` call creates a new intent), but a
secret for an intent that was abandoned or failed (`requires_payment_method`)
can still be used to confirm that intent at Stripe, and database backups keep
the secrets until they are removed there too.

Count affected rows (read-only):

```sql
SELECT count(*) FROM payments
WHERE metadata_json ? 'client_secret';
```

Removing them is an **owner decision**, because it rewrites existing payment
rows. Run it only after a verified backup:

```sql
UPDATE payments SET metadata_json = metadata_json - 'client_secret'
WHERE metadata_json ? 'client_secret';
```
