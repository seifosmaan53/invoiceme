import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { InvoicesService } from '../src/invoices/invoices.service';
import { Invoice } from '../src/entities/invoice.entity';
import { InvoiceItem } from '../src/entities/invoice-item.entity';
import { Client } from '../src/entities/client.entity';
import { DataSource } from 'typeorm';

describe('InvoicesService - Math Calculations', () => {
  let service: InvoicesService;
  let mockInvoiceRepository: any;
  let mockInvoiceItemRepository: any;
  let mockClientRepository: any;
  let mockDataSource: any;

  beforeEach(async () => {
    // Create mock repositories
    mockInvoiceRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      findAndCount: jest.fn(),
    };

    mockInvoiceItemRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
    };

    mockClientRepository = {
      findOne: jest.fn(),
    };

    mockDataSource = {
      createQueryRunner: jest.fn(() => ({
        connect: jest.fn(),
        startTransaction: jest.fn(),
        manager: {
          save: jest.fn(),
          delete: jest.fn(),
        },
        commitTransaction: jest.fn(),
        rollbackTransaction: jest.fn(),
        release: jest.fn(),
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoicesService,
        {
          provide: getRepositoryToken(Invoice),
          useValue: mockInvoiceRepository,
        },
        {
          provide: getRepositoryToken(InvoiceItem),
          useValue: mockInvoiceItemRepository,
        },
        {
          provide: getRepositoryToken(Client),
          useValue: mockClientRepository,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<InvoicesService>(InvoicesService);
  });

  describe('calculateLineTotal', () => {
    it('should calculate line total with quantity and unit price', () => {
      const item = { quantity: 2, unitPrice: 100 };
      const result = (service as any).calculateLineTotal(item);
      expect(result).toBe(200);
    });

    it('should apply discount before tax', () => {
      const item = { quantity: 2, unitPrice: 100, discountRate: 10, taxRate: 5 };
      // Subtotal: 200, After discount (10%): 180, After tax (5%): 189
      const result = (service as any).calculateLineTotal(item);
      expect(result).toBe(189);
    });

    it('should handle tax only', () => {
      const item = { quantity: 1, unitPrice: 100, taxRate: 10 };
      // Subtotal: 100, After tax (10%): 110
      const result = (service as any).calculateLineTotal(item);
      expect(result).toBe(110);
    });

    it('should handle discount only', () => {
      const item = { quantity: 1, unitPrice: 100, discountRate: 20 };
      // Subtotal: 100, After discount (20%): 80
      const result = (service as any).calculateLineTotal(item);
      expect(result).toBe(80);
    });

    it('should round to 2 decimal places', () => {
      const item = { quantity: 3, unitPrice: 33.33 };
      const result = (service as any).calculateLineTotal(item);
      expect(result).toBe(99.99);
    });

    it('should handle zero values', () => {
      const item = { quantity: 0, unitPrice: 100 };
      const result = (service as any).calculateLineTotal(item);
      expect(result).toBe(0);
    });
  });

  describe('calculateTotals', () => {
    it('should calculate subtotal, tax, discount, and total', () => {
      const items = [
        { quantity: 2, unitPrice: 100, taxRate: 10, discountRate: 5 },
        { quantity: 1, unitPrice: 50, taxRate: 5 },
      ];
      // Item 1: subtotal=200, discount=10, afterDiscount=190, tax=19, total=209
      // Item 2: subtotal=50, discount=0, afterDiscount=50, tax=2.5, total=52.5
      // Total: subtotal=250, discountTotal=10, taxTotal=21.5, total=261.5
      const result = (service as any).calculateTotals(items);
      expect(result.subtotal).toBe(250);
      expect(result.discountTotal).toBe(10);
      expect(result.taxTotal).toBe(21.5);
      expect(result.total).toBe(261.5);
    });

    it('should handle empty items array', () => {
      const result = (service as any).calculateTotals([]);
      expect(result.subtotal).toBe(0);
      expect(result.taxTotal).toBe(0);
      expect(result.discountTotal).toBe(0);
      expect(result.total).toBe(0);
    });

    it('should handle multiple items with different rates', () => {
      const items = [
        { quantity: 1, unitPrice: 100, taxRate: 20, discountRate: 10 },
        { quantity: 2, unitPrice: 75, taxRate: 0, discountRate: 15 },
        { quantity: 3, unitPrice: 50, taxRate: 10, discountRate: 0 },
      ];
      // Item 1: subtotal=100, discount=10, afterDiscount=90, tax=18, total=108
      // Item 2: subtotal=150, discount=22.5, afterDiscount=127.5, tax=0, total=127.5
      // Item 3: subtotal=150, discount=0, afterDiscount=150, tax=15, total=165
      // Total: subtotal=400, discountTotal=32.5, taxTotal=33, total=400.5
      const result = (service as any).calculateTotals(items);
      expect(result.subtotal).toBe(400);
      expect(result.discountTotal).toBe(32.5);
      expect(result.taxTotal).toBe(33);
      expect(result.total).toBe(400.5);
    });

    it('should round all totals to 2 decimal places', () => {
      const items = [
        { quantity: 1, unitPrice: 33.33, taxRate: 7.5, discountRate: 3.33 },
      ];
      const result = (service as any).calculateTotals(items);
      expect(result.subtotal).toBe(33.33);
      expect(result.discountTotal).toBe(1.11);
      expect(result.taxTotal).toBe(2.42);
      expect(result.total).toBe(34.64);
    });
  });
});

