# Phase 4 - Payments: Complete

## Overview

Phase 4 implements Stripe payment integration with payment intent creation and webhook handling to automatically update invoice status when payments are completed.

## ✅ Completed Components

### 1. Stripe Configuration

**Environment Variables:**

Added to `backend/env.example`:
```env
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here
```

**Getting Stripe Keys:**
1. Secret Key: https://dashboard.stripe.com/apikeys
   - Use test key (`sk_test_...`) for development
   - Use live key (`sk_live_...`) for production

2. Webhook Secret: https://dashboard.stripe.com/webhooks
   - Create webhook endpoint pointing to: `https://your-domain.com/api/v1/webhooks/stripe`
   - Select events: `payment_intent.succeeded`, `payment_intent.payment_failed`
   - Copy the signing secret (`whsec_...`)

### 2. Stripe Service

**Location:** `backend/src/core/services/stripe.service.ts`

**Methods:**
- `createPaymentIntent(amount, currency, metadata)` - Create Stripe PaymentIntent
- `retrievePaymentIntent(paymentIntentId)` - Retrieve payment intent details
- `verifyWebhookSignature(payload, signature)` - Verify webhook authenticity

**PaymentIntent Creation:**
- Converts amount from dollars to cents
- Sets currency (lowercase)
- Includes metadata (invoice_id, user_id, invoice_number)

### 3. Payment Intent Endpoint

**POST /v1/invoices/:id/pay**

Create a Stripe PaymentIntent for an invoice.

**Request:**
- Method: `POST`
- Path: `/v1/invoices/:id/pay`
- Authentication: Required (Bearer token)

**Validation:**
- ✅ Invoice must exist and belong to user
- ✅ Invoice must not be already paid
- ✅ Invoice must not be cancelled
- ✅ Invoice must not be an estimate (must convert first)
- ✅ Invoice total must be greater than zero

**Response (200 OK):**
```json
{
  "clientSecret": "pi_xxx_secret_xxx",
  "paymentIntentId": "pi_xxx",
  "amount": 1808.00,
  "currency": "USD"
}
```

**Process:**
1. Validates invoice can be paid
2. Creates Stripe PaymentIntent with invoice metadata
3. Creates payment record in database (status: pending)
4. Returns client secret for frontend payment processing

**Error Responses:**
- `400 Bad Request`: Invoice already paid, cancelled, or invalid
- `404 Not Found`: Invoice not found
- `403 Forbidden`: User doesn't own invoice

**Frontend Integration:**

Use the `clientSecret` with Stripe.js:

```javascript
const stripe = Stripe('pk_test_your_publishable_key');
const { clientSecret } = await fetch('/api/v1/invoices/123/pay', {
  headers: { Authorization: `Bearer ${token}` }
}).then(r => r.json());

const { error } = await stripe.confirmCardPayment(clientSecret, {
  payment_method: {
    card: cardElement,
  }
});
```

### 4. Stripe Webhook Endpoint

**POST /v1/webhooks/stripe**

Handle Stripe webhook events to update payment status and invoice status.

**Request:**
- Method: `POST`
- Path: `/v1/webhooks/stripe`
- Headers: `stripe-signature` (required)
- Body: Raw JSON (Stripe event payload)

**Configuration:**

Raw body parsing is configured in `main.ts`:
```typescript
app.use('/api/v1/webhooks/stripe', express.raw({ type: 'application/json' }));
```

This ensures the request body remains raw for signature verification.

**Webhook Events Handled:**

1. **payment_intent.succeeded**
   - Updates payment status to `completed`
   - Updates invoice status to `paid`
   - Logs payment completion

2. **payment_intent.payment_failed**
   - Updates payment status to `failed`
   - Logs payment failure

**Response (200 OK):**
```json
{
  "received": true
}
```

**Error Responses:**
- `400 Bad Request`: Missing signature header, invalid signature, or missing body

**Security:**
- Webhook signature verification using Stripe SDK
- Raw body parsing for accurate signature verification
- Logs all webhook events for debugging

**Webhook Flow:**

```
Stripe → POST /api/v1/webhooks/stripe
  ↓
Verify signature
  ↓
Parse event type
  ↓
payment_intent.succeeded
  ↓
Find payment by provider_payment_id
  ↓
Update payment status → completed
  ↓
Update invoice status → paid
  ↓
Log success
```

### 5. Payment Service

**Location:** `backend/src/payments/payments.service.ts`

**Methods:**
- `createPayment()` - Create payment record
- `updatePaymentStatus()` - Update payment status and invoice status
- `findByInvoiceId()` - Get all payments for an invoice
- `findByProviderPaymentId()` - Get payment by Stripe payment ID

**Payment Record:**
- Links to invoice
- Stores Stripe payment intent ID
- Tracks amount, currency, status
- Stores metadata (client secret, status, etc.)

**Invoice Status Update:**
- Automatically updates invoice status to `paid` when payment completes
- Only updates if payment status changes to `completed`

## Payment Flow

### Complete Payment Flow

1. **Create Payment Intent**
   ```
   POST /api/v1/invoices/:id/pay
   → Returns clientSecret
   ```

2. **Process Payment (Frontend)**
   ```
   Stripe.js confirmCardPayment(clientSecret)
   → Payment processed by Stripe
   ```

3. **Webhook Notification**
   ```
   Stripe → POST /api/v1/webhooks/stripe
   → payment_intent.succeeded event
   → Updates payment status
   → Updates invoice status to 'paid'
   ```

4. **Verify Payment**
   ```
   GET /api/v1/invoices/:id
   → status: "paid"
   ```

## Testing

### Test Payment Intent Creation

```bash
curl -X POST \
  http://localhost:3000/api/v1/invoices/{invoiceId}/pay \
  -H "Authorization: Bearer {token}"
```

### Test Webhook Locally

Use Stripe CLI:

```bash
stripe listen --forward-to localhost:3000/api/v1/webhooks/stripe
```

In another terminal:

```bash
stripe trigger payment_intent.succeeded
```

### Test Webhook Manually

```bash
curl -X POST \
  http://localhost:3000/api/v1/webhooks/stripe \
  -H "stripe-signature: {signature}" \
  -H "Content-Type: application/json" \
  -d @webhook-event.json
```

## Stripe Dashboard Setup

1. **Create Webhook Endpoint:**
   - URL: `https://your-domain.com/api/v1/webhooks/stripe`
   - Events: `payment_intent.succeeded`, `payment_intent.payment_failed`
   - Copy webhook signing secret

2. **Get API Keys:**
   - Secret Key: `sk_test_...` or `sk_live_...`
   - Publishable Key: `pk_test_...` or `pk_live_...` (for frontend)

## Environment Variables

Required in `.env`:

```env
STRIPE_SECRET_KEY=sk_test_51xxx...
STRIPE_WEBHOOK_SECRET=whsec_xxx...
```

## Payment Status Flow

```
Pending → Completed → Invoice marked as paid
   ↓
Failed → Payment failed (invoice stays unpaid)
```

## Error Handling

- **Missing Signature**: Returns 400 Bad Request
- **Invalid Signature**: Returns 400 Bad Request with error message
- **Payment Not Found**: Returns 404 Not Found (webhook for unknown payment)
- **Invoice Already Paid**: Returns 400 Bad Request (prevents duplicate payments)

## Logging

All payment events are logged:
- Payment intent creation
- Payment success
- Payment failure
- Invoice status updates

## Phase 4 Checklist

- ✅ Stripe secret key in environment variables
- ✅ POST /v1/invoices/:id/pay endpoint
- ✅ Payment intent creation with validation
- ✅ Payment record creation in database
- ✅ POST /v1/webhooks/stripe endpoint
- ✅ Webhook signature verification
- ✅ Payment status updates
- ✅ Invoice status updates (paid)
- ✅ Error handling and logging
- ✅ Swagger documentation

## Next Steps

Phase 4 is complete. Ready for:
- Phase 5: Mobile Sync
- Phase 6: Email Notifications
- Phase 7: Advanced Features

All payment functionality is implemented and ready for production use.

