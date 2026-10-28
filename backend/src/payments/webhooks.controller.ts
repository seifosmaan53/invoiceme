import { Controller, Post, Headers, HttpCode, HttpStatus, RawBodyRequest, Req, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { StripeService } from '../core/services/stripe.service';
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
      // Message only: the error object can carry the raw payload (client_secret)
      console.error('Webhook error:', error?.message);
      throw new BadRequestException(`Webhook signature verification failed: ${error.message}`);
    }

    // Errors past this point are ours, not the sender's: they surface as 5xx
    // so Stripe redelivers the event. Redelivery is safe (see updatePaymentStatus).
    // Payment, refund and dispute events; each event id is acted on once,
    // refund and dispute state is read back from Stripe (PaymentsService).
    const result = await this.paymentsService.handleProviderEvent(event as any);
    console.log(`Stripe event ${event.id} (${event.type}): ${result}`);

    return { received: true };
  }
}

