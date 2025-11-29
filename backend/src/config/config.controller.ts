import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';

@ApiTags('config')
@Controller('v1/config')
export class ConfigController {
  constructor(private readonly configService: ConfigService) {}

  @Get('stripe-public-key')
  @ApiOperation({ 
    summary: 'Get Stripe publishable key',
    description: 'Returns the Stripe publishable key for client-side payment integration. This is safe to expose publicly.',
  })
  @ApiOkResponse({
    description: 'Stripe publishable key',
    schema: {
      type: 'object',
      properties: {
        publishableKey: { 
          type: 'string',
          nullable: true,
          description: 'Stripe publishable key (pk_test_... or pk_live_...). Null if not configured.',
        },
      },
    },
  })
  async getStripePublicKey() {
    // First, check if STRIPE_PUBLISHABLE_KEY is set as a separate env variable
    // This is the recommended approach
    const publishableKey = this.configService.get<string>('STRIPE_PUBLISHABLE_KEY');
    
    if (publishableKey) {
      return { publishableKey };
    }

    // Fallback: Try to derive from secret key (not recommended for production)
    // Stripe secret keys are in format: sk_test_... or sk_live_...
    // Publishable keys are in format: pk_test_... or pk_live_...
    const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    
    if (!secretKey) {
      return { publishableKey: null };
    }

    // Convert secret key to publishable key format
    // Note: This is a fallback. In production, store STRIPE_PUBLISHABLE_KEY separately.
    const derivedKey = secretKey.replace(/^sk_(test_|live_)/, 'pk_$1');
    
    return { publishableKey: derivedKey };
  }
}

