import { Controller, Post, Headers, HttpCode, HttpStatus, RawBodyRequest, Req, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { StripeService } from '../core/services/stripe.service';
import { PaymentStatus } from '../entities/payment.entity';
import Stripe from 'stripe';

@ApiTags('Webhooks')
@Controller('v1/webhooks')
export class WebhooksController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly stripeService: StripeService,
  ) {}

  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Handle Stripe webhook events' })
  @ApiResponse({ status: 200, description: 'Webhook processed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid webhook signature' })
  async handleStripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    // Check if Stripe is configured
    if (!this.stripeService.isAvailable()) {
      throw new BadRequestException('Stripe is not configured. Webhook processing is unavailable.');
    }

    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }

    // NestFactory's rawBody option fills req.rawBody, but main.ts mounts
    // express.raw() on this route first, which leaves req.rawBody unset and
    // the untouched bytes in req.body. Never use a re-serialized JSON body.
    const rawBody = req.rawBody ?? ((req as any).body instanceof Buffer ? ((req as any).body as Buffer) : undefined);
    if (!rawBody || rawBody.length === 0) {
      throw new BadRequestException('Missing request body');
    }

    let event: Stripe.Event;
    try {
      event = this.stripeService.verifyWebhookSignature(rawBody, signature);
    } catch (error) {
      console.error('Webhook error:', error);
      throw new BadRequestException(`Webhook signature verification failed: ${error.message}`);
    }

    // Errors past this point are ours, not the sender's: they surface as 5xx
    // so Stripe redelivers the event. Redelivery is safe (see updatePaymentStatus).
    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object as any;
      console.log(`Payment succeeded: ${paymentIntent.id} for invoice ${paymentIntent.metadata?.invoice_id}`);
      const result = await this.paymentsService.updatePaymentStatus(paymentIntent.id, PaymentStatus.COMPLETED, paymentIntent);
      console.log(`Payment ${paymentIntent.id}: ${result}`);
    } else if (event.type === 'payment_intent.payment_failed') {
      const paymentIntent = event.data.object as any;
      console.log(`Payment failed: ${paymentIntent.id} for invoice ${paymentIntent.metadata?.invoice_id}`);
      const result = await this.paymentsService.updatePaymentStatus(paymentIntent.id, PaymentStatus.FAILED, paymentIntent);
      console.log(`Payment ${paymentIntent.id}: ${result}`);
    } else {
      console.log(`Unhandled event type: ${event.type}`);
    }

    return { received: true };
  }
}

