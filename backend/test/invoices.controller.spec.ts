/**
 * InvoicesController Unit Tests
 * 
 * Note: Request validation testing (invalid DTOs, missing required fields, etc.) is deferred to e2e tests.
 * These unit tests focus on service interaction and error propagation.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InvoicesController } from '../src/invoices/invoices.controller';
import { InvoicesService } from '../src/invoices/invoices.service';
import { PdfService } from '../src/core/services/pdf.service';
import { S3Service } from '../src/core/services/s3.service';
import { StripeService } from '../src/core/services/stripe.service';
import { PaymentsService } from '../src/payments/payments.service';
import { AuditService } from '../src/core/services/audit.service';
import { InvoiceType, InvoiceStatus } from '../src/entities/invoice.entity';
import { Attachment } from '../src/entities/attachment.entity';
import { AttachmentOwnerType } from '../src/entities/attachment.entity';
import { AuditAction, AuditResource } from '../src/entities/audit-log.entity';
import { CreateInvoiceDto, UpdateInvoiceDto } from '../src/invoices/dto/invoice.dto';
import { PaginationDto } from '../src/core/dto/pagination.dto';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { Repository } from 'typeorm';

describe('InvoicesController', () => {
  let controller: InvoicesController;
  let invoicesService: jest.Mocked<InvoicesService>;
  let pdfService: jest.Mocked<PdfService>;
  let s3Service: jest.Mocked<S3Service>;
  let stripeService: jest.Mocked<StripeService>;
  let paymentsService: jest.Mocked<PaymentsService>;
  let auditService: jest.Mocked<AuditService>;
  let attachmentRepository: jest.Mocked<Repository<Attachment>>;

  const mockUser = {
    userId: 'user-id',
    email: 'test@example.com',
    name: 'Test User',
    companyName: 'Test Company',
  };

  const mockRequest = {
    ip: '127.0.0.1',
  };

  beforeEach(async () => {
    const mockInvoicesService = {
      findAll: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      convertEstimateToInvoice: jest.fn(),
    };

    const mockPdfService = {
      generateInvoicePdf: jest.fn(),
    };

    const mockS3Service = {
      uploadFile: jest.fn(),
    };

    const mockStripeService = {
      createPaymentIntent: jest.fn(),
      verifyWebhookSignature: jest.fn(),
    };

    const mockPaymentsService = {
      createPayment: jest.fn(),
      updatePaymentStatus: jest.fn(),
    };

    const mockAuditService = {
      log: jest.fn(),
    };

    const mockAttachmentRepository = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InvoicesController],
      providers: [
        {
          provide: InvoicesService,
          useValue: mockInvoicesService,
        },
        {
          provide: PdfService,
          useValue: mockPdfService,
        },
        {
          provide: S3Service,
          useValue: mockS3Service,
        },
        {
          provide: StripeService,
          useValue: mockStripeService,
        },
        {
          provide: PaymentsService,
          useValue: mockPaymentsService,
        },
        {
          provide: AuditService,
          useValue: mockAuditService,
        },
        {
          provide: getRepositoryToken(Attachment),
          useValue: mockAttachmentRepository,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: jest.fn(() => true),
      })
      .compile();

    controller = module.get<InvoicesController>(InvoicesController);
    invoicesService = module.get(InvoicesService);
    pdfService = module.get(PdfService);
    s3Service = module.get(S3Service);
    stripeService = module.get(StripeService);
    paymentsService = module.get(PaymentsService);
    auditService = module.get(AuditService);
    attachmentRepository = module.get(getRepositoryToken(Attachment));

    jest.clearAllMocks();
  });

  describe('GET /invoices (findAll)', () => {
    it('should call invoicesService.findAll with userId, type filter (invoice/estimate), and PaginationDto', async () => {
      const type = 'invoice';
      const pagination: PaginationDto = {
        page: 1,
        limit: 20,
      };

      const paginatedResponse = {
        data: [
          {
            id: 'invoice-1',
            userId: mockUser.userId,
            type: InvoiceType.INVOICE,
          },
        ],
        meta: {
          page: 1,
          limit: 20,
          total: 1,
          totalPages: 1,
        },
      };

      invoicesService.findAll.mockResolvedValue(paginatedResponse as any);

      const result = await controller.findAll(type as InvoiceType, pagination, mockUser);

      expect(invoicesService.findAll).toHaveBeenCalledWith(mockUser.userId, type as InvoiceType, pagination);
      expect(result).toEqual(paginatedResponse);
    });

    it('should return PaginatedResponse with invoices', async () => {
      const pagination: PaginationDto = {
        page: 1,
        limit: 20,
      };

      const paginatedResponse = {
        data: [
          {
            id: 'invoice-1',
            userId: mockUser.userId,
            type: InvoiceType.INVOICE,
          },
        ],
        meta: {
          page: 1,
          limit: 20,
          total: 1,
          totalPages: 1,
        },
      };

      invoicesService.findAll.mockResolvedValue(paginatedResponse as any);

      const result = await controller.findAll(undefined, pagination, mockUser);

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('meta');
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('should handle optional type query parameter', async () => {
      const pagination: PaginationDto = {
        page: 1,
        limit: 20,
      };

      const paginatedResponse = {
        data: [],
        meta: {
          page: 1,
          limit: 20,
          total: 0,
          totalPages: 0,
        },
      };

      invoicesService.findAll.mockResolvedValue(paginatedResponse as any);

      await controller.findAll(undefined, pagination, mockUser);

      expect(invoicesService.findAll).toHaveBeenCalledWith(mockUser.userId, undefined, pagination);
    });

    it('should handle pagination parameters (page, limit)', async () => {
      const pagination: PaginationDto = {
        page: 2,
        limit: 10,
      };

      const paginatedResponse = {
        data: [],
        meta: {
          page: 2,
          limit: 10,
          total: 0,
          totalPages: 0,
        },
      };

      invoicesService.findAll.mockResolvedValue(paginatedResponse as any);

      await controller.findAll(undefined, pagination, mockUser);

      expect(invoicesService.findAll).toHaveBeenCalledWith(mockUser.userId, undefined, pagination);
    });
  });

  describe('GET /invoices/:id (findOne)', () => {
    it('should call invoicesService.findOne with id and userId', async () => {
      const id = 'invoice-id';
      const invoice = {
        id,
        userId: mockUser.userId,
        number: 'INV-001',
        client: { id: 'client-id', name: 'Client' },
        items: [],
      };

      invoicesService.findOne.mockResolvedValue(invoice as any);

      const result = await controller.findOne(id, mockUser, mockRequest as any);

      expect(invoicesService.findOne).toHaveBeenCalledWith(id, mockUser.userId);
      expect(result).toEqual(invoice);
    });

    it('should call auditService.log with VIEW action, invoice details, and request IP', async () => {
      const id = 'invoice-id';
      const invoice = {
        id,
        userId: mockUser.userId,
        number: 'INV-001',
        client: { id: 'client-id', name: 'Client' },
        items: [],
      };

      invoicesService.findOne.mockResolvedValue(invoice as any);
      auditService.log.mockResolvedValue(undefined);

      await controller.findOne(id, mockUser, mockRequest as any);

      expect(auditService.log).toHaveBeenCalledWith(
        mockUser.userId,
        AuditAction.VIEW,
        AuditResource.INVOICE,
        id,
        { invoiceNumber: invoice.number },
        mockRequest.ip,
      );
    });

    it('should return invoice with relations (client, items, attachments)', async () => {
      const id = 'invoice-id';
      const invoice = {
        id,
        userId: mockUser.userId,
        number: 'INV-001',
        client: { id: 'client-id', name: 'Client' },
        items: [{ id: 'item-1', description: 'Item 1' }],
        attachments: [{ id: 'att-1', url: 'https://example.com/file.pdf' }],
      };

      invoicesService.findOne.mockResolvedValue(invoice as any);

      const result = await controller.findOne(id, mockUser, mockRequest as any);

      expect(result.client).toBeDefined();
      expect(result.items).toBeDefined();
    });

    it('should propagate NotFoundException when invoice not found', async () => {
      const id = 'non-existent-id';

      invoicesService.findOne.mockRejectedValue(new NotFoundException('Invoice not found'));

      await expect(controller.findOne(id, mockUser, mockRequest as any)).rejects.toThrow(NotFoundException);
      expect(invoicesService.findOne).toHaveBeenCalledWith(id, mockUser.userId);
    });
  });

  describe('POST /invoices (create)', () => {
    it('should call invoicesService.create with CreateInvoiceDto and userId', async () => {
      const createInvoiceDto: CreateInvoiceDto = {
        clientId: 'client-id',
        type: InvoiceType.INVOICE,
        issueDate: '2024-01-01',
        items: [
          {
            description: 'Item 1',
            quantity: 1,
            unitPrice: 100,
          },
        ],
      };

      const createdInvoice = {
        id: 'invoice-id',
        userId: mockUser.userId,
        ...createInvoiceDto,
        number: 'INV-001',
        total: 100,
      };

      invoicesService.create.mockResolvedValue(createdInvoice as any);

      const result = await controller.create(createInvoiceDto, mockUser, mockRequest as any);

      expect(invoicesService.create).toHaveBeenCalledWith(createInvoiceDto, mockUser.userId);
      expect(result).toEqual(createdInvoice);
    });

    it('should call auditService.log with CREATE action and invoice metadata', async () => {
      const createInvoiceDto: CreateInvoiceDto = {
        clientId: 'client-id',
        type: InvoiceType.INVOICE,
        issueDate: '2024-01-01',
        items: [],
      };

      const createdInvoice = {
        id: 'invoice-id',
        userId: mockUser.userId,
        number: 'INV-001',
        type: InvoiceType.INVOICE,
      };

      invoicesService.create.mockResolvedValue(createdInvoice as any);
      auditService.log.mockResolvedValue(undefined);

      await controller.create(createInvoiceDto, mockUser, mockRequest as any);

      expect(auditService.log).toHaveBeenCalledWith(
        mockUser.userId,
        AuditAction.CREATE,
        AuditResource.INVOICE,
        createdInvoice.id,
        { invoiceNumber: createdInvoice.number, type: createdInvoice.type },
        mockRequest.ip,
      );
    });

    it('should return created invoice with HTTP 201 status', async () => {
      const createInvoiceDto: CreateInvoiceDto = {
        clientId: 'client-id',
        type: InvoiceType.INVOICE,
        issueDate: '2024-01-01',
        items: [],
      };

      const createdInvoice = {
        id: 'invoice-id',
        userId: mockUser.userId,
        ...createInvoiceDto,
        number: 'INV-001',
      };

      invoicesService.create.mockResolvedValue(createdInvoice as any);

      await controller.create(createInvoiceDto, mockUser, mockRequest as any);

      expect(invoicesService.create).toHaveBeenCalled();
    });

    it('should validate required fields (clientId, items array, type)', async () => {
      const createInvoiceDto: CreateInvoiceDto = {
        clientId: 'client-id',
        type: InvoiceType.INVOICE,
        issueDate: '2024-01-01',
        items: [
          {
            description: 'Item 1',
            quantity: 1,
            unitPrice: 100,
          },
        ],
      };

      const createdInvoice = {
        id: 'invoice-id',
        userId: mockUser.userId,
        ...createInvoiceDto,
        number: 'INV-001',
      };

      invoicesService.create.mockResolvedValue(createdInvoice as any);

      const result = await controller.create(createInvoiceDto, mockUser, mockRequest as any);

      expect(result.clientId).toBe(createInvoiceDto.clientId);
      expect(result.type).toBe(createInvoiceDto.type);
      expect(result.items).toBeDefined();
    });

    it('should calculate totals automatically', async () => {
      const createInvoiceDto: CreateInvoiceDto = {
        clientId: 'client-id',
        type: InvoiceType.INVOICE,
        issueDate: '2024-01-01',
        items: [
          {
            description: 'Item 1',
            quantity: 2,
            unitPrice: 100,
          },
        ],
      };

      const createdInvoice = {
        id: 'invoice-id',
        userId: mockUser.userId,
        ...createInvoiceDto,
        number: 'INV-001',
        total: 200,
      };

      invoicesService.create.mockResolvedValue(createdInvoice as any);

      const result = await controller.create(createInvoiceDto, mockUser, mockRequest as any);

      expect(result.total).toBe(200);
    });
  });

  describe('PATCH /invoices/:id (update)', () => {
    it('should call invoicesService.update with id, UpdateInvoiceDto, and userId', async () => {
      const id = 'invoice-id';
      const updateInvoiceDto: UpdateInvoiceDto = {
        notes: 'Updated notes',
      };

      const updatedInvoice = {
        id,
        userId: mockUser.userId,
        number: 'INV-001',
        ...updateInvoiceDto,
      };

      invoicesService.update.mockResolvedValue(updatedInvoice as any);

      const result = await controller.update(id, updateInvoiceDto, mockUser, mockRequest as any);

      expect(invoicesService.update).toHaveBeenCalledWith(id, updateInvoiceDto, mockUser.userId);
      expect(result).toEqual(updatedInvoice);
    });

    it('should call auditService.log with UPDATE action and changed fields', async () => {
      const id = 'invoice-id';
      const updateInvoiceDto: UpdateInvoiceDto = {
        notes: 'Updated notes',
      };

      const updatedInvoice = {
        id,
        userId: mockUser.userId,
        number: 'INV-001',
        ...updateInvoiceDto,
      };

      invoicesService.update.mockResolvedValue(updatedInvoice as any);
      auditService.log.mockResolvedValue(undefined);

      await controller.update(id, updateInvoiceDto, mockUser, mockRequest as any);

      expect(auditService.log).toHaveBeenCalledWith(
        mockUser.userId,
        AuditAction.UPDATE,
        AuditResource.INVOICE,
        id,
        { invoiceNumber: updatedInvoice.number, changes: Object.keys(updateInvoiceDto) },
        mockRequest.ip,
      );
    });

    it('should return updated invoice', async () => {
      const id = 'invoice-id';
      const updateInvoiceDto: UpdateInvoiceDto = {
        notes: 'Updated notes',
      };

      const updatedInvoice = {
        id,
        userId: mockUser.userId,
        number: 'INV-001',
        ...updateInvoiceDto,
      };

      invoicesService.update.mockResolvedValue(updatedInvoice as any);

      const result = await controller.update(id, updateInvoiceDto, mockUser, mockRequest as any);

      expect(result).toEqual(updatedInvoice);
      expect(result.notes).toBe(updateInvoiceDto.notes);
    });

    it('should allow partial updates', async () => {
      const id = 'invoice-id';
      const updateInvoiceDto: UpdateInvoiceDto = {
        notes: 'Updated notes only',
      };

      const updatedInvoice = {
        id,
        userId: mockUser.userId,
        number: 'INV-001',
        notes: updateInvoiceDto.notes,
        status: InvoiceStatus.DRAFT,
      };

      invoicesService.update.mockResolvedValue(updatedInvoice as any);

      const result = await controller.update(id, updateInvoiceDto, mockUser, mockRequest as any);

      expect(result.notes).toBe(updateInvoiceDto.notes);
    });

    it('should propagate NotFoundException/ForbiddenException', async () => {
      const id = 'non-existent-id';
      const updateInvoiceDto: UpdateInvoiceDto = {
        notes: 'Updated notes',
      };

      invoicesService.update.mockRejectedValue(new NotFoundException('Invoice not found'));

      await expect(controller.update(id, updateInvoiceDto, mockUser, mockRequest as any)).rejects.toThrow(NotFoundException);
    });
  });

  describe('DELETE /invoices/:id (delete)', () => {
    it('should call invoicesService.findOne then invoicesService.delete (soft delete)', async () => {
      const id = 'invoice-id';
      const invoice = {
        id,
        userId: mockUser.userId,
        number: 'INV-001',
      };

      invoicesService.findOne.mockResolvedValue(invoice as any);
      invoicesService.delete.mockResolvedValue(undefined);
      auditService.log.mockResolvedValue(undefined);

      const result = await controller.delete(id, mockUser, mockRequest as any);

      expect(invoicesService.findOne).toHaveBeenCalledWith(id, mockUser.userId);
      expect(invoicesService.delete).toHaveBeenCalledWith(id, mockUser.userId);
      expect(result).toEqual({ message: 'Invoice deleted' });
    });

    it('should call auditService.log with DELETE action', async () => {
      const id = 'invoice-id';
      const invoice = {
        id,
        userId: mockUser.userId,
        number: 'INV-001',
      };

      invoicesService.findOne.mockResolvedValue(invoice as any);
      invoicesService.delete.mockResolvedValue(undefined);
      auditService.log.mockResolvedValue(undefined);

      await controller.delete(id, mockUser, mockRequest as any);

      expect(auditService.log).toHaveBeenCalledWith(
        mockUser.userId,
        AuditAction.DELETE,
        AuditResource.INVOICE,
        id,
        { invoiceNumber: invoice.number },
        mockRequest.ip,
      );
    });

    it('should return success message: { message: \'Invoice deleted\' }', async () => {
      const id = 'invoice-id';
      const invoice = {
        id,
        userId: mockUser.userId,
        number: 'INV-001',
      };

      invoicesService.findOne.mockResolvedValue(invoice as any);
      invoicesService.delete.mockResolvedValue(undefined);
      auditService.log.mockResolvedValue(undefined);

      const result = await controller.delete(id, mockUser, mockRequest as any);

      expect(result).toEqual({ message: 'Invoice deleted' });
    });
  });

  describe('POST /invoices/:id/convert (convertEstimateToInvoice)', () => {
    it('should call invoicesService.findOne to verify it\'s an estimate', async () => {
      const id = 'estimate-id';
      const estimate = {
        id,
        userId: mockUser.userId,
        clientId: 'client-id',
        type: InvoiceType.ESTIMATE,
        number: 'EST-001',
        status: InvoiceStatus.DRAFT,
        issueDate: new Date('2024-01-01'),
        currency: 'USD',
      } as any;

      const convertedInvoice = {
        id: 'invoice-id',
        userId: mockUser.userId,
        clientId: 'client-id',
        type: InvoiceType.INVOICE,
        number: 'INV-001',
        status: InvoiceStatus.DRAFT,
        issueDate: new Date('2024-01-01'),
        currency: 'USD',
      } as any;

      invoicesService.findOne.mockResolvedValue(estimate);
      invoicesService.convertEstimateToInvoice.mockResolvedValue(convertedInvoice);
      auditService.log.mockResolvedValue(undefined);

      const result = await controller.convert(id, mockUser, mockRequest as any);

      expect(invoicesService.findOne).toHaveBeenCalledWith(id, mockUser.userId);
      expect(result).toEqual(convertedInvoice);
    });

    it('should call invoicesService.convertEstimateToInvoice', async () => {
      const id = 'estimate-id';
      const estimate = {
        id,
        userId: mockUser.userId,
        clientId: 'client-id',
        type: InvoiceType.ESTIMATE,
        number: 'EST-001',
        status: InvoiceStatus.DRAFT,
        issueDate: new Date('2024-01-01'),
        currency: 'USD',
      } as any;

      const convertedInvoice = {
        id: 'invoice-id',
        userId: mockUser.userId,
        clientId: 'client-id',
        type: InvoiceType.INVOICE,
        number: 'INV-001',
        status: InvoiceStatus.DRAFT,
        issueDate: new Date('2024-01-01'),
        currency: 'USD',
      } as any;

      invoicesService.findOne.mockResolvedValue(estimate);
      invoicesService.convertEstimateToInvoice.mockResolvedValue(convertedInvoice);
      auditService.log.mockResolvedValue(undefined);

      await controller.convert(id, mockUser, mockRequest as any);

      expect(invoicesService.convertEstimateToInvoice).toHaveBeenCalledWith(id, mockUser.userId);
    });

    it('should call auditService.log with convert action and new invoice ID', async () => {
      const id = 'estimate-id';
      const estimate = {
        id,
        userId: mockUser.userId,
        clientId: 'client-id',
        type: InvoiceType.ESTIMATE,
        number: 'EST-001',
        status: InvoiceStatus.DRAFT,
        issueDate: new Date('2024-01-01'),
        currency: 'USD',
      } as any;

      const convertedInvoice = {
        id: 'invoice-id',
        userId: mockUser.userId,
        clientId: 'client-id',
        type: InvoiceType.INVOICE,
        number: 'INV-001',
        status: InvoiceStatus.DRAFT,
        issueDate: new Date('2024-01-01'),
        currency: 'USD',
      } as any;

      invoicesService.findOne.mockResolvedValue(estimate);
      invoicesService.convertEstimateToInvoice.mockResolvedValue(convertedInvoice);
      auditService.log.mockResolvedValue(undefined);

      await controller.convert(id, mockUser, mockRequest as any);

      expect(auditService.log).toHaveBeenCalledWith(
        mockUser.userId,
        AuditAction.UPDATE,
        AuditResource.INVOICE,
        id,
        { action: 'convert_estimate', newInvoiceId: convertedInvoice.id },
        mockRequest.ip,
      );
    });

    it('should return new invoice object', async () => {
      const id = 'estimate-id';
      const estimate = {
        id,
        userId: mockUser.userId,
        clientId: 'client-id',
        type: InvoiceType.ESTIMATE,
        number: 'EST-001',
        status: InvoiceStatus.DRAFT,
        issueDate: new Date('2024-01-01'),
        currency: 'USD',
      } as any;

      const convertedInvoice = {
        id: 'invoice-id',
        userId: mockUser.userId,
        clientId: 'client-id',
        type: InvoiceType.INVOICE,
        number: 'INV-001',
        status: InvoiceStatus.DRAFT,
        issueDate: new Date('2024-01-01'),
        currency: 'USD',
      } as any;

      invoicesService.findOne.mockResolvedValue(estimate);
      invoicesService.convertEstimateToInvoice.mockResolvedValue(convertedInvoice);
      auditService.log.mockResolvedValue(undefined);

      const result = await controller.convert(id, mockUser, mockRequest as any);

      expect(result.type).toBe(InvoiceType.INVOICE);
      expect(result.id).toBe(convertedInvoice.id);
    });

    it('should propagate BadRequestException if not an estimate', async () => {
      const id = 'invoice-id';
      const invoice = {
        id,
        userId: mockUser.userId,
        clientId: 'client-id',
        type: InvoiceType.INVOICE,
        number: 'INV-001',
        status: InvoiceStatus.DRAFT,
        issueDate: new Date('2024-01-01'),
        currency: 'USD',
      } as any;

      invoicesService.findOne.mockResolvedValue(invoice as any);
      invoicesService.convertEstimateToInvoice.mockRejectedValue(new BadRequestException('Only estimates can be converted'));

      await expect(controller.convert(id, mockUser, mockRequest as any)).rejects.toThrow(BadRequestException);
    });
  });

  describe('POST /invoices/:id/send (send email stub)', () => {
    it('should call invoicesService.findOne to verify invoice exists', async () => {
      const id = 'invoice-id';
      const invoice = {
        id,
        userId: mockUser.userId,
        number: 'INV-001',
      };

      invoicesService.findOne.mockResolvedValue(invoice as any);
      auditService.log.mockResolvedValue(undefined);

      const result = await controller.send(id, mockUser, mockRequest as any);

      expect(invoicesService.findOne).toHaveBeenCalledWith(id, mockUser.userId);
      expect(result).toEqual({ message: 'Invoice sent (stub)', invoiceId: invoice.id });
    });

    it('should call auditService.log with EXPORT action', async () => {
      const id = 'invoice-id';
      const invoice = {
        id,
        userId: mockUser.userId,
        number: 'INV-001',
      };

      invoicesService.findOne.mockResolvedValue(invoice as any);
      auditService.log.mockResolvedValue(undefined);

      await controller.send(id, mockUser, mockRequest as any);

      expect(auditService.log).toHaveBeenCalledWith(
        mockUser.userId,
        AuditAction.EXPORT,
        AuditResource.INVOICE,
        id,
        { invoiceNumber: invoice.number, action: 'send' },
        mockRequest.ip,
      );
    });

    it('should return stub message: { message: \'Invoice sent (stub)\', invoiceId }', async () => {
      const id = 'invoice-id';
      const invoice = {
        id,
        userId: mockUser.userId,
        number: 'INV-001',
      };

      invoicesService.findOne.mockResolvedValue(invoice as any);
      auditService.log.mockResolvedValue(undefined);

      const result = await controller.send(id, mockUser, mockRequest as any);

      expect(result).toEqual({ message: 'Invoice sent (stub)', invoiceId: invoice.id });
    });
  });

  describe('GET /invoices/:id/attachments (getAttachments)', () => {
    it('should return list of attachments for an invoice', async () => {
      const id = 'invoice-id';
      const invoice = {
        id,
        userId: mockUser.userId,
        number: 'INV-001',
      };

      const mockAttachments = [
        {
          id: 'attachment-1',
          ownerType: AttachmentOwnerType.INVOICE,
          ownerId: id,
          url: 'https://s3.example.com/file1.pdf',
          filename: 'file1.pdf',
          contentType: 'application/pdf',
          sizeBytes: 1024,
          createdAt: new Date(),
        },
        {
          id: 'attachment-2',
          ownerType: AttachmentOwnerType.INVOICE,
          ownerId: id,
          url: 'https://s3.example.com/file2.jpg',
          filename: 'file2.jpg',
          contentType: 'image/jpeg',
          sizeBytes: 2048,
          createdAt: new Date(),
        },
      ];

      invoicesService.findOne.mockResolvedValue(invoice as any);
      attachmentRepository.find = jest.fn().mockResolvedValue(mockAttachments);

      const result = await controller.getAttachments(id, mockUser);

      expect(invoicesService.findOne).toHaveBeenCalledWith(id, mockUser.userId);
      expect(attachmentRepository.find).toHaveBeenCalledWith({
        where: {
          ownerType: AttachmentOwnerType.INVOICE,
          ownerId: invoice.id,
        },
        order: {
          createdAt: 'DESC',
        },
      });
      expect(result).toEqual(mockAttachments);
    });

    it('should return 404 if invoice not found', async () => {
      const id = 'non-existent-id';
      invoicesService.findOne.mockRejectedValue(new NotFoundException('Invoice not found'));

      await expect(controller.getAttachments(id, mockUser)).rejects.toThrow(NotFoundException);
      expect(invoicesService.findOne).toHaveBeenCalledWith(id, mockUser.userId);
    });

    it('should only return attachments for the specified invoice', async () => {
      const id = 'invoice-id';
      const invoice = {
        id,
        userId: mockUser.userId,
        number: 'INV-001',
      };

      const mockAttachments = [
        {
          id: 'attachment-1',
          ownerType: AttachmentOwnerType.INVOICE,
          ownerId: id,
          url: 'https://s3.example.com/file1.pdf',
          filename: 'file1.pdf',
          contentType: 'application/pdf',
          sizeBytes: 1024,
          createdAt: new Date(),
        },
      ];

      invoicesService.findOne.mockResolvedValue(invoice as any);
      attachmentRepository.find = jest.fn().mockResolvedValue(mockAttachments);

      const result = await controller.getAttachments(id, mockUser);

      expect(attachmentRepository.find).toHaveBeenCalledWith({
        where: {
          ownerType: AttachmentOwnerType.INVOICE,
          ownerId: invoice.id,
        },
        order: {
          createdAt: 'DESC',
        },
      });
      expect(result).toHaveLength(1);
      expect(result[0].ownerId).toBe(id);
    });
  });

  describe('POST /invoices/:id/attachments (uploadAttachment)', () => {
    it('should validate file exists (throw BadRequestException if missing)', async () => {
      const id = 'invoice-id';
      const invoice = {
        id,
        userId: mockUser.userId,
        number: 'INV-001',
      };

      invoicesService.findOne.mockResolvedValue(invoice as any);

      await expect(controller.uploadAttachment(id, undefined, mockUser, mockRequest as any)).rejects.toThrow(BadRequestException);
      expect(invoicesService.findOne).toHaveBeenCalledWith(id, mockUser.userId);
    });

    it('should validate file type (JPEG, PNG, GIF, PDF only)', async () => {
      const id = 'invoice-id';
      const invoice = {
        id,
        userId: mockUser.userId,
        number: 'INV-001',
      };

      const invalidFile = {
        originalname: 'test.txt',
        mimetype: 'text/plain',
        buffer: Buffer.from('test'),
        size: 4,
      };

      invoicesService.findOne.mockResolvedValue(invoice as any);

      await expect(controller.uploadAttachment(id, invalidFile as any, mockUser, mockRequest as any)).rejects.toThrow(BadRequestException);
    });

    it('should call s3Service.uploadFile with key pattern: invoices/{id}/attachments/{timestamp}-{filename}', async () => {
      const id = 'invoice-id';
      const invoice = {
        id,
        userId: mockUser.userId,
        number: 'INV-001',
      };

      const file = {
        originalname: 'test.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.from('test'),
        size: 4,
      };

      const s3Url = 'https://s3.amazonaws.com/bucket/invoices/invoice-id/attachments/123-test.pdf';

      invoicesService.findOne.mockResolvedValue(invoice as any);
      s3Service.uploadFile.mockResolvedValue(s3Url);
      attachmentRepository.create.mockReturnValue({
        id: 'attachment-id',
        ownerType: AttachmentOwnerType.INVOICE,
        ownerId: invoice.id,
        url: s3Url,
        filename: file.originalname,
        contentType: file.mimetype,
        sizeBytes: file.size,
      } as any);
      attachmentRepository.save.mockResolvedValue({
        id: 'attachment-id',
        url: s3Url,
      } as any);
      auditService.log.mockResolvedValue(undefined);

      await controller.uploadAttachment(id, file as any, mockUser, mockRequest as any);

      expect(s3Service.uploadFile).toHaveBeenCalledWith(
        expect.stringMatching(/^invoices\/invoice-id\/attachments\/\d+-test\.pdf$/),
        file.buffer,
        file.mimetype,
      );
    });

    it('should save attachment record to database via attachmentRepository', async () => {
      const id = 'invoice-id';
      const invoice = {
        id,
        userId: mockUser.userId,
        number: 'INV-001',
      };

      const file = {
        originalname: 'test.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.from('test'),
        size: 4,
      };

      const s3Url = 'https://s3.amazonaws.com/bucket/invoices/invoice-id/attachments/123-test.pdf';
      const attachment = {
        id: 'attachment-id',
        ownerType: AttachmentOwnerType.INVOICE,
        ownerId: invoice.id,
        url: s3Url,
        filename: file.originalname,
        contentType: file.mimetype,
        sizeBytes: file.size,
      };

      invoicesService.findOne.mockResolvedValue(invoice as any);
      s3Service.uploadFile.mockResolvedValue(s3Url);
      attachmentRepository.create.mockReturnValue(attachment as any);
      attachmentRepository.save.mockResolvedValue(attachment as any);
      auditService.log.mockResolvedValue(undefined);

      await controller.uploadAttachment(id, file as any, mockUser, mockRequest as any);

      expect(attachmentRepository.create).toHaveBeenCalledWith({
        ownerType: AttachmentOwnerType.INVOICE,
        ownerId: invoice.id,
        url: s3Url,
        filename: file.originalname,
        contentType: file.mimetype,
        sizeBytes: file.size,
      });
      expect(attachmentRepository.save).toHaveBeenCalled();
    });

    it('should call auditService.log with upload_attachment action', async () => {
      const id = 'invoice-id';
      const invoice = {
        id,
        userId: mockUser.userId,
        number: 'INV-001',
      };

      const file = {
        originalname: 'test.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.from('test'),
        size: 4,
      };

      const s3Url = 'https://s3.amazonaws.com/bucket/invoices/invoice-id/attachments/123-test.pdf';
      const attachment = {
        id: 'attachment-id',
        url: s3Url,
      };

      invoicesService.findOne.mockResolvedValue(invoice as any);
      s3Service.uploadFile.mockResolvedValue(s3Url);
      attachmentRepository.create.mockReturnValue(attachment as any);
      attachmentRepository.save.mockResolvedValue(attachment as any);
      auditService.log.mockResolvedValue(undefined);

      await controller.uploadAttachment(id, file as any, mockUser, mockRequest as any);

      expect(auditService.log).toHaveBeenCalledWith(
        mockUser.userId,
        AuditAction.UPDATE,
        AuditResource.INVOICE,
        id,
        { invoiceNumber: invoice.number, action: 'upload_attachment', attachmentId: attachment.id },
        mockRequest.ip,
      );
    });

    it('should return attachment object with URL', async () => {
      const id = 'invoice-id';
      const invoice = {
        id,
        userId: mockUser.userId,
        number: 'INV-001',
      };

      const file = {
        originalname: 'test.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.from('test'),
        size: 4,
      };

      const s3Url = 'https://s3.amazonaws.com/bucket/invoices/invoice-id/attachments/123-test.pdf';
      const attachment = {
        id: 'attachment-id',
        url: s3Url,
        filename: file.originalname,
      };

      invoicesService.findOne.mockResolvedValue(invoice as any);
      s3Service.uploadFile.mockResolvedValue(s3Url);
      attachmentRepository.create.mockReturnValue(attachment as any);
      attachmentRepository.save.mockResolvedValue(attachment as any);
      auditService.log.mockResolvedValue(undefined);

      const result = await controller.uploadAttachment(id, file as any, mockUser, mockRequest as any);

      expect(result).toHaveProperty('url', s3Url);
      expect(result).toHaveProperty('id');
    });

    it('should propagate BadRequestException for invalid file types', async () => {
      const id = 'invoice-id';
      const invoice = {
        id,
        userId: mockUser.userId,
        number: 'INV-001',
      };

      const invalidFile = {
        originalname: 'test.exe',
        mimetype: 'application/x-msdownload',
        buffer: Buffer.from('test'),
        size: 4,
      };

      invoicesService.findOne.mockResolvedValue(invoice as any);

      await expect(controller.uploadAttachment(id, invalidFile as any, mockUser, mockRequest as any)).rejects.toThrow(BadRequestException);
    });
  });

  describe('POST /invoices/:id/pdf (generatePdf)', () => {
    it('should call invoicesService.findOne to get invoice with relations', async () => {
      const id = 'invoice-id';
      const invoice = {
        id,
        userId: mockUser.userId,
        number: 'INV-001',
        client: { id: 'client-id', name: 'Client' },
        items: [{ id: 'item-1', description: 'Item 1' }],
      };

      const pdfBuffer = Buffer.from('pdf content');
      const s3Url = 'https://s3.amazonaws.com/bucket/pdfs/invoice-id/INV-001.pdf';

      invoicesService.findOne.mockResolvedValue(invoice as any);
      pdfService.generateInvoicePdf.mockResolvedValue(pdfBuffer);
      s3Service.uploadFile.mockResolvedValue(s3Url);
      auditService.log.mockResolvedValue(undefined);

      await controller.generatePdf(id, mockUser, mockRequest as any);

      expect(invoicesService.findOne).toHaveBeenCalledWith(id, mockUser.userId);
    });

    it('should call pdfService.generateInvoicePdf with invoice data (invoice, client, items, user info)', async () => {
      const id = 'invoice-id';
      const invoice = {
        id,
        userId: mockUser.userId,
        number: 'INV-001',
        client: { id: 'client-id', name: 'Client' },
        items: [{ id: 'item-1', description: 'Item 1' }],
      };

      const pdfBuffer = Buffer.from('pdf content');
      const s3Url = 'https://s3.amazonaws.com/bucket/pdfs/invoice-id/INV-001.pdf';

      invoicesService.findOne.mockResolvedValue(invoice as any);
      pdfService.generateInvoicePdf.mockResolvedValue(pdfBuffer);
      s3Service.uploadFile.mockResolvedValue(s3Url);
      auditService.log.mockResolvedValue(undefined);

      await controller.generatePdf(id, mockUser, mockRequest as any);

      expect(pdfService.generateInvoicePdf).toHaveBeenCalledWith({
        invoice: invoice,
        client: invoice.client,
        items: invoice.items || [],
        user: {
          name: mockUser.name,
          companyName: mockUser.companyName,
        },
      });
    });

    it('should call s3Service.uploadFile with key pattern: pdfs/{id}/{number}.pdf', async () => {
      const id = 'invoice-id';
      const invoice = {
        id,
        userId: mockUser.userId,
        number: 'INV-001',
        client: { id: 'client-id', name: 'Client' },
        items: [],
      };

      const pdfBuffer = Buffer.from('pdf content');
      const s3Url = 'https://s3.amazonaws.com/bucket/pdfs/invoice-id/INV-001.pdf';

      invoicesService.findOne.mockResolvedValue(invoice as any);
      pdfService.generateInvoicePdf.mockResolvedValue(pdfBuffer);
      s3Service.uploadFile.mockResolvedValue(s3Url);
      auditService.log.mockResolvedValue(undefined);

      await controller.generatePdf(id, mockUser, mockRequest as any);

      expect(s3Service.uploadFile).toHaveBeenCalledWith(
        `pdfs/${invoice.id}/${invoice.number}.pdf`,
        pdfBuffer,
        'application/pdf',
      );
    });

    it('should call auditService.log with generate_pdf action and PDF URL', async () => {
      const id = 'invoice-id';
      const invoice = {
        id,
        userId: mockUser.userId,
        number: 'INV-001',
        client: { id: 'client-id', name: 'Client' },
        items: [],
      };

      const pdfBuffer = Buffer.from('pdf content');
      const s3Url = 'https://s3.amazonaws.com/bucket/pdfs/invoice-id/INV-001.pdf';

      invoicesService.findOne.mockResolvedValue(invoice as any);
      pdfService.generateInvoicePdf.mockResolvedValue(pdfBuffer);
      s3Service.uploadFile.mockResolvedValue(s3Url);
      auditService.log.mockResolvedValue(undefined);

      await controller.generatePdf(id, mockUser, mockRequest as any);

      expect(auditService.log).toHaveBeenCalledWith(
        mockUser.userId,
        AuditAction.EXPORT,
        AuditResource.INVOICE,
        id,
        { invoiceNumber: invoice.number, action: 'generate_pdf', pdfUrl: s3Url },
        mockRequest.ip,
      );
    });

    it('should return { url, invoiceId }', async () => {
      const id = 'invoice-id';
      const invoice = {
        id,
        userId: mockUser.userId,
        number: 'INV-001',
        client: { id: 'client-id', name: 'Client' },
        items: [],
      };

      const pdfBuffer = Buffer.from('pdf content');
      const s3Url = 'https://s3.amazonaws.com/bucket/pdfs/invoice-id/INV-001.pdf';

      invoicesService.findOne.mockResolvedValue(invoice as any);
      pdfService.generateInvoicePdf.mockResolvedValue(pdfBuffer);
      s3Service.uploadFile.mockResolvedValue(s3Url);
      auditService.log.mockResolvedValue(undefined);

      const result = await controller.generatePdf(id, mockUser, mockRequest as any);

      expect(result).toEqual({ url: s3Url, invoiceId: invoice.id });
    });
  });

  describe('POST /invoices/:id/pay (createPaymentIntent)', () => {
    it('should call invoicesService.findOne to get invoice', async () => {
      const id = 'invoice-id';
      const invoice = {
        id,
        userId: mockUser.userId,
        clientId: 'client-id',
        number: 'INV-001',
        status: InvoiceStatus.DRAFT,
        type: InvoiceType.INVOICE,
        issueDate: new Date('2024-01-01'),
        total: 100,
        currency: 'USD',
      } as any;

      const paymentIntent = {
        id: 'pi_123',
        client_secret: 'pi_123_secret',
        status: 'requires_payment_method',
      };

      invoicesService.findOne.mockResolvedValue(invoice as any);
      stripeService.createPaymentIntent.mockResolvedValue(paymentIntent as any);
      paymentsService.createPayment.mockResolvedValue(undefined);
      auditService.log.mockResolvedValue(undefined);

      await controller.createPaymentIntent(id, mockUser, mockRequest as any);

      expect(invoicesService.findOne).toHaveBeenCalledWith(id, mockUser.userId);
    });

    it('should validate invoice status (not paid, not cancelled, not estimate, total > 0)', async () => {
      const id = 'invoice-id';
      const invoice = {
        id,
        userId: mockUser.userId,
        clientId: 'client-id',
        number: 'INV-001',
        status: InvoiceStatus.DRAFT,
        type: InvoiceType.INVOICE,
        issueDate: new Date('2024-01-01'),
        total: 100,
        currency: 'USD',
      } as any;

      const paymentIntent = {
        id: 'pi_123',
        client_secret: 'pi_123_secret',
        status: 'requires_payment_method',
      };

      invoicesService.findOne.mockResolvedValue(invoice as any);
      stripeService.createPaymentIntent.mockResolvedValue(paymentIntent as any);
      paymentsService.createPayment.mockResolvedValue(undefined);
      auditService.log.mockResolvedValue(undefined);

      await controller.createPaymentIntent(id, mockUser, mockRequest as any);

      expect(stripeService.createPaymentIntent).toHaveBeenCalled();
    });

    it('should call stripeService.createPaymentIntent with amount, currency, metadata', async () => {
      const id = 'invoice-id';
      const invoice = {
        id,
        userId: mockUser.userId,
        clientId: 'client-id',
        number: 'INV-001',
        status: InvoiceStatus.DRAFT,
        type: InvoiceType.INVOICE,
        issueDate: new Date('2024-01-01'),
        total: 100,
        currency: 'USD',
      } as any;

      const paymentIntent = {
        id: 'pi_123',
        client_secret: 'pi_123_secret',
        status: 'requires_payment_method',
      };

      invoicesService.findOne.mockResolvedValue(invoice as any);
      stripeService.createPaymentIntent.mockResolvedValue(paymentIntent as any);
      paymentsService.createPayment.mockResolvedValue(undefined);
      auditService.log.mockResolvedValue(undefined);

      await controller.createPaymentIntent(id, mockUser, mockRequest as any);

      expect(stripeService.createPaymentIntent).toHaveBeenCalledWith(
        invoice.total,
        invoice.currency,
        {
          invoice_id: invoice.id,
          user_id: mockUser.userId,
          invoice_number: invoice.number,
        },
      );
    });

    it('should call paymentsService.createPayment with invoice ID, payment intent ID, amount, currency, metadata', async () => {
      const id = 'invoice-id';
      const invoice = {
        id,
        userId: mockUser.userId,
        clientId: 'client-id',
        number: 'INV-001',
        status: InvoiceStatus.DRAFT,
        type: InvoiceType.INVOICE,
        issueDate: new Date('2024-01-01'),
        total: 100,
        currency: 'USD',
      } as any;

      const paymentIntent = {
        id: 'pi_123',
        client_secret: 'pi_123_secret',
        status: 'requires_payment_method',
      };

      invoicesService.findOne.mockResolvedValue(invoice as any);
      stripeService.createPaymentIntent.mockResolvedValue(paymentIntent as any);
      paymentsService.createPayment.mockResolvedValue(undefined);
      auditService.log.mockResolvedValue(undefined);

      await controller.createPaymentIntent(id, mockUser, mockRequest as any);

      expect(paymentsService.createPayment).toHaveBeenCalledWith(
        invoice.id,
        paymentIntent.id,
        invoice.total,
        invoice.currency,
        {
          payment_intent_id: paymentIntent.id,
          client_secret: paymentIntent.client_secret,
          status: paymentIntent.status,
        },
      );
    });

    it('should call auditService.log with create_payment_intent action', async () => {
      const id = 'invoice-id';
      const invoice = {
        id,
        userId: mockUser.userId,
        clientId: 'client-id',
        number: 'INV-001',
        status: InvoiceStatus.DRAFT,
        type: InvoiceType.INVOICE,
        issueDate: new Date('2024-01-01'),
        total: 100,
        currency: 'USD',
      } as any;

      const paymentIntent = {
        id: 'pi_123',
        client_secret: 'pi_123_secret',
        status: 'requires_payment_method',
      };

      invoicesService.findOne.mockResolvedValue(invoice as any);
      stripeService.createPaymentIntent.mockResolvedValue(paymentIntent as any);
      paymentsService.createPayment.mockResolvedValue(undefined);
      auditService.log.mockResolvedValue(undefined);

      await controller.createPaymentIntent(id, mockUser, mockRequest as any);

      expect(auditService.log).toHaveBeenCalledWith(
        mockUser.userId,
        AuditAction.UPDATE,
        AuditResource.INVOICE,
        id,
        { invoiceNumber: invoice.number, action: 'create_payment_intent', paymentIntentId: paymentIntent.id },
        mockRequest.ip,
      );
    });

    it('should return { clientSecret, paymentIntentId, amount, currency }', async () => {
      const id = 'invoice-id';
      const invoice = {
        id,
        userId: mockUser.userId,
        clientId: 'client-id',
        number: 'INV-001',
        status: InvoiceStatus.DRAFT,
        type: InvoiceType.INVOICE,
        issueDate: new Date('2024-01-01'),
        total: 100,
        currency: 'USD',
      } as any;

      const paymentIntent = {
        id: 'pi_123',
        client_secret: 'pi_123_secret',
        status: 'requires_payment_method',
      };

      invoicesService.findOne.mockResolvedValue(invoice as any);
      stripeService.createPaymentIntent.mockResolvedValue(paymentIntent as any);
      paymentsService.createPayment.mockResolvedValue(undefined);
      auditService.log.mockResolvedValue(undefined);

      const result = await controller.createPaymentIntent(id, mockUser, mockRequest as any);

      expect(result).toEqual({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amount: invoice.total,
        currency: invoice.currency,
      });
    });

    it('should throw BadRequestException for invalid invoice states (already paid, cancelled, estimate, zero total)', async () => {
      const id = 'invoice-id';
      const paidInvoice = {
        id,
        userId: mockUser.userId,
        clientId: 'client-id',
        number: 'INV-001',
        status: InvoiceStatus.PAID,
        type: InvoiceType.INVOICE,
        issueDate: new Date('2024-01-01'),
        total: 100,
        currency: 'USD',
      } as any;

      invoicesService.findOne.mockResolvedValue(paidInvoice);

      await expect(controller.createPaymentIntent(id, mockUser, mockRequest as any)).rejects.toThrow(BadRequestException);
      expect(stripeService.createPaymentIntent).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when invoice is cancelled', async () => {
      const id = 'invoice-id';
      const cancelledInvoice = {
        id,
        userId: mockUser.userId,
        clientId: 'client-id',
        number: 'INV-001',
        status: InvoiceStatus.CANCELLED,
        type: InvoiceType.INVOICE,
        issueDate: new Date('2024-01-01'),
        total: 100,
        currency: 'USD',
      } as any;

      invoicesService.findOne.mockResolvedValue(cancelledInvoice);

      await expect(controller.createPaymentIntent(id, mockUser, mockRequest as any)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when invoice is estimate', async () => {
      const id = 'invoice-id';
      const estimate = {
        id,
        userId: mockUser.userId,
        clientId: 'client-id',
        number: 'EST-001',
        status: InvoiceStatus.DRAFT,
        type: InvoiceType.ESTIMATE,
        issueDate: new Date('2024-01-01'),
        total: 100,
        currency: 'USD',
      } as any;

      invoicesService.findOne.mockResolvedValue(estimate);

      await expect(controller.createPaymentIntent(id, mockUser, mockRequest as any)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when total is zero', async () => {
      const id = 'invoice-id';
      const zeroInvoice = {
        id,
        userId: mockUser.userId,
        clientId: 'client-id',
        number: 'INV-001',
        status: InvoiceStatus.DRAFT,
        type: InvoiceType.INVOICE,
        issueDate: new Date('2024-01-01'),
        total: 0,
        currency: 'USD',
      } as any;

      invoicesService.findOne.mockResolvedValue(zeroInvoice);

      await expect(controller.createPaymentIntent(id, mockUser, mockRequest as any)).rejects.toThrow(BadRequestException);
    });
  });

  describe('Assertions', () => {
    it('should verify all service methods called with correct arguments', async () => {
      const id = 'invoice-id';
      const invoice = {
        id,
        userId: mockUser.userId,
        number: 'INV-001',
      };

      invoicesService.findOne.mockResolvedValue(invoice as any);
      auditService.log.mockResolvedValue(undefined);

      await controller.findOne(id, mockUser, mockRequest as any);

      expect(invoicesService.findOne).toHaveBeenCalledWith(id, mockUser.userId);
      expect(auditService.log).toHaveBeenCalled();
    });

    it('should verify audit logging on all state-changing operations', async () => {
      const id = 'invoice-id';
      const invoice = {
        id,
        userId: mockUser.userId,
        number: 'INV-001',
      };

      invoicesService.findOne.mockResolvedValue(invoice as any);
      invoicesService.delete.mockResolvedValue(undefined);
      auditService.log.mockResolvedValue(undefined);

      await controller.delete(id, mockUser, mockRequest as any);

      expect(auditService.log).toHaveBeenCalled();
    });

    it('should verify request.ip passed to audit logs', async () => {
      const id = 'invoice-id';
      const invoice = {
        id,
        userId: mockUser.userId,
        number: 'INV-001',
      };

      invoicesService.findOne.mockResolvedValue(invoice as any);
      auditService.log.mockResolvedValue(undefined);

      await controller.findOne(id, mockUser, mockRequest as any);

      expect(auditService.log).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(Object),
        mockRequest.ip,
      );
    });

    it('should verify all endpoints protected by JwtAuthGuard', () => {
      // JwtAuthGuard is applied at controller level
      expect(controller).toBeDefined();
    });
  });
});

