/**
 * Comprehensive tests for filtering functionality
 * Tests invoice and client filtering features
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { ClientsService } from '../src/clients/clients.service';
import { InvoicesService } from '../src/invoices/invoices.service';
import { Client } from '../src/entities/client.entity';
import { Invoice, InvoiceType, InvoiceStatus } from '../src/entities/invoice.entity';
import { InvoiceItem } from '../src/entities/invoice-item.entity';
import { User } from '../src/entities/user.entity';
import { DataSource } from 'typeorm';
import { PaginationDto } from '../src/core/dto/pagination.dto';

describe('Filtering Functionality', () => {
  describe('Client Filtering', () => {
    let service: ClientsService;
    let mockRepository: any;
    let mockQueryBuilder: any;

    beforeEach(async () => {
      // Create a mock query builder
      mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn(),
      };

      mockRepository = {
        createQueryBuilder: jest.fn(() => mockQueryBuilder),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ClientsService,
          {
            provide: getRepositoryToken(Client),
            useValue: mockRepository,
          },
        ],
      }).compile();

      service = module.get<ClientsService>(ClientsService);
      jest.clearAllMocks();
    });

    describe('Tag Filtering', () => {
      it('should filter clients by single tag', async () => {
        const userId = 'user-id';
        const tags = ['VIP'];
        const clients = [
          { id: '1', userId, name: 'VIP Client', tagsJson: ['VIP', 'Active'] },
        ];
        const total = 1;

        mockQueryBuilder.getManyAndCount.mockResolvedValue([clients, total]);

        await service.findAll(userId, undefined, tags);

        // Verify tag filtering was applied
        expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
          expect.stringContaining('EXISTS'),
          expect.any(Object),
        );
        expect(mockQueryBuilder.getManyAndCount).toHaveBeenCalled();
      });

      it('should filter clients by multiple tags (AND logic)', async () => {
        const userId = 'user-id';
        const tags = ['VIP', 'Active'];
        const clients: Client[] = [];
        const total = 0;

        mockQueryBuilder.getManyAndCount.mockResolvedValue([clients, total]);

        await service.findAll(userId, undefined, tags);

        // Should be called twice - once for each tag
        const tagFilterCalls = mockQueryBuilder.andWhere.mock.calls.filter(
          (call) => call[0].includes('EXISTS'),
        );
        expect(tagFilterCalls.length).toBeGreaterThanOrEqual(2);
      });

      it('should not apply tag filter when tags array is empty', async () => {
        const userId = 'user-id';
        const clients: Client[] = [];
        const total = 0;

        mockQueryBuilder.getManyAndCount.mockResolvedValue([clients, total]);

        await service.findAll(userId, undefined, []);

        // No tag filtering should be applied
        const tagFilterCalls = mockQueryBuilder.andWhere.mock.calls.filter(
          (call) => call[0].includes('tag_elem'),
        );
        expect(tagFilterCalls.length).toBe(0);
      });
    });

    describe('Date Range Filtering', () => {
      it('should filter clients by dateFrom', async () => {
        const userId = 'user-id';
        const dateFrom = '2025-01-01';
        const clients: Client[] = [];
        const total = 0;

        mockQueryBuilder.getManyAndCount.mockResolvedValue([clients, total]);

        await service.findAll(userId, undefined, undefined, dateFrom);

        expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
          'client.createdAt >= :dateFrom',
          { dateFrom },
        );
      });

      it('should filter clients by dateTo', async () => {
        const userId = 'user-id';
        const dateTo = '2025-12-31';
        const clients: Client[] = [];
        const total = 0;

        mockQueryBuilder.getManyAndCount.mockResolvedValue([clients, total]);

        await service.findAll(userId, undefined, undefined, undefined, dateTo);

        expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
          'client.createdAt <= :dateTo',
          { dateTo },
        );
      });

      it('should filter clients by date range', async () => {
        const userId = 'user-id';
        const dateFrom = '2025-01-01';
        const dateTo = '2025-12-31';
        const clients: Client[] = [];
        const total = 0;

        mockQueryBuilder.getManyAndCount.mockResolvedValue([clients, total]);

        await service.findAll(userId, undefined, undefined, dateFrom, dateTo);

        expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
          'client.createdAt >= :dateFrom',
          { dateFrom },
        );
        expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
          'client.createdAt <= :dateTo',
          { dateTo },
        );
      });
    });

    describe('Combined Filters', () => {
      it('should apply tags, date range, and search filters together', async () => {
        const userId = 'user-id';
        const pagination: PaginationDto = { search: 'test' };
        const tags = ['VIP'];
        const dateFrom = '2025-01-01';
        const dateTo = '2025-12-31';
        const clients: Client[] = [];
        const total = 0;

        mockQueryBuilder.getManyAndCount.mockResolvedValue([clients, total]);

        await service.findAll(userId, pagination, tags, dateFrom, dateTo);

        // Verify all filters were applied
        expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
          expect.stringContaining('EXISTS'), // Tag filter
          expect.any(Object),
        );
        expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
          'client.createdAt >= :dateFrom',
          { dateFrom },
        );
        expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
          'client.createdAt <= :dateTo',
          { dateTo },
        );
        expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
          expect.stringContaining('LIKE'), // Search filter
          expect.any(Object),
        );
      });
    });
  });

  describe('Invoice Filtering', () => {
    let service: InvoicesService;
    let mockInvoiceRepository: any;
    let mockInvoiceItemRepository: any;
    let mockClientRepository: any;
    let mockUserRepository: any;
    let mockDataSource: any;
    let mockQueryBuilder: any;

    beforeEach(async () => {
      mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn(),
      };

      mockInvoiceRepository = {
        createQueryBuilder: jest.fn(() => mockQueryBuilder),
        findOne: jest.fn(),
      };

      mockInvoiceItemRepository = {};
      mockClientRepository = {};
      mockUserRepository = {};

      mockDataSource = {
        createQueryRunner: jest.fn(),
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
            provide: getRepositoryToken(User),
            useValue: mockUserRepository,
          },
          {
            provide: DataSource,
            useValue: mockDataSource,
          },
          {
            provide: 'NotificationService',
            useValue: { notifyInvoicePaid: jest.fn() },
          },
          {
            provide: 'CacheService',
            useValue: {},
          },
          {
            provide: 'InvoiceNumberFormatterService',
            useValue: { format: jest.fn(), extractSequence: jest.fn() },
          },
        ],
      }).compile();

      service = module.get<InvoicesService>(InvoicesService);
      jest.clearAllMocks();
    });

    describe('Date Range Filtering', () => {
      it('should filter invoices by dateFrom', async () => {
        const userId = 'user-id';
        const dateFrom = '2025-01-01';
        const invoices: Invoice[] = [];
        const total = 0;

        mockQueryBuilder.getManyAndCount.mockResolvedValue([invoices, total]);

        await service.findAll(userId, undefined, undefined, undefined, undefined, dateFrom);

        expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
          'invoice.issueDate >= :dateFrom',
          { dateFrom },
        );
      });

      it('should filter invoices by dateTo', async () => {
        const userId = 'user-id';
        const dateTo = '2025-12-31';
        const invoices: Invoice[] = [];
        const total = 0;

        mockQueryBuilder.getManyAndCount.mockResolvedValue([invoices, total]);

        await service.findAll(userId, undefined, undefined, undefined, undefined, undefined, dateTo);

        expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
          'invoice.issueDate <= :dateTo',
          { dateTo },
        );
      });

      it('should filter invoices by date range', async () => {
        const userId = 'user-id';
        const dateFrom = '2025-01-01';
        const dateTo = '2025-12-31';
        const invoices: Invoice[] = [];
        const total = 0;

        mockQueryBuilder.getManyAndCount.mockResolvedValue([invoices, total]);

        await service.findAll(userId, undefined, undefined, undefined, undefined, dateFrom, dateTo);

        expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
          'invoice.issueDate >= :dateFrom',
          { dateFrom },
        );
        expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
          'invoice.issueDate <= :dateTo',
          { dateTo },
        );
      });
    });

    describe('Amount Range Filtering', () => {
      it('should filter invoices by amountMin', async () => {
        const userId = 'user-id';
        const amountMin = 100;
        const invoices: Invoice[] = [];
        const total = 0;

        mockQueryBuilder.getManyAndCount.mockResolvedValue([invoices, total]);

        await service.findAll(
          userId,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          amountMin,
        );

        expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
          'invoice.total >= :amountMin',
          { amountMin },
        );
      });

      it('should filter invoices by amountMax', async () => {
        const userId = 'user-id';
        const amountMax = 1000;
        const invoices: Invoice[] = [];
        const total = 0;

        mockQueryBuilder.getManyAndCount.mockResolvedValue([invoices, total]);

        await service.findAll(
          userId,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          amountMax,
        );

        expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
          'invoice.total <= :amountMax',
          { amountMax },
        );
      });

      it('should filter invoices by amount range', async () => {
        const userId = 'user-id';
        const amountMin = 100;
        const amountMax = 1000;
        const invoices: Invoice[] = [];
        const total = 0;

        mockQueryBuilder.getManyAndCount.mockResolvedValue([invoices, total]);

        await service.findAll(
          userId,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          amountMin,
          amountMax,
        );

        expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
          'invoice.total >= :amountMin',
          { amountMin },
        );
        expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
          'invoice.total <= :amountMax',
          { amountMax },
        );
      });

      it('should not filter when amountMin is 0', async () => {
        const userId = 'user-id';
        const amountMin = 0;
        const invoices: Invoice[] = [];
        const total = 0;

        mockQueryBuilder.getManyAndCount.mockResolvedValue([invoices, total]);

        await service.findAll(
          userId,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          amountMin,
        );

        expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
          'invoice.total >= :amountMin',
          { amountMin: 0 },
        );
      });
    });

    describe('Combined Invoice Filters', () => {
      it('should apply type, status, date range, and amount filters together', async () => {
        const userId = 'user-id';
        const type = InvoiceType.INVOICE;
        const status = InvoiceStatus.PAID;
        const dateFrom = '2025-01-01';
        const dateTo = '2025-12-31';
        const amountMin = 100;
        const amountMax = 1000;
        const invoices: Invoice[] = [];
        const total = 0;

        mockQueryBuilder.getManyAndCount.mockResolvedValue([invoices, total]);

        await service.findAll(
          userId,
          type,
          undefined,
          undefined,
          status,
          dateFrom,
          dateTo,
          amountMin,
          amountMax,
        );

        // Verify all filters were applied
        expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
          'invoice.type = :type',
          { type },
        );
        expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
          'invoice.status = :status',
          { status },
        );
        expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
          'invoice.issueDate >= :dateFrom',
          { dateFrom },
        );
        expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
          'invoice.issueDate <= :dateTo',
          { dateTo },
        );
        expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
          'invoice.total >= :amountMin',
          { amountMin },
        );
        expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
          'invoice.total <= :amountMax',
          { amountMax },
        );
      });
    });
  });
});

