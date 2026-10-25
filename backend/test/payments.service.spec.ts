import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Not } from 'typeorm';
import { PaymentsService, PaymentEventResult } from '../src/payments/payments.service';
import { Payment, PaymentStatus } from '../src/entities/payment.entity';
import { Invoice, InvoiceStatus } from '../src/entities/invoice.entity';
import { User } from '../src/entities/user.entity';
import { NotificationService } from '../src/core/services/notification.service';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let mockPaymentRepository: any;
  let mockInvoiceRepository: any;
  let mockUserRepository: any;
  let mockNotificationService: any;

  beforeEach(async () => {
    mockPaymentRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };

    mockInvoiceRepository = {
      save: jest.fn(),
    };

    mockUserRepository = {
      findOne: jest.fn(),
    };

    mockNotificationService = {
      notifyPaymentReceived: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        {
          provide: getRepositoryToken(Payment),
          useValue: mockPaymentRepository,
        },
        {
          provide: getRepositoryToken(Invoice),
          useValue: mockInvoiceRepository,
        },
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
        {
          provide: NotificationService,
          useValue: mockNotificationService,
        },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);

    // Reset all mocks
    jest.clearAllMocks();
  });

  describe('createPayment', () => {
    it('should create a new payment successfully', async () => {
      const invoiceId = 'invoice-id';
      const providerPaymentId = 'provider-payment-id';
      const amount = 100.50;
      const currency = 'USD';
      const metadata = { source: 'stripe', customerId: 'cust-123' };

      const createdPayment = {
        id: 'payment-id',
        invoiceId,
        providerPaymentId,
        amount,
        currency,
        status: PaymentStatus.PENDING,
        metadataJson: metadata,
      };

      mockPaymentRepository.findOne.mockResolvedValue(null);
      mockPaymentRepository.create.mockReturnValue(createdPayment);
      mockPaymentRepository.save.mockResolvedValue(createdPayment);

      const result = await service.createPayment(
        invoiceId,
        providerPaymentId,
        amount,
        currency,
        metadata,
      );

      expect(mockPaymentRepository.findOne).toHaveBeenCalledWith({
        where: { providerPaymentId },
      });
      expect(mockPaymentRepository.create).toHaveBeenCalledWith({
        invoiceId,
        providerPaymentId,
        amount,
        currency,
        status: PaymentStatus.PENDING,
        metadataJson: metadata,
      });
      expect(mockPaymentRepository.save).toHaveBeenCalledWith(createdPayment);
      expect(result).toEqual(createdPayment);
      expect(result.status).toBe(PaymentStatus.PENDING);
    });

    it('should return existing payment when providerPaymentId already exists (idempotency)', async () => {
      const invoiceId = 'invoice-id';
      const providerPaymentId = 'existing-provider-payment-id';
      const amount = 100.50;
      const currency = 'USD';

      const existingPayment = {
        id: 'existing-payment-id',
        invoiceId,
        providerPaymentId,
        amount,
        currency,
        status: PaymentStatus.COMPLETED,
      };

      mockPaymentRepository.findOne.mockResolvedValue(existingPayment);

      const result = await service.createPayment(
        invoiceId,
        providerPaymentId,
        amount,
        currency,
      );

      expect(mockPaymentRepository.findOne).toHaveBeenCalledWith({
        where: { providerPaymentId },
      });
      expect(mockPaymentRepository.create).not.toHaveBeenCalled();
      expect(mockPaymentRepository.save).not.toHaveBeenCalled();
      expect(result).toEqual(existingPayment);
    });

    it('should create payment with metadata', async () => {
      const invoiceId = 'invoice-id';
      const providerPaymentId = 'provider-payment-id';
      const amount = 99.99;
      const currency = 'EUR';
      const metadata = { transactionId: 'txn-123', fee: 2.50 };

      const createdPayment = {
        id: 'payment-id',
        invoiceId,
        providerPaymentId,
        amount,
        currency,
        status: PaymentStatus.PENDING,
        metadataJson: metadata,
      };

      mockPaymentRepository.findOne.mockResolvedValue(null);
      mockPaymentRepository.create.mockReturnValue(createdPayment);
      mockPaymentRepository.save.mockResolvedValue(createdPayment);

      const result = await service.createPayment(
        invoiceId,
        providerPaymentId,
        amount,
        currency,
        metadata,
      );

      expect(mockPaymentRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadataJson: metadata,
        }),
      );
      expect(result.metadataJson).toEqual(metadata);
    });

    it('should create payment without metadata', async () => {
      const invoiceId = 'invoice-id';
      const providerPaymentId = 'provider-payment-id';
      const amount = 50.00;
      const currency = 'GBP';

      const createdPayment = {
        id: 'payment-id',
        invoiceId,
        providerPaymentId,
        amount,
        currency,
        status: PaymentStatus.PENDING,
        metadataJson: undefined,
      };

      mockPaymentRepository.findOne.mockResolvedValue(null);
      mockPaymentRepository.create.mockReturnValue(createdPayment);
      mockPaymentRepository.save.mockResolvedValue(createdPayment);

      const result = await service.createPayment(
        invoiceId,
        providerPaymentId,
        amount,
        currency,
      );

      expect(mockPaymentRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          invoiceId,
          providerPaymentId,
          amount,
          currency,
          status: PaymentStatus.PENDING,
          metadataJson: undefined,
        }),
      );
      expect(result).toBeDefined();
    });
  });

  describe('updatePaymentStatus', () => {
    const owner = { id: 'user-id', email: 'owner@example.com', name: 'Owner' };

    function pendingPayment(overrides: Record<string, any> = {}) {
      return {
        id: 'payment-id',
        invoiceId: 'invoice-id',
        providerPaymentId: 'pi_1',
        amount: '100.50',
        currency: 'USD',
        status: PaymentStatus.PENDING,
        metadataJson: { source: 'stripe' },
        invoice: { id: 'invoice-id', userId: owner.id, number: 'INV-001', status: InvoiceStatus.SENT, total: '100.50', currency: 'USD' },
        ...overrides,
      };
    }

    const succeeded = (overrides: Record<string, any> = {}) => ({
      id: 'pi_1',
      amount_received: 10050,
      currency: 'usd',
      metadata: { invoice_id: 'invoice-id' },
      ...overrides,
    });

    beforeEach(() => {
      mockPaymentRepository.update = jest.fn().mockResolvedValue({ affected: 1 });
      mockInvoiceRepository.update = jest.fn().mockResolvedValue({ affected: 1 });
      mockUserRepository.findOne.mockResolvedValue(owner);
    });

    it('looks the payment up by provider id with its invoice', async () => {
      mockPaymentRepository.findOne.mockResolvedValue(null);
      await service.updatePaymentStatus('pi_1', PaymentStatus.COMPLETED, succeeded());
      expect(mockPaymentRepository.findOne).toHaveBeenCalledWith({
        where: { providerPaymentId: 'pi_1' },
        relations: ['invoice'],
      });
    });

    it('returns UNKNOWN_PAYMENT and writes nothing for an unknown provider id', async () => {
      mockPaymentRepository.findOne.mockResolvedValue(null);
      await expect(service.updatePaymentStatus('pi_x', PaymentStatus.COMPLETED, succeeded())).resolves.toBe(
        PaymentEventResult.UNKNOWN_PAYMENT,
      );
      expect(mockPaymentRepository.update).not.toHaveBeenCalled();
    });

    it('completes the payment with a conditional update, marks a covered invoice paid and notifies once', async () => {
      mockPaymentRepository.findOne.mockResolvedValue(pendingPayment());
      mockPaymentRepository.find.mockResolvedValue([{ amount: '100.50', currency: 'USD', status: PaymentStatus.COMPLETED }]);

      await expect(service.updatePaymentStatus('pi_1', PaymentStatus.COMPLETED, succeeded())).resolves.toBe(
        PaymentEventResult.APPLIED,
      );

      expect(mockPaymentRepository.update).toHaveBeenCalledWith(
        { id: 'payment-id', status: PaymentStatus.PENDING },
        expect.objectContaining({ status: PaymentStatus.COMPLETED, metadataJson: expect.objectContaining({ source: 'stripe', id: 'pi_1' }) }),
      );
      // Conditional on the invoice not being paid yet, so concurrent deliveries notify once
      expect(mockInvoiceRepository.update).toHaveBeenCalledWith(
        { id: 'invoice-id', status: Not(InvoiceStatus.PAID) },
        { status: InvoiceStatus.PAID },
      );
      expect(mockNotificationService.notifyPaymentReceived).toHaveBeenCalledWith(
        expect.objectContaining({ userEmail: owner.email, invoiceNumber: 'INV-001', amount: 100.5 }),
      );
    });

    it('does not notify when another delivery already marked the invoice paid', async () => {
      mockPaymentRepository.findOne.mockResolvedValue(pendingPayment());
      mockPaymentRepository.find.mockResolvedValue([{ amount: '100.50', currency: 'USD', status: PaymentStatus.COMPLETED }]);
      mockInvoiceRepository.update.mockResolvedValue({ affected: 0 });

      await service.updatePaymentStatus('pi_1', PaymentStatus.COMPLETED, succeeded());
      expect(mockNotificationService.notifyPaymentReceived).not.toHaveBeenCalled();
    });

    it('returns DUPLICATE when a concurrent delivery won the payment transition', async () => {
      mockPaymentRepository.findOne.mockResolvedValue(pendingPayment());
      mockPaymentRepository.update.mockResolvedValue({ affected: 0 });

      await expect(service.updatePaymentStatus('pi_1', PaymentStatus.COMPLETED, succeeded())).resolves.toBe(
        PaymentEventResult.DUPLICATE,
      );
      expect(mockInvoiceRepository.update).not.toHaveBeenCalled();
      expect(mockNotificationService.notifyPaymentReceived).not.toHaveBeenCalled();
    });

    it('returns DUPLICATE for an event matching the current status', async () => {
      mockPaymentRepository.findOne.mockResolvedValue(pendingPayment({ status: PaymentStatus.COMPLETED }));
      await expect(service.updatePaymentStatus('pi_1', PaymentStatus.COMPLETED, succeeded())).resolves.toBe(
        PaymentEventResult.DUPLICATE,
      );
      expect(mockPaymentRepository.update).not.toHaveBeenCalled();
    });

    it.each([PaymentStatus.COMPLETED, PaymentStatus.REFUNDED])('never moves a %s payment back (STALE)', async (current) => {
      mockPaymentRepository.findOne.mockResolvedValue(pendingPayment({ status: current }));
      await expect(service.updatePaymentStatus('pi_1', PaymentStatus.FAILED, succeeded())).resolves.toBe(
        PaymentEventResult.STALE,
      );
      expect(mockPaymentRepository.update).not.toHaveBeenCalled();
    });

    it('records a failure on a pending payment without touching the invoice', async () => {
      mockPaymentRepository.findOne.mockResolvedValue(pendingPayment());
      await expect(service.updatePaymentStatus('pi_1', PaymentStatus.FAILED, succeeded({ amount_received: 0 }))).resolves.toBe(
        PaymentEventResult.APPLIED,
      );
      expect(mockPaymentRepository.update).toHaveBeenCalledWith(
        { id: 'payment-id', status: PaymentStatus.PENDING },
        expect.objectContaining({ status: PaymentStatus.FAILED }),
      );
      expect(mockInvoiceRepository.update).not.toHaveBeenCalled();
    });

    it('returns MISMATCH and writes nothing when the event names another invoice', async () => {
      mockPaymentRepository.findOne.mockResolvedValue(pendingPayment());
      await expect(
        service.updatePaymentStatus('pi_1', PaymentStatus.COMPLETED, succeeded({ metadata: { invoice_id: 'other-invoice' } })),
      ).resolves.toBe(PaymentEventResult.MISMATCH);
      expect(mockPaymentRepository.update).not.toHaveBeenCalled();
    });

    it.each([
      ['currency_mismatch', { currency: 'eur' }],
      ['currency_mismatch', { currency: undefined }],
      ['amount_received_missing', { amount_received: undefined }],
      ['amount_received_missing', { amount_received: 0 }],
      ['amount_received_missing', { amount_received: 100.5 }],
    ])('flags %s for review and leaves the payment pending (%j)', async (reason, overrides) => {
      mockPaymentRepository.findOne.mockResolvedValue(pendingPayment());
      await expect(service.updatePaymentStatus('pi_1', PaymentStatus.COMPLETED, succeeded(overrides))).resolves.toBe(
        PaymentEventResult.MISMATCH,
      );
      expect(mockPaymentRepository.update).toHaveBeenCalledTimes(1);
      const [, changes] = mockPaymentRepository.update.mock.calls[0];
      expect(changes.status).toBeUndefined();
      expect(changes.metadataJson.review_required.reason).toBe(reason);
      expect(mockInvoiceRepository.update).not.toHaveBeenCalled();
    });

    it('records the received amount and keeps the invoice open when it does not cover the total', async () => {
      mockPaymentRepository.findOne.mockResolvedValue(pendingPayment());
      mockPaymentRepository.find.mockResolvedValue([{ amount: '50.00', currency: 'USD', status: PaymentStatus.COMPLETED }]);

      await service.updatePaymentStatus('pi_1', PaymentStatus.COMPLETED, succeeded({ amount_received: 5000 }));

      expect(mockPaymentRepository.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ amount: 50, metadataJson: expect.objectContaining({ requested_amount: 100.5 }) }),
      );
      expect(mockInvoiceRepository.update).not.toHaveBeenCalled();
      expect(mockNotificationService.notifyPaymentReceived).not.toHaveBeenCalled();
    });

    it('ignores completed payments in another currency when checking coverage', async () => {
      mockPaymentRepository.findOne.mockResolvedValue(pendingPayment());
      mockPaymentRepository.find.mockResolvedValue([
        { amount: '100.00', currency: 'USD', status: PaymentStatus.COMPLETED },
        { amount: '500.00', currency: 'EUR', status: PaymentStatus.COMPLETED },
      ]);

      await service.updatePaymentStatus('pi_1', PaymentStatus.COMPLETED, succeeded());
      expect(mockInvoiceRepository.update).not.toHaveBeenCalled();
    });

    it('handles a payment without an invoice relation', async () => {
      mockPaymentRepository.findOne.mockResolvedValue(pendingPayment({ invoice: null }));
      await expect(service.updatePaymentStatus('pi_1', PaymentStatus.COMPLETED, succeeded())).resolves.toBe(
        PaymentEventResult.APPLIED,
      );
      expect(mockInvoiceRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('findByInvoiceId', () => {
    it('should return all payments for an invoice', async () => {
      const invoiceId = 'invoice-id';
      const payments = [
        {
          id: 'payment-1',
          invoiceId,
          amount: 50.00,
          status: PaymentStatus.COMPLETED,
          createdAt: new Date('2024-01-02'),
        },
        {
          id: 'payment-2',
          invoiceId,
          amount: 50.00,
          status: PaymentStatus.PENDING,
          createdAt: new Date('2024-01-01'),
        },
      ];

      mockPaymentRepository.find.mockResolvedValue(payments);

      const result = await service.findByInvoiceId(invoiceId);

      expect(mockPaymentRepository.find).toHaveBeenCalledWith({
        where: { invoiceId },
        order: { createdAt: 'DESC' },
      });
      expect(result).toEqual(payments);
    });

    it('should return empty array when no payments found', async () => {
      const invoiceId = 'invoice-id';
      const payments: Payment[] = [];

      mockPaymentRepository.find.mockResolvedValue(payments);

      const result = await service.findByInvoiceId(invoiceId);

      expect(mockPaymentRepository.find).toHaveBeenCalledWith({
        where: { invoiceId },
        order: { createdAt: 'DESC' },
      });
      expect(result).toEqual([]);
    });

    it('should order payments by createdAt DESC', async () => {
      const invoiceId = 'invoice-id';
      const payments: Payment[] = [];

      mockPaymentRepository.find.mockResolvedValue(payments);

      await service.findByInvoiceId(invoiceId);

      expect(mockPaymentRepository.find).toHaveBeenCalledWith({
        where: { invoiceId },
        order: { createdAt: 'DESC' },
      });
    });

    it('should return multiple payments for same invoice', async () => {
      const invoiceId = 'invoice-id';
      const payments = [
        {
          id: 'payment-1',
          invoiceId,
          amount: 33.33,
          status: PaymentStatus.COMPLETED,
          createdAt: new Date('2024-01-03'),
        },
        {
          id: 'payment-2',
          invoiceId,
          amount: 33.33,
          status: PaymentStatus.COMPLETED,
          createdAt: new Date('2024-01-02'),
        },
        {
          id: 'payment-3',
          invoiceId,
          amount: 33.34,
          status: PaymentStatus.COMPLETED,
          createdAt: new Date('2024-01-01'),
        },
      ];

      mockPaymentRepository.find.mockResolvedValue(payments);

      const result = await service.findByInvoiceId(invoiceId);

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('payment-1');
      expect(result[1].id).toBe('payment-2');
      expect(result[2].id).toBe('payment-3');
    });
  });

  describe('findByProviderPaymentId', () => {
    it('should return payment with invoice relation', async () => {
      const providerPaymentId = 'provider-payment-id';
      const invoice = {
        id: 'invoice-id',
        number: 'INV-001',
      };

      const payment = {
        id: 'payment-id',
        invoiceId: invoice.id,
        providerPaymentId,
        amount: 100.50,
        currency: 'USD',
        status: PaymentStatus.COMPLETED,
        invoice,
      };

      mockPaymentRepository.findOne.mockResolvedValue(payment);

      const result = await service.findByProviderPaymentId(providerPaymentId);

      expect(mockPaymentRepository.findOne).toHaveBeenCalledWith({
        where: { providerPaymentId },
        relations: ['invoice'],
      });
      expect(result).toEqual(payment);
      expect(result?.invoice).toEqual(invoice);
    });

    it('should return null when payment is not found', async () => {
      const providerPaymentId = 'non-existent-payment-id';

      mockPaymentRepository.findOne.mockResolvedValue(null);

      const result = await service.findByProviderPaymentId(providerPaymentId);

      expect(mockPaymentRepository.findOne).toHaveBeenCalledWith({
        where: { providerPaymentId },
        relations: ['invoice'],
      });
      expect(result).toBeNull();
    });

    it('should query with invoice relation', async () => {
      const providerPaymentId = 'provider-payment-id';

      mockPaymentRepository.findOne.mockResolvedValue(null);

      await service.findByProviderPaymentId(providerPaymentId);

      expect(mockPaymentRepository.findOne).toHaveBeenCalledWith({
        where: { providerPaymentId },
        relations: ['invoice'],
      });
    });
  });

  describe('Additional Test Scenarios', () => {
    it('should create payment with PENDING status for all calls', async () => {
      const invoiceId = 'invoice-id';
      const providerPaymentId = 'provider-payment-id';
      const amount = 100.00;
      const currency = 'USD';

      const providerPaymentIds = [
        `${providerPaymentId}-1`,
        `${providerPaymentId}-2`,
        `${providerPaymentId}-3`,
        `${providerPaymentId}-4`,
      ];

      for (const currentProviderPaymentId of providerPaymentIds) {
        mockPaymentRepository.findOne.mockResolvedValue(null);
        const payment = {
          id: `payment-${currentProviderPaymentId}`,
          invoiceId,
          providerPaymentId: currentProviderPaymentId,
          amount,
          currency,
          status: PaymentStatus.PENDING,
        };
        mockPaymentRepository.create.mockReturnValue(payment);
        mockPaymentRepository.save.mockResolvedValue(payment);

        const result = await service.createPayment(
          invoiceId,
          currentProviderPaymentId,
          amount,
          currency,
        );

        expect(result.status).toBe(PaymentStatus.PENDING);
      }
    });

    it('should move a pending payment to FAILED or REFUNDED with a conditional update', async () => {
      mockPaymentRepository.update = jest.fn().mockResolvedValue({ affected: 1 });

      for (const status of [PaymentStatus.FAILED, PaymentStatus.REFUNDED]) {
        mockPaymentRepository.findOne.mockResolvedValue({
          id: 'payment-id',
          invoiceId: 'invoice-id',
          providerPaymentId: 'provider-payment-id',
          amount: 100.5,
          currency: 'USD',
          status: PaymentStatus.PENDING,
          metadataJson: { source: 'stripe' },
          invoice: null,
        });

        await expect(service.updatePaymentStatus('provider-payment-id', status)).resolves.toBe(PaymentEventResult.APPLIED);
        expect(mockPaymentRepository.update).toHaveBeenLastCalledWith(
          { id: 'payment-id', status: PaymentStatus.PENDING },
          expect.objectContaining({ status }),
        );
      }
    });

    it('should handle different currency codes', async () => {
      const invoiceId = 'invoice-id';
      const providerPaymentId = 'provider-payment-id';
      const amount = 100.00;

      const currencies = ['USD', 'EUR', 'GBP'];

      for (const currency of currencies) {
        mockPaymentRepository.findOne.mockResolvedValue(null);
        const payment = {
          id: `payment-${currency}`,
          invoiceId,
          providerPaymentId: `${providerPaymentId}-${currency}`,
          amount,
          currency,
          status: PaymentStatus.PENDING,
        };
        mockPaymentRepository.create.mockReturnValue(payment);
        mockPaymentRepository.save.mockResolvedValue(payment);

        const result = await service.createPayment(
          invoiceId,
          `${providerPaymentId}-${currency}`,
          amount,
          currency,
        );

        expect(result.currency).toBe(currency);
      }
    });

    it('should handle decimal amounts with precision', async () => {
      const invoiceId = 'invoice-id';
      const providerPaymentId = 'provider-payment-id';
      const currency = 'USD';

      const amounts = [99.99, 1234.56, 0.01, 999999.99];

      for (const amount of amounts) {
        mockPaymentRepository.findOne.mockResolvedValue(null);
        const payment = {
          id: `payment-${amount}`,
          invoiceId,
          providerPaymentId: `${providerPaymentId}-${amount}`,
          amount,
          currency,
          status: PaymentStatus.PENDING,
        };
        mockPaymentRepository.create.mockReturnValue(payment);
        mockPaymentRepository.save.mockResolvedValue(payment);

        const result = await service.createPayment(
          invoiceId,
          `${providerPaymentId}-${amount}`,
          amount,
          currency,
        );

        expect(result.amount).toBe(amount);
      }
    });
  });
});

