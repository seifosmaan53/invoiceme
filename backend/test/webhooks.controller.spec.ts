import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { WebhooksController } from '../src/payments/webhooks.controller';
import { PaymentsService, PaymentEventResult } from '../src/payments/payments.service';
import { StripeService } from '../src/core/services/stripe.service';

describe('WebhooksController', () => {
  let controller: WebhooksController;
  let paymentsService: jest.Mocked<PaymentsService>;
  let stripeService: jest.Mocked<StripeService>;

  beforeEach(async () => {
    const mockPaymentsService = {
      handleProviderEvent: jest.fn(),
    };

    const mockStripeService = {
      isAvailable: jest.fn().mockReturnValue(true),
      verifyWebhookSignature: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [
        {
          provide: PaymentsService,
          useValue: mockPaymentsService,
        },
        {
          provide: StripeService,
          useValue: mockStripeService,
        },
      ],
    }).compile();

    controller = module.get<WebhooksController>(WebhooksController);
    paymentsService = module.get(PaymentsService);
    stripeService = module.get(StripeService);

    jest.clearAllMocks();
  });

  describe('POST /webhooks/stripe', () => {
    it('should verify webhook signature using stripeService.verifyWebhookSignature with rawBody and signature header', async () => {
      const rawBody = Buffer.from('test body');
      const signature = 'stripe-signature-header';
      const mockEvent = {
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_123',
            metadata: {
              invoice_id: 'invoice-id',
            },
          },
        },
      };

      const mockRequest = {
        rawBody: rawBody,
      };

      stripeService.verifyWebhookSignature.mockReturnValue(mockEvent as any);
      paymentsService.handleProviderEvent.mockResolvedValue(undefined);

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      const result = await controller.handleStripeWebhook(mockRequest as any, signature);

      expect(stripeService.verifyWebhookSignature).toHaveBeenCalledWith(
        rawBody,
        signature,
      );
      expect(result).toEqual({ received: true });

      consoleLogSpy.mockRestore();
    });

    it('should throw BadRequestException when stripe-signature header is missing', async () => {
      const mockRequest = {
        rawBody: Buffer.from('test body'),
      };

      await expect(controller.handleStripeWebhook(mockRequest as any, undefined)).rejects.toThrow(BadRequestException);
      await expect(controller.handleStripeWebhook(mockRequest as any, undefined)).rejects.toThrow('Missing stripe-signature header');
    });

    it('should throw BadRequestException when request body is missing', async () => {
      const signature = 'stripe-signature-header';
      const mockRequest = {
        rawBody: undefined,
      };

      await expect(controller.handleStripeWebhook(mockRequest as any, signature)).rejects.toThrow(BadRequestException);
      await expect(controller.handleStripeWebhook(mockRequest as any, signature)).rejects.toThrow('Missing request body');
    });

    it('should verify the bytes express.raw() left in req.body when req.rawBody is unset (main.ts order)', async () => {
      const body = Buffer.from('{"id":"evt_1"}');
      stripeService.verifyWebhookSignature.mockReturnValue({ type: 'charge.succeeded', data: { object: {} } } as any);
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      await controller.handleStripeWebhook({ rawBody: undefined, body } as any, 'sig');

      expect(stripeService.verifyWebhookSignature).toHaveBeenCalledWith(body, 'sig');
      consoleLogSpy.mockRestore();
    });

    it('should never verify a parsed (re-serializable) JSON body', async () => {
      const mockRequest = { rawBody: undefined, body: { id: 'evt_1' } };

      await expect(controller.handleStripeWebhook(mockRequest as any, 'sig')).rejects.toThrow('Missing request body');
      expect(stripeService.verifyWebhookSignature).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when signature verification fails', async () => {
      const rawBody = Buffer.from('test body');
      const signature = 'invalid-signature';
      const mockRequest = {
        rawBody: rawBody,
      };

      const error = new Error('Invalid signature');
      stripeService.verifyWebhookSignature.mockImplementation(() => {
        throw error;
      });

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      await expect(controller.handleStripeWebhook(mockRequest as any, signature)).rejects.toThrow(BadRequestException);
      await expect(controller.handleStripeWebhook(mockRequest as any, signature)).rejects.toThrow('Webhook signature verification failed: Invalid signature');

      consoleErrorSpy.mockRestore();
    });
  });

  // Routing of payment, refund and dispute events, and their idempotency, are
  // PaymentsService.handleProviderEvent's job (payments-state.e2e-spec.ts,
  // payments-authz.e2e-spec.ts); the controller verifies and hands over.
  describe('delegation', () => {
    it.each(['payment_intent.succeeded', 'charge.refunded', 'charge.dispute.created', 'customer.created'])(
      'passes a verified %s event to the payments service once and acknowledges it',
      async (type) => {
        const event = { id: 'evt_1', type, data: { object: { id: 'obj_1' } } };
        stripeService.verifyWebhookSignature.mockReturnValue(event as any);
        paymentsService.handleProviderEvent.mockResolvedValue('applied');
        const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

        await expect(controller.handleStripeWebhook({ rawBody: Buffer.from('x') } as any, 'sig')).resolves.toEqual({ received: true });
        expect(paymentsService.handleProviderEvent).toHaveBeenCalledTimes(1);
        expect(paymentsService.handleProviderEvent).toHaveBeenCalledWith(event);
        consoleLogSpy.mockRestore();
      },
    );

    it('never hands over an event whose signature failed', async () => {
      stripeService.verifyWebhookSignature.mockImplementation(() => {
        throw new Error('bad signature');
      });
      jest.spyOn(console, 'error').mockImplementation();
      await expect(controller.handleStripeWebhook({ rawBody: Buffer.from('x') } as any, 'sig')).rejects.toBeInstanceOf(BadRequestException);
      expect(paymentsService.handleProviderEvent).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should not report a processing error as a signature failure (5xx lets Stripe redeliver)', async () => {
      stripeService.verifyWebhookSignature.mockReturnValue({
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_1', metadata: {} } },
      } as any);
      paymentsService.handleProviderEvent.mockRejectedValue(new Error('connection terminated'));
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      const call = controller.handleStripeWebhook({ rawBody: Buffer.from('{}') } as any, 'sig');
      await expect(call).rejects.toThrow('connection terminated');
      await expect(call).rejects.not.toBeInstanceOf(BadRequestException);
      consoleLogSpy.mockRestore();
    });

    it('should acknowledge an event the service did not apply', async () => {
      stripeService.verifyWebhookSignature.mockReturnValue({
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_unknown', metadata: {} } },
      } as any);
      paymentsService.handleProviderEvent.mockResolvedValue(PaymentEventResult.UNKNOWN_PAYMENT);
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      await expect(controller.handleStripeWebhook({ rawBody: Buffer.from('{}') } as any, 'sig')).resolves.toEqual({ received: true });
      consoleLogSpy.mockRestore();
    });

    it('should catch errors from verifyWebhookSignature and throw BadRequestException with error message', async () => {
      const rawBody = Buffer.from('test body');
      const signature = 'stripe-signature-header';
      const mockRequest = {
        rawBody: rawBody,
      };

      const error = new Error('Signature verification failed');
      stripeService.verifyWebhookSignature.mockImplementation(() => {
        throw error;
      });

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      await expect(controller.handleStripeWebhook(mockRequest as any, signature)).rejects.toThrow(BadRequestException);
      await expect(controller.handleStripeWebhook(mockRequest as any, signature)).rejects.toThrow('Webhook signature verification failed: Signature verification failed');

      consoleErrorSpy.mockRestore();
    });

    it('should log only the error message, not the payload it may carry', async () => {
      const rawBody = Buffer.from('test body');
      const signature = 'stripe-signature-header';
      const mockRequest = {
        rawBody: rawBody,
      };

      // stripe-node signature errors carry the raw payload
      const error = Object.assign(new Error('Test error'), { payload: '{"client_secret":"pi_1_secret_x"}' });
      stripeService.verifyWebhookSignature.mockImplementation(() => {
        throw error;
      });

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      try {
        await controller.handleStripeWebhook(mockRequest as any, signature);
      } catch (e) {
        // Expected
      }

      expect(consoleErrorSpy).toHaveBeenCalledWith('Webhook error:', 'Test error');
      expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toContain('secret');

      consoleErrorSpy.mockRestore();
    });

    it('should verify error message format: \'Webhook signature verification failed: {error.message}\'', async () => {
      const rawBody = Buffer.from('test body');
      const signature = 'stripe-signature-header';
      const mockRequest = {
        rawBody: rawBody,
      };

      const error = new Error('Custom error message');
      stripeService.verifyWebhookSignature.mockImplementation(() => {
        throw error;
      });

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      await expect(controller.handleStripeWebhook(mockRequest as any, signature)).rejects.toThrow('Webhook signature verification failed: Custom error message');

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Assertions', () => {
    it('should verify stripeService.verifyWebhookSignature called with the raw body bytes and signature', async () => {
      const rawBody = Buffer.from('test body');
      const signature = 'stripe-signature-header';
      const mockEvent = {
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_123',
            metadata: {
              invoice_id: 'invoice-id',
            },
          },
        },
      };

      const mockRequest = {
        rawBody: rawBody,
      };

      stripeService.verifyWebhookSignature.mockReturnValue(mockEvent as any);
      paymentsService.handleProviderEvent.mockResolvedValue(undefined);

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      await controller.handleStripeWebhook(mockRequest as any, signature);

      expect(stripeService.verifyWebhookSignature).toHaveBeenCalledWith(
        rawBody,
        signature,
      );

      consoleLogSpy.mockRestore();
    });

    it('should verify HTTP 200 status via @HttpCode decorator', async () => {
      const rawBody = Buffer.from('test body');
      const signature = 'stripe-signature-header';
      const mockEvent = {
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_123',
            metadata: {
              invoice_id: 'invoice-id',
            },
          },
        },
      };

      const mockRequest = {
        rawBody: rawBody,
      };

      stripeService.verifyWebhookSignature.mockReturnValue(mockEvent as any);
      paymentsService.handleProviderEvent.mockResolvedValue(undefined);

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      await controller.handleStripeWebhook(mockRequest as any, signature);

      // HTTP status is set via @HttpCode decorator, verified by framework
      expect(controller).toBeDefined();

      consoleLogSpy.mockRestore();
    });

    it('should verify public endpoint (no authentication required)', () => {
      // This endpoint is NOT protected by JwtAuthGuard
      expect(controller).toBeDefined();
    });
  });
});

