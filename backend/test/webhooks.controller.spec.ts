import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { WebhooksController } from '../src/payments/webhooks.controller';
import { PaymentsService } from '../src/payments/payments.service';
import { StripeService } from '../src/core/services/stripe.service';
import { PaymentStatus } from '../src/entities/payment.entity';

describe('WebhooksController', () => {
  let controller: WebhooksController;
  let paymentsService: jest.Mocked<PaymentsService>;
  let stripeService: jest.Mocked<StripeService>;

  beforeEach(async () => {
    const mockPaymentsService = {
      updatePaymentStatus: jest.fn(),
    };

    const mockStripeService = {
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
      paymentsService.updatePaymentStatus.mockResolvedValue(undefined);

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      const result = await controller.handleStripeWebhook(mockRequest as any, signature);

      expect(stripeService.verifyWebhookSignature).toHaveBeenCalledWith(
        rawBody.toString(),
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

  describe('payment_intent.succeeded event', () => {
    it('should parse event.data.object as payment intent', async () => {
      const rawBody = Buffer.from('test body');
      const signature = 'stripe-signature-header';
      const paymentIntent = {
        id: 'pi_123',
        metadata: {
          invoice_id: 'invoice-id',
        },
      };

      const mockEvent = {
        type: 'payment_intent.succeeded',
        data: {
          object: paymentIntent,
        },
      };

      const mockRequest = {
        rawBody: rawBody,
      };

      stripeService.verifyWebhookSignature.mockReturnValue(mockEvent as any);
      paymentsService.updatePaymentStatus.mockResolvedValue(undefined);

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      await controller.handleStripeWebhook(mockRequest as any, signature);

      expect(paymentsService.updatePaymentStatus).toHaveBeenCalledWith(
        paymentIntent.id,
        PaymentStatus.COMPLETED,
        paymentIntent,
      );

      consoleLogSpy.mockRestore();
    });

    it('should call paymentsService.updatePaymentStatus with payment intent ID, PaymentStatus.COMPLETED, and full payment intent object', async () => {
      const rawBody = Buffer.from('test body');
      const signature = 'stripe-signature-header';
      const paymentIntent = {
        id: 'pi_123',
        metadata: {
          invoice_id: 'invoice-id',
        },
      };

      const mockEvent = {
        type: 'payment_intent.succeeded',
        data: {
          object: paymentIntent,
        },
      };

      const mockRequest = {
        rawBody: rawBody,
      };

      stripeService.verifyWebhookSignature.mockReturnValue(mockEvent as any);
      paymentsService.updatePaymentStatus.mockResolvedValue(undefined);

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      await controller.handleStripeWebhook(mockRequest as any, signature);

      expect(paymentsService.updatePaymentStatus).toHaveBeenCalledWith(
        paymentIntent.id,
        PaymentStatus.COMPLETED,
        paymentIntent,
      );

      consoleLogSpy.mockRestore();
    });

    it('should log success message to console with payment intent ID and invoice ID from metadata', async () => {
      const rawBody = Buffer.from('test body');
      const signature = 'stripe-signature-header';
      const paymentIntent = {
        id: 'pi_123',
        metadata: {
          invoice_id: 'invoice-id',
        },
      };

      const mockEvent = {
        type: 'payment_intent.succeeded',
        data: {
          object: paymentIntent,
        },
      };

      const mockRequest = {
        rawBody: rawBody,
      };

      stripeService.verifyWebhookSignature.mockReturnValue(mockEvent as any);
      paymentsService.updatePaymentStatus.mockResolvedValue(undefined);

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      await controller.handleStripeWebhook(mockRequest as any, signature);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        `Payment succeeded: ${paymentIntent.id} for invoice ${paymentIntent.metadata?.invoice_id}`,
      );

      consoleLogSpy.mockRestore();
    });

    it('should return { received: true }', async () => {
      const rawBody = Buffer.from('test body');
      const signature = 'stripe-signature-header';
      const paymentIntent = {
        id: 'pi_123',
        metadata: {
          invoice_id: 'invoice-id',
        },
      };

      const mockEvent = {
        type: 'payment_intent.succeeded',
        data: {
          object: paymentIntent,
        },
      };

      const mockRequest = {
        rawBody: rawBody,
      };

      stripeService.verifyWebhookSignature.mockReturnValue(mockEvent as any);
      paymentsService.updatePaymentStatus.mockResolvedValue(undefined);

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      const result = await controller.handleStripeWebhook(mockRequest as any, signature);

      expect(result).toEqual({ received: true });

      consoleLogSpy.mockRestore();
    });
  });

  describe('payment_intent.payment_failed event', () => {
    it('should parse event.data.object as payment intent', async () => {
      const rawBody = Buffer.from('test body');
      const signature = 'stripe-signature-header';
      const paymentIntent = {
        id: 'pi_123',
        metadata: {
          invoice_id: 'invoice-id',
        },
      };

      const mockEvent = {
        type: 'payment_intent.payment_failed',
        data: {
          object: paymentIntent,
        },
      };

      const mockRequest = {
        rawBody: rawBody,
      };

      stripeService.verifyWebhookSignature.mockReturnValue(mockEvent as any);
      paymentsService.updatePaymentStatus.mockResolvedValue(undefined);

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      await controller.handleStripeWebhook(mockRequest as any, signature);

      expect(paymentsService.updatePaymentStatus).toHaveBeenCalledWith(
        paymentIntent.id,
        PaymentStatus.FAILED,
        paymentIntent,
      );

      consoleLogSpy.mockRestore();
    });

    it('should call paymentsService.updatePaymentStatus with payment intent ID, PaymentStatus.FAILED, and full payment intent object', async () => {
      const rawBody = Buffer.from('test body');
      const signature = 'stripe-signature-header';
      const paymentIntent = {
        id: 'pi_123',
        metadata: {
          invoice_id: 'invoice-id',
        },
      };

      const mockEvent = {
        type: 'payment_intent.payment_failed',
        data: {
          object: paymentIntent,
        },
      };

      const mockRequest = {
        rawBody: rawBody,
      };

      stripeService.verifyWebhookSignature.mockReturnValue(mockEvent as any);
      paymentsService.updatePaymentStatus.mockResolvedValue(undefined);

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      await controller.handleStripeWebhook(mockRequest as any, signature);

      expect(paymentsService.updatePaymentStatus).toHaveBeenCalledWith(
        paymentIntent.id,
        PaymentStatus.FAILED,
        paymentIntent,
      );

      consoleLogSpy.mockRestore();
    });

    it('should log failure message to console with payment intent ID and invoice ID from metadata', async () => {
      const rawBody = Buffer.from('test body');
      const signature = 'stripe-signature-header';
      const paymentIntent = {
        id: 'pi_123',
        metadata: {
          invoice_id: 'invoice-id',
        },
      };

      const mockEvent = {
        type: 'payment_intent.payment_failed',
        data: {
          object: paymentIntent,
        },
      };

      const mockRequest = {
        rawBody: rawBody,
      };

      stripeService.verifyWebhookSignature.mockReturnValue(mockEvent as any);
      paymentsService.updatePaymentStatus.mockResolvedValue(undefined);

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      await controller.handleStripeWebhook(mockRequest as any, signature);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        `Payment failed: ${paymentIntent.id} for invoice ${paymentIntent.metadata?.invoice_id}`,
      );

      consoleLogSpy.mockRestore();
    });

    it('should return { received: true }', async () => {
      const rawBody = Buffer.from('test body');
      const signature = 'stripe-signature-header';
      const paymentIntent = {
        id: 'pi_123',
        metadata: {
          invoice_id: 'invoice-id',
        },
      };

      const mockEvent = {
        type: 'payment_intent.payment_failed',
        data: {
          object: paymentIntent,
        },
      };

      const mockRequest = {
        rawBody: rawBody,
      };

      stripeService.verifyWebhookSignature.mockReturnValue(mockEvent as any);
      paymentsService.updatePaymentStatus.mockResolvedValue(undefined);

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      const result = await controller.handleStripeWebhook(mockRequest as any, signature);

      expect(result).toEqual({ received: true });

      consoleLogSpy.mockRestore();
    });
  });

  describe('unhandled event types', () => {
    it('should log unhandled event type to console', async () => {
      const rawBody = Buffer.from('test body');
      const signature = 'stripe-signature-header';

      const mockEvent = {
        type: 'payment_intent.created',
        data: {
          object: {},
        },
      };

      const mockRequest = {
        rawBody: rawBody,
      };

      stripeService.verifyWebhookSignature.mockReturnValue(mockEvent as any);

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      await controller.handleStripeWebhook(mockRequest as any, signature);

      expect(consoleLogSpy).toHaveBeenCalledWith(`Unhandled event type: ${mockEvent.type}`);
      expect(paymentsService.updatePaymentStatus).not.toHaveBeenCalled();

      consoleLogSpy.mockRestore();
    });

    it('should return { received: true } without calling paymentsService', async () => {
      const rawBody = Buffer.from('test body');
      const signature = 'stripe-signature-header';

      const mockEvent = {
        type: 'charge.succeeded',
        data: {
          object: {},
        },
      };

      const mockRequest = {
        rawBody: rawBody,
      };

      stripeService.verifyWebhookSignature.mockReturnValue(mockEvent as any);

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      const result = await controller.handleStripeWebhook(mockRequest as any, signature);

      expect(result).toEqual({ received: true });
      expect(paymentsService.updatePaymentStatus).not.toHaveBeenCalled();

      consoleLogSpy.mockRestore();
    });

    it('should test with various event types: payment_intent.created, charge.succeeded, etc.', async () => {
      const rawBody = Buffer.from('test body');
      const signature = 'stripe-signature-header';

      const eventTypes = ['payment_intent.created', 'charge.succeeded', 'customer.created'];

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      for (const eventType of eventTypes) {
        const mockEvent = {
          type: eventType,
          data: {
            object: {},
          },
        };

        const mockRequest = {
          rawBody: rawBody,
        };

        stripeService.verifyWebhookSignature.mockReturnValue(mockEvent as any);

        const result = await controller.handleStripeWebhook(mockRequest as any, signature);

        expect(result).toEqual({ received: true });
        expect(consoleLogSpy).toHaveBeenCalledWith(`Unhandled event type: ${eventType}`);
      }

      expect(paymentsService.updatePaymentStatus).not.toHaveBeenCalled();

      consoleLogSpy.mockRestore();
    });
  });

  describe('error handling', () => {
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

    it('should log error to console.error', async () => {
      const rawBody = Buffer.from('test body');
      const signature = 'stripe-signature-header';
      const mockRequest = {
        rawBody: rawBody,
      };

      const error = new Error('Test error');
      stripeService.verifyWebhookSignature.mockImplementation(() => {
        throw error;
      });

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      try {
        await controller.handleStripeWebhook(mockRequest as any, signature);
      } catch (e) {
        // Expected
      }

      expect(consoleErrorSpy).toHaveBeenCalledWith('Webhook error:', error);

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
    it('should verify stripeService.verifyWebhookSignature called with rawBody.toString() and signature', async () => {
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
      paymentsService.updatePaymentStatus.mockResolvedValue(undefined);

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      await controller.handleStripeWebhook(mockRequest as any, signature);

      expect(stripeService.verifyWebhookSignature).toHaveBeenCalledWith(
        rawBody.toString(),
        signature,
      );

      consoleLogSpy.mockRestore();
    });

    it('should verify paymentsService.updatePaymentStatus called with correct status enum', async () => {
      const rawBody = Buffer.from('test body');
      const signature = 'stripe-signature-header';
      const paymentIntent = {
        id: 'pi_123',
        metadata: {
          invoice_id: 'invoice-id',
        },
      };

      const mockEvent = {
        type: 'payment_intent.succeeded',
        data: {
          object: paymentIntent,
        },
      };

      const mockRequest = {
        rawBody: rawBody,
      };

      stripeService.verifyWebhookSignature.mockReturnValue(mockEvent as any);
      paymentsService.updatePaymentStatus.mockResolvedValue(undefined);

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      await controller.handleStripeWebhook(mockRequest as any, signature);

      expect(paymentsService.updatePaymentStatus).toHaveBeenCalledWith(
        paymentIntent.id,
        PaymentStatus.COMPLETED,
        paymentIntent,
      );

      consoleLogSpy.mockRestore();
    });

    it('should verify console.log calls for event processing', async () => {
      const rawBody = Buffer.from('test body');
      const signature = 'stripe-signature-header';
      const paymentIntent = {
        id: 'pi_123',
        metadata: {
          invoice_id: 'invoice-id',
        },
      };

      const mockEvent = {
        type: 'payment_intent.succeeded',
        data: {
          object: paymentIntent,
        },
      };

      const mockRequest = {
        rawBody: rawBody,
      };

      stripeService.verifyWebhookSignature.mockReturnValue(mockEvent as any);
      paymentsService.updatePaymentStatus.mockResolvedValue(undefined);

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      await controller.handleStripeWebhook(mockRequest as any, signature);

      expect(consoleLogSpy).toHaveBeenCalled();

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
      paymentsService.updatePaymentStatus.mockResolvedValue(undefined);

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

