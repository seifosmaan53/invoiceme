import { Controller, Post, Headers, HttpCode, HttpStatus, RawBodyRequest, Req, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { StripeService } from '../core/services/stripe.service';
import { PaymentStatus } from '../entities/payment.entity';

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
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new BadRequestException('Missing request body');
    }

    try {
      // Verify webhook signature
      const event = this.stripeService.verifyWebhookSignature(
        rawBody.toString(),
        signature,
      );

      // Handle payment intent events
      if (event.type === 'payment_intent.succeeded') {
        const paymentIntent = event.data.object as any;
        
        console.log(`Payment succeeded: ${paymentIntent.id} for invoice ${paymentIntent.metadata?.invoice_id}`);
        
        // Update payment status and invoice
        await this.paymentsService.updatePaymentStatus(
          paymentIntent.id,
          PaymentStatus.COMPLETED,
          paymentIntent,
        );
      } else if (event.type === 'payment_intent.payment_failed') {
        const paymentIntent = event.data.object as any;
        
        console.log(`Payment failed: ${paymentIntent.id} for invoice ${paymentIntent.metadata?.invoice_id}`);
        
        // Update payment status
        await this.paymentsService.updatePaymentStatus(
          paymentIntent.id,
          PaymentStatus.FAILED,
          paymentIntent,
        );
      } else {
        console.log(`Unhandled event type: ${event.type}`);
      }

      return { received: true };
    } catch (error) {
      console.error('Webhook error:', error);
      throw new BadRequestException(`Webhook signature verification failed: ${error.message}`);
    }
  }
}

