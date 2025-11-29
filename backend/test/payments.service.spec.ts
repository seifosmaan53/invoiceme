import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { PaymentsService } from '../src/payments/payments.service';
import { Payment, PaymentStatus } from '../src/entities/payment.entity';
import { Invoice, InvoiceStatus } from '../src/entities/invoice.entity';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let mockPaymentRepository: any;
  let mockInvoiceRepository: any;

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
    it('should update payment status successfully', async () => {
      const providerPaymentId = 'provider-payment-id';
      const newStatus = PaymentStatus.COMPLETED;
      const metadata = { transactionId: 'txn-456' };

      const existingPayment = {
        id: 'payment-id',
        invoiceId: 'invoice-id',
        providerPaymentId,
        amount: 100.50,
        currency: 'USD',
        status: PaymentStatus.PENDING,
        metadataJson: { source: 'stripe' },
        invoice: null,
      };

      const updatedPayment = {
        ...existingPayment,
        status: newStatus,
        metadataJson: { ...existingPayment.metadataJson, ...metadata },
      };

      mockPaymentRepository.findOne.mockResolvedValue(existingPayment);
      mockPaymentRepository.save.mockResolvedValue(updatedPayment);

      const result = await service.updatePaymentStatus(
        providerPaymentId,
        newStatus,
        metadata,
      );

      expect(mockPaymentRepository.findOne).toHaveBeenCalledWith({
        where: { providerPaymentId },
        relations: ['invoice'],
      });
      expect(mockPaymentRepository.save).toHaveBeenCalled();
      expect(result.status).toBe(newStatus);
    });

    it('should throw NotFoundException when payment is not found', async () => {
      const providerPaymentId = 'non-existent-payment-id';
      const newStatus = PaymentStatus.COMPLETED;

      mockPaymentRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updatePaymentStatus(providerPaymentId, newStatus),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.updatePaymentStatus(providerPaymentId, newStatus),
      ).rejects.toThrow('Payment not found');
      expect(mockPaymentRepository.save).not.toHaveBeenCalled();
    });

    it('should update invoice status to PAID when payment is completed', async () => {
      const providerPaymentId = 'provider-payment-id';
      const newStatus = PaymentStatus.COMPLETED;

      const invoice = {
        id: 'invoice-id',
        number: 'INV-001',
        status: InvoiceStatus.SENT,
      };

      const existingPayment = {
        id: 'payment-id',
        invoiceId: invoice.id,
        providerPaymentId,
        amount: 100.50,
        currency: 'USD',
        status: PaymentStatus.PENDING,
        invoice,
      };

      const updatedPayment = {
        ...existingPayment,
        status: newStatus,
      };

      const updatedInvoice = {
        ...invoice,
        status: InvoiceStatus.PAID,
      };

      mockPaymentRepository.findOne.mockResolvedValue(existingPayment);
      mockPaymentRepository.save.mockResolvedValue(updatedPayment);
      mockInvoiceRepository.save.mockResolvedValue(updatedInvoice);

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      const result = await service.updatePaymentStatus(
        providerPaymentId,
        newStatus,
      );

      expect(mockInvoiceRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: InvoiceStatus.PAID,
        }),
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        `Invoice ${invoice.number} marked as paid`,
      );
      expect(result.status).toBe(PaymentStatus.COMPLETED);

      consoleLogSpy.mockRestore();
    });

    it('should not update invoice status when payment is not completed', async () => {
      const providerPaymentId = 'provider-payment-id';
      const newStatus = PaymentStatus.FAILED;

      const invoice = {
        id: 'invoice-id',
        number: 'INV-001',
        status: InvoiceStatus.SENT,
      };

      const existingPayment = {
        id: 'payment-id',
        invoiceId: invoice.id,
        providerPaymentId,
        amount: 100.50,
        currency: 'USD',
        status: PaymentStatus.PENDING,
        invoice,
      };

      const updatedPayment = {
        ...existingPayment,
        status: newStatus,
      };

      mockPaymentRepository.findOne.mockResolvedValue(existingPayment);
      mockPaymentRepository.save.mockResolvedValue(updatedPayment);

      await service.updatePaymentStatus(providerPaymentId, newStatus);

      expect(mockInvoiceRepository.save).not.toHaveBeenCalled();
      expect(invoice.status).toBe(InvoiceStatus.SENT);
    });

    it('should merge metadata with existing metadataJson', async () => {
      const providerPaymentId = 'provider-payment-id';
      const newStatus = PaymentStatus.COMPLETED;
      const newMetadata = { transactionId: 'txn-789', fee: 3.00 };

      const existingPayment = {
        id: 'payment-id',
        invoiceId: 'invoice-id',
        providerPaymentId,
        amount: 100.50,
        currency: 'USD',
        status: PaymentStatus.PENDING,
        metadataJson: { source: 'stripe', customerId: 'cust-123' },
        invoice: null,
      };

      const updatedPayment = {
        ...existingPayment,
        status: newStatus,
        metadataJson: {
          ...existingPayment.metadataJson,
          ...newMetadata,
        },
      };

      mockPaymentRepository.findOne.mockResolvedValue(existingPayment);
      mockPaymentRepository.save.mockResolvedValue(updatedPayment);

      const result = await service.updatePaymentStatus(
        providerPaymentId,
        newStatus,
        newMetadata,
      );

      expect(result.metadataJson).toEqual({
        source: 'stripe',
        customerId: 'cust-123',
        transactionId: 'txn-789',
        fee: 3.00,
      });
    });

    it('should handle metadata merge when existing metadataJson is undefined', async () => {
      const providerPaymentId = 'provider-payment-id';
      const newStatus = PaymentStatus.COMPLETED;
      const newMetadata = { transactionId: 'txn-456', fee: 2.50 };

      const existingPayment = {
        id: 'payment-id',
        invoiceId: 'invoice-id',
        providerPaymentId,
        amount: 100.50,
        currency: 'USD',
        status: PaymentStatus.PENDING,
        metadataJson: undefined,
        invoice: null,
      };

      const updatedPayment = {
        ...existingPayment,
        status: newStatus,
        metadataJson: newMetadata,
      };

      mockPaymentRepository.findOne.mockResolvedValue(existingPayment);
      mockPaymentRepository.save.mockResolvedValue(updatedPayment);

      const result = await service.updatePaymentStatus(
        providerPaymentId,
        newStatus,
        newMetadata,
      );

      expect(result.metadataJson).toEqual(newMetadata);
      expect(result.status).toBe(newStatus);
    });

    it('should handle payment without invoice relation', async () => {
      const providerPaymentId = 'provider-payment-id';
      const newStatus = PaymentStatus.COMPLETED;

      const existingPayment = {
        id: 'payment-id',
        invoiceId: 'invoice-id',
        providerPaymentId,
        amount: 100.50,
        currency: 'USD',
        status: PaymentStatus.PENDING,
        invoice: null,
      };

      const updatedPayment = {
        ...existingPayment,
        status: newStatus,
      };

      mockPaymentRepository.findOne.mockResolvedValue(existingPayment);
      mockPaymentRepository.save.mockResolvedValue(updatedPayment);

      const result = await service.updatePaymentStatus(
        providerPaymentId,
        newStatus,
      );

      expect(mockInvoiceRepository.save).not.toHaveBeenCalled();
      expect(result.status).toBe(newStatus);
    });

    it('should query with relations for invoice', async () => {
      const providerPaymentId = 'provider-payment-id';
      const newStatus = PaymentStatus.COMPLETED;

      const existingPayment = {
        id: 'payment-id',
        invoiceId: 'invoice-id',
        providerPaymentId,
        amount: 100.50,
        currency: 'USD',
        status: PaymentStatus.PENDING,
        invoice: null,
      };

      mockPaymentRepository.findOne.mockResolvedValue(existingPayment);
      mockPaymentRepository.save.mockResolvedValue({
        ...existingPayment,
        status: newStatus,
      });

      await service.updatePaymentStatus(providerPaymentId, newStatus);

      expect(mockPaymentRepository.findOne).toHaveBeenCalledWith({
        where: { providerPaymentId },
        relations: ['invoice'],
      });
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

    it('should update payment status to all PaymentStatus enum values', async () => {
      const providerPaymentId = 'provider-payment-id';

      const statuses = [
        PaymentStatus.COMPLETED,
        PaymentStatus.FAILED,
        PaymentStatus.REFUNDED,
      ];

      for (const status of statuses) {
        const existingPayment = {
          id: 'payment-id',
          invoiceId: 'invoice-id',
          providerPaymentId,
          amount: 100.50,
          currency: 'USD',
          status: PaymentStatus.PENDING,
          metadataJson: { source: 'stripe' },
          invoice: null,
        };

        const updatedPayment = {
          ...existingPayment,
          status,
        };

        mockPaymentRepository.findOne.mockResolvedValue(existingPayment);
        mockPaymentRepository.save.mockResolvedValue(updatedPayment);

        const result = await service.updatePaymentStatus(
          providerPaymentId,
          status,
        );

        expect(result.status).toBe(status);
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

