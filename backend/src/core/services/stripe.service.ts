import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private stripe: Stripe | null = null;
  private readonly secretKey: string | undefined;
  private readonly webhookSecret: string | undefined;

  constructor(private configService: ConfigService) {
    this.secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    this.webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET');

    // Only initialize Stripe if a valid key is provided
    if (this.isAvailable()) {
      try {
        this.stripe = new Stripe(this.secretKey!, {
          apiVersion: '2023-10-16',
        });
        this.logger.log('Stripe service initialized successfully');
      } catch (error) {
        this.logger.error('Failed to initialize Stripe:', error);
        this.stripe = null;
      }
    } else {
      this.logger.warn('Stripe is not configured. STRIPE_SECRET_KEY is missing or invalid.');
    }
  }

  /**
   * Check if Stripe is properly configured and available
   */
  isAvailable(): boolean {
    if (!this.secretKey || this.secretKey.trim().length === 0) {
      return false;
    }

    // Validate key format (should start with sk_test_ or sk_live_)
    const isValidFormat = /^sk_(test_|live_)/.test(this.secretKey);
    if (!isValidFormat) {
      this.logger.warn(`Invalid Stripe key format. Expected sk_test_... or sk_live_..., got: ${this.secretKey.substring(0, 10)}...`);
      return false;
    }

    // Check if key is not a placeholder
    if (this.secretKey.includes('your_stripe_secret_key_here') || 
        this.secretKey.includes('sk_test_your') ||
        this.secretKey.length < 20) {
      return false;
    }

    return true;
  }

  /**
   * Ensure Stripe is available before making API calls
   */
  private ensureAvailable(): void {
    if (!this.isAvailable() || !this.stripe) {
      throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY in your environment variables.');
    }
  }

  async createPaymentIntent(amount: number, currency: string, metadata: Record<string, string>): Promise<Stripe.PaymentIntent> {
    this.ensureAvailable();

    try {
      return await this.stripe!.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency: currency.toLowerCase(),
        metadata,
      });
    } catch (error: any) {
      this.logger.error('Stripe API error:', error?.message || error);
      
      // Provide more helpful error messages
      if (error?.type === 'StripeInvalidRequestError' && error?.message?.includes('Invalid API Key')) {
        throw new Error('Invalid Stripe API key. Please check your STRIPE_SECRET_KEY environment variable.');
      }
      
      throw error;
    }
  }

  async retrievePaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
    this.ensureAvailable();
    return await this.stripe!.paymentIntents.retrieve(paymentIntentId);
  }

  verifyWebhookSignature(payload: string, signature: string): Stripe.Event {
    this.ensureAvailable();

    if (!this.webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is required for webhook verification');
    }

    return this.stripe!.webhooks.constructEvent(
      payload,
      signature,
      this.webhookSecret,
    );
  }
}

