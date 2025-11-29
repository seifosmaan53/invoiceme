import { Test, TestingModule } from '@nestjs/testing';
import { InvoiceNumberFormatterService } from './invoice-number-formatter.service';
import { InvoiceType } from '../../entities/invoice.entity';

describe('InvoiceNumberFormatterService', () => {
  let service: InvoiceNumberFormatterService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [InvoiceNumberFormatterService],
    }).compile();

    service = module.get<InvoiceNumberFormatterService>(InvoiceNumberFormatterService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('format', () => {
    const testDate = new Date('2025-01-15');

    it('should use default format for invoices when no format provided', () => {
      const result = service.format(null, InvoiceType.INVOICE, 1, testDate);
      expect(result).toBe('INV-2025-0001');
    });

    it('should use default format for estimates when no format provided', () => {
      const result = service.format(null, InvoiceType.ESTIMATE, 1, testDate);
      expect(result).toBe('EST-2025-0001');
    });

    it('should format with custom pattern', () => {
      const result = service.format('INV-{YYYY}-{####}', InvoiceType.INVOICE, 42, testDate);
      expect(result).toBe('INV-2025-0042');
    });

    it('should support different padding lengths', () => {
      const result1 = service.format('INV-{####}', InvoiceType.INVOICE, 5, testDate);
      expect(result1).toBe('INV-0005');

      const result2 = service.format('INV-{###}', InvoiceType.INVOICE, 5, testDate);
      expect(result2).toBe('INV-005');

      const result3 = service.format('INV-{##}', InvoiceType.INVOICE, 5, testDate);
      expect(result3).toBe('INV-05');
    });

    it('should replace {PREFIX} placeholder', () => {
      const result = service.format('{PREFIX}-{YYYY}-{####}', InvoiceType.INVOICE, 1, testDate);
      expect(result).toBe('INV-2025-0001');

      const result2 = service.format('{PREFIX}-{YYYY}-{####}', InvoiceType.ESTIMATE, 1, testDate);
      expect(result2).toBe('EST-2025-0001');
    });

    it('should replace date placeholders', () => {
      const result = service.format('INV-{YYYY}-{MM}-{DD}-{####}', InvoiceType.INVOICE, 1, testDate);
      expect(result).toBe('INV-2025-01-15-0001');
    });

    it('should support 2-digit year', () => {
      const result = service.format('INV-{YY}-{####}', InvoiceType.INVOICE, 1, testDate);
      expect(result).toBe('INV-25-0001');
    });
  });

  describe('extractSequence', () => {
    it('should extract sequence from default format', () => {
      const result = service.extractSequence('INV-2025-0042', null, InvoiceType.INVOICE);
      expect(result).toBe(42);
    });

    it('should extract sequence from end of invoice number', () => {
      const result = service.extractSequence('INV-2025-01-15-0042', null, InvoiceType.INVOICE);
      expect(result).toBe(42);
    });

    it('should handle different sequence lengths', () => {
      const result1 = service.extractSequence('INV-2025-5', null, InvoiceType.INVOICE);
      expect(result1).toBe(5);

      const result2 = service.extractSequence('INV-2025-123', null, InvoiceType.INVOICE);
      expect(result2).toBe(123);
    });

    it('should return null if sequence cannot be extracted', () => {
      const result = service.extractSequence('INVALID-FORMAT', null, InvoiceType.INVOICE);
      expect(result).toBeNull();
    });
  });

  describe('isValidFormat', () => {
    it('should validate correct format patterns', () => {
      expect(service.isValidFormat('INV-{YYYY}-{####}')).toBe(true);
      expect(service.isValidFormat('EST-{YYYY}-{####}')).toBe(true);
      expect(service.isValidFormat('{PREFIX}-{YYYY}-{###}')).toBe(true);
    });

    it('should reject formats without sequence placeholder', () => {
      expect(service.isValidFormat('INV-{YYYY}')).toBe(false);
      expect(service.isValidFormat('INV-2025')).toBe(false);
    });

    it('should reject empty or too long formats', () => {
      expect(service.isValidFormat('')).toBe(false);
      expect(service.isValidFormat('a'.repeat(101))).toBe(false);
    });

    it('should reject formats without placeholders', () => {
      expect(service.isValidFormat('INV-2025-0001')).toBe(false);
    });
  });
});

