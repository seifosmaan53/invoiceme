import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Query,
  BadRequestException,
  Req,
} from '@nestjs/common';
import { 
  ApiTags, 
  ApiOperation, 
  ApiResponse, 
  ApiBearerAuth, 
  ApiQuery,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { InvoicesService } from './invoices.service';
import { PdfService } from '../core/services/pdf.service';
import { S3Service } from '../core/services/s3.service';
import { StripeService } from '../core/services/stripe.service';
import { PaymentsService } from '../payments/payments.service';
import { AuditService } from '../core/services/audit.service';
import { EmailService } from '../core/services/email.service';
import { CsvService } from '../core/services/csv.service';
import { NotificationService } from '../core/services/notification.service';
import { InvoicesImportService } from './invoices-import.service';
import { CreateInvoiceDto, UpdateInvoiceDto } from './dto/invoice.dto';
import { InvoiceFilterDto } from './dto/invoice-filter.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiKeyOrJwtGuard } from '../auth/guards/api-key-or-jwt.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { InvoiceType, InvoiceStatus, Invoice } from '../entities/invoice.entity';
import { InvoicesPaginatedResponseDto } from './dto/invoice-response.dto';
import { AttachmentOwnerType } from '../entities/attachment.entity';
import { AuditAction, AuditResource } from '../entities/audit-log.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Attachment } from '../entities/attachment.entity';
import { PaginationDto } from '../core/dto/pagination.dto';
import { sanitizeFilename } from '../core/utils/sanitize.util';
import { Res } from '@nestjs/common';
import { Response } from 'express';

@ApiTags('Invoices')
@ApiBearerAuth('JWT-auth')
@Controller('v1/invoices')
@UseGuards(ApiKeyOrJwtGuard, PermissionGuard)
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly pdfService: PdfService,
    private readonly s3Service: S3Service,
    private readonly stripeService: StripeService,
    private readonly paymentsService: PaymentsService,
    private readonly auditService: AuditService,
    private readonly csvService: CsvService,
    private readonly notificationService: NotificationService,
    private readonly emailService: EmailService,
    private readonly invoicesImportService: InvoicesImportService,
    @InjectRepository(Attachment)
    private attachmentRepository: Repository<Attachment>,
  ) {}

  @Get('stats')
  @RequirePermission('read:dashboard')
  @ApiOperation({ summary: 'Get dashboard statistics', description: 'Returns comprehensive dashboard statistics including unpaid, overdue, and monthly totals' })
  @ApiOkResponse({
    description: 'Dashboard statistics',
    schema: {
      type: 'object',
      properties: {
        totalInvoices: { type: 'number', example: 10 },
        totalUnpaid: { type: 'number', example: 3 },
        totalPaid: { type: 'number', example: 5 },
        totalOverdue: { type: 'number', example: 2 },
        totalRevenue: { type: 'number', example: 5000.00, description: 'Total revenue from paid invoices' },
        monthlyRevenue: { type: 'number', example: 1500.00, description: 'Total amount of all invoices created this month' },
        monthlyPaidRevenue: { type: 'number', example: 1200.00, description: 'Total revenue from paid invoices this month' },
      },
    },
  })
  async getStats(@CurrentUser() user: any) {
    return this.invoicesService.getDashboardStats(user.userId);
  }

  @Get()
  @RequirePermission('read:invoices')
  @ApiOperation({ summary: 'Get all invoices (paginated)' })
  @ApiOkResponse({
    description: 'List invoices with pagination and optional search/filter',
    type: InvoicesPaginatedResponseDto,
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: 'Items per page (default: 20, max: 100)' })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Search by invoice number, client name, or client email',
    example: 'INV-2025',
  })
  @ApiQuery({ 
    name: 'type', 
    required: false, 
    enum: InvoiceType, 
    description: 'Filter by invoice type (invoice or estimate)' 
  })
  @ApiQuery({ 
    name: 'status', 
    required: false, 
    enum: InvoiceStatus, 
    description: 'Filter by invoice status' 
  })
  @ApiQuery({
    name: 'dateFrom',
    required: false,
    type: String,
    description: 'Filter invoices issued on or after this date (ISO 8601 format)',
    example: '2025-01-01',
  })
  @ApiQuery({
    name: 'dateTo',
    required: false,
    type: String,
    description: 'Filter invoices issued on or before this date (ISO 8601 format)',
    example: '2025-12-31',
  })
  @ApiQuery({
    name: 'amountMin',
    required: false,
    type: Number,
    description: 'Filter invoices with total amount >= this value',
    example: 100.0,
  })
  @ApiQuery({
    name: 'amountMax',
    required: false,
    type: Number,
    description: 'Filter invoices with total amount <= this value',
    example: 1000.0,
  })
  async findAll(
    @Query() filters: InvoiceFilterDto,
    @CurrentUser() user: any,
  ) {
    return this.invoicesService.findAll(
      user.userId,
      filters.type,
      filters,
      filters.search,
      filters.status,
      filters.dateFrom,
      filters.dateTo,
      filters.amountMin,
      filters.amountMax,
    );
  }

  @Get(':id')
  @RequirePermission('read:invoices')
  @ApiOperation({ summary: 'Get a single invoice by ID' })
  @ApiOkResponse({
    description: 'Get a single invoice by ID',
    type: Invoice,
  })
  @ApiNotFoundResponse({ description: 'Invoice not found' })
  @ApiForbiddenResponse({ description: 'Access denied' })
  async findOne(@Param('id') id: string, @CurrentUser() user: any, @Req() req: any) {
    const invoice = await this.invoicesService.findOne(id, user.userId);
    await this.auditService.log(
      user.userId,
      AuditAction.VIEW,
      AuditResource.INVOICE,
      id,
      { invoiceNumber: invoice.number },
      req.ip,
    );
    return invoice;
  }

  @Post()
  @RequirePermission('write:invoices')
  @ApiOperation({ summary: 'Create a new invoice or estimate' })
  @ApiCreatedResponse({
    description: 'Create a new invoice',
    type: Invoice,
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiNotFoundResponse({ description: 'Client not found' })
  async create(@Body() createInvoiceDto: CreateInvoiceDto, @CurrentUser() user: any, @Req() req: any) {
    const invoice = await this.invoicesService.create(createInvoiceDto, user.userId);
    await this.auditService.log(
      user.userId,
      AuditAction.CREATE,
      AuditResource.INVOICE,
      invoice.id,
      { invoiceNumber: invoice.number, type: invoice.type },
      req.ip,
    );
    return invoice;
  }

  @Patch(':id')
  @RequirePermission('write:invoices')
  @ApiOperation({ summary: 'Update an existing invoice' })
  @ApiOkResponse({
    description: 'Update an existing invoice',
    type: Invoice,
  })
  @ApiNotFoundResponse({ description: 'Invoice not found' })
  @ApiForbiddenResponse({ description: 'Access denied' })
  async update(
    @Param('id') id: string,
    @Body() updateInvoiceDto: UpdateInvoiceDto,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    const invoice = await this.invoicesService.update(id, updateInvoiceDto, user.userId);
    await this.auditService.log(
      user.userId,
      AuditAction.UPDATE,
      AuditResource.INVOICE,
      id,
      { invoiceNumber: invoice.number, changes: Object.keys(updateInvoiceDto) },
      req.ip,
    );
    return invoice;
  }

  @Delete(':id')
  @RequirePermission('delete:invoices')
  @ApiOperation({ summary: 'Archive (soft-delete) an invoice' })
  @ApiNoContentResponse({
    description: 'Archive (soft-delete) an invoice',
  })
  @ApiNotFoundResponse({ description: 'Invoice not found' })
  @ApiForbiddenResponse({ description: 'Access denied' })
  async delete(@Param('id') id: string, @CurrentUser() user: any, @Req() req: any) {
    const invoice = await this.invoicesService.findOne(id, user.userId);
    await this.invoicesService.archive(id, user.userId);
    await this.auditService.log(
      user.userId,
      AuditAction.DELETE,
      AuditResource.INVOICE,
      id,
      { invoiceNumber: invoice.number },
      req.ip,
    );
  }

  @Post(':id/duplicate')
  @ApiOperation({ summary: 'Duplicate an invoice or estimate' })
  @ApiCreatedResponse({
    description: 'Invoice duplicated successfully',
    type: Invoice,
  })
  @ApiNotFoundResponse({ description: 'Invoice not found' })
  @ApiForbiddenResponse({ description: 'Access denied' })
  async duplicate(@Param('id') id: string, @CurrentUser() user: any, @Req() req: any) {
    const originalInvoice = await this.invoicesService.findOne(id, user.userId);
    const duplicatedInvoice = await this.invoicesService.duplicateInvoice(id, user.userId);
    await this.auditService.log(
      user.userId,
      AuditAction.CREATE,
      AuditResource.INVOICE,
      duplicatedInvoice.id,
      { action: 'duplicate', originalInvoiceId: id, originalInvoiceNumber: originalInvoice.number },
      req.ip,
    );
    return duplicatedInvoice;
  }

  @Post(':id/convert')
  @ApiOperation({ summary: 'Convert an estimate to an invoice' })
  @ApiResponse({ status: 201, description: 'Estimate converted to invoice successfully' })
  @ApiResponse({ status: 400, description: 'Only estimates can be converted' })
  @ApiResponse({ status: 404, description: 'Estimate not found' })
  async convert(@Param('id') id: string, @CurrentUser() user: any, @Req() req: any) {
    const estimate = await this.invoicesService.findOne(id, user.userId);
    const invoice = await this.invoicesService.convertEstimateToInvoice(id, user.userId);
    await this.auditService.log(
      user.userId,
      AuditAction.UPDATE,
      AuditResource.INVOICE,
      id,
      { action: 'convert_estimate', newInvoiceId: invoice.id },
      req.ip,
    );
    return invoice;
  }

  @Post(':id/send')
  @ApiOperation({ summary: 'Send an invoice via email' })
  @ApiResponse({ status: 200, description: 'Invoice sent successfully' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  async send(@Param('id') id: string, @CurrentUser() user: any, @Req() req: any) {
    const invoice = await this.invoicesService.findOne(id, user.userId);

    // Validate invoice can be sent
    if (!invoice.client?.email) {
      throw new BadRequestException('Client email is required to send invoice');
    }

    // Generate PDF first (if not already generated)
    let pdfUrl: string | undefined;
    try {
      const userInfo = { name: user.name, companyName: user.companyName };
      const invoiceData = {
        invoice: invoice,
        client: invoice.client,
        items: invoice.items || [],
        user: userInfo,
      };
      const pdfBuffer = await this.pdfService.generateInvoicePdf(invoiceData);
      const key = `pdfs/${invoice.id}/${invoice.number}.pdf`;
      pdfUrl = await this.s3Service.uploadFile(key, pdfBuffer, 'application/pdf');
    } catch (error) {
      console.error('Failed to generate PDF for email:', error);
      // Continue without PDF
    }

    // Send invoice email
    // Normalize clientName and companyName with defaults
    const clientName = invoice.client.name || invoice.client.email || 'Client';
    const companyName = user.companyName || 'InvoiceMe';

    try {
      await this.emailService.sendInvoiceEmail(
        invoice.client.email,
        {
          invoiceNumber: invoice.number,
          total: invoice.total,
          currency: invoice.currency,
          clientName,
          companyName,
          dueDate: invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : undefined,
        },
        pdfUrl,
      );
    } catch (error) {
      console.error('Failed to send invoice email:', error);
      throw new BadRequestException('Failed to send invoice email');
    }

    // Send notification to user
    try {
      await this.notificationService.notifyInvoiceSent({
        userEmail: user.email,
        userName: user.name,
        invoiceNumber: invoice.number,
        invoiceId: invoice.id,
        clientName: invoice.client.name,
        amount: parseFloat(invoice.total.toString()),
        currency: invoice.currency,
      });
    } catch (error) {
      console.error('Failed to send invoice sent notification:', error);
      // Don't fail the request if notification fails
    }

    await this.auditService.log(
      user.userId,
      AuditAction.EXPORT,
      AuditResource.INVOICE,
      id,
      { invoiceNumber: invoice.number, action: 'send', pdfUrl },
      req.ip,
    );

    return { message: 'Invoice sent successfully', invoiceId: invoice.id, pdfUrl };
  }

  @Post(':id/attachments')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB max file size
      },
      fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf', 'image/jpg'];
        if (allowedTypes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Invalid file type. Allowed types: JPEG, PNG, GIF, PDF'), false);
        }
      },
    }),
  )
  @ApiOperation({ summary: 'Upload an attachment to an invoice' })
  @ApiResponse({ status: 201, description: 'Attachment uploaded successfully' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  @ApiResponse({ status: 400, description: 'Invalid file or file too large' })
  async uploadAttachment(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    const invoice = await this.invoicesService.findOne(id, user.userId);

    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    // Security: Validate file size (10MB max)
    const maxFileSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxFileSize) {
      throw new BadRequestException('File size exceeds maximum allowed size of 10MB');
    }

    // Security: Validate file type (double check)
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf', 'image/jpg'];
    if (!allowedTypes.includes(file.mimetype)) {
      throw new BadRequestException('Invalid file type. Allowed types: JPEG, PNG, GIF, PDF');
    }

    // Security: Sanitize filename to prevent path traversal
    const sanitizedFilename = sanitizeFilename(file.originalname);

    // Upload to S3 (private, not public for security)
    const timestamp = Date.now();
    const key = `invoices/${invoice.id}/attachments/${timestamp}-${sanitizedFilename}`;
    const s3Key = await this.s3Service.uploadFile(key, file.buffer, file.mimetype, false);

    // Generate signed URL for secure access (expires in 7 days)
    const signedUrl = this.s3Service.getSignedUrl(s3Key, 7 * 24 * 60 * 60);

    // Save attachment record in database (store S3 key, not URL)
    const attachment = this.attachmentRepository.create({
      ownerType: AttachmentOwnerType.INVOICE,
      ownerId: invoice.id,
      url: signedUrl, // Store signed URL (will expire, but allows immediate access)
      filename: sanitizedFilename, // Store sanitized filename
      contentType: file.mimetype,
      sizeBytes: file.size,
    });

    await this.attachmentRepository.save(attachment);

    await this.auditService.log(
      user.userId,
      AuditAction.UPDATE,
      AuditResource.INVOICE,
      id,
      { invoiceNumber: invoice.number, action: 'upload_attachment', attachmentId: attachment.id },
      req.ip,
    );

    return attachment;
  }

  @Get(':id/attachments')
  @ApiOperation({ summary: 'Get all attachments for an invoice' })
  @ApiResponse({ status: 200, description: 'List of attachments retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  async getAttachments(@Param('id') id: string, @CurrentUser() user: any) {
    // Verify invoice exists and belongs to user
    const invoice = await this.invoicesService.findOne(id, user.userId);

    // Get all attachments for this invoice
    const attachments = await this.attachmentRepository.find({
      where: {
        ownerType: AttachmentOwnerType.INVOICE,
        ownerId: invoice.id,
      },
      order: {
        createdAt: 'DESC',
      },
    });

    return attachments;
  }

  @Post(':id/pdf')
  @ApiOperation({ summary: 'Generate PDF for an invoice and upload to S3' })
  @ApiResponse({ status: 201, description: 'PDF generated and uploaded successfully' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  async generatePdf(@Param('id') id: string, @CurrentUser() user: any, @Req() req: any) {
    const invoice = await this.invoicesService.findOne(id, user.userId);

    // Get user info for PDF
    const userInfo = {
      name: user.name,
      companyName: user.companyName,
    };

    const invoiceData = {
      invoice: invoice,
      client: invoice.client,
      items: invoice.items || [],
      user: userInfo,
    };

    const pdfBuffer = await this.pdfService.generateInvoicePdf(invoiceData);

    const key = `pdfs/${invoice.id}/${invoice.number}.pdf`;
    const url = await this.s3Service.uploadFile(key, pdfBuffer, 'application/pdf');

    await this.auditService.log(
      user.userId,
      AuditAction.EXPORT,
      AuditResource.INVOICE,
      id,
      { invoiceNumber: invoice.number, action: 'generate_pdf', pdfUrl: url },
      req.ip,
    );

    return { url, invoiceId: invoice.id };
  }

  @Post(':id/pay')
  @ApiOperation({ summary: 'Create Stripe payment intent for an invoice' })
  @ApiResponse({ status: 200, description: 'Payment intent created successfully' })
  @ApiResponse({ status: 400, description: 'Invoice cannot be paid (already paid or invalid status)' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  async createPaymentIntent(@Param('id') id: string, @CurrentUser() user: any, @Req() req: any) {
    const invoice = await this.invoicesService.findOne(id, user.userId);

    // Validate invoice can be paid
    if (invoice.status === 'paid') {
      throw new BadRequestException('Invoice is already paid');
    }

    if (invoice.status === 'cancelled') {
      throw new BadRequestException('Cannot create payment for cancelled invoice');
    }

    if (invoice.type === 'estimate') {
      throw new BadRequestException('Cannot create payment for estimate. Convert to invoice first.');
    }

    if (invoice.total <= 0) {
      throw new BadRequestException('Invoice total must be greater than zero');
    }

    // Create Stripe PaymentIntent
    const paymentIntent = await this.stripeService.createPaymentIntent(
      invoice.total,
      invoice.currency,
      {
        invoice_id: invoice.id,
        user_id: user.userId,
        invoice_number: invoice.number,
      },
    );

    // Create payment record in database
    await this.paymentsService.createPayment(
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

    await this.auditService.log(
      user.userId,
      AuditAction.UPDATE,
      AuditResource.INVOICE,
      id,
      { invoiceNumber: invoice.number, action: 'create_payment_intent', paymentIntentId: paymentIntent.id },
      req.ip,
    );

    return {
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: invoice.total,
      currency: invoice.currency,
    };
  }

  @Get('export/csv')
  @ApiOperation({ summary: 'Export all invoices as CSV' })
  @ApiOkResponse({
    description: 'CSV file with all invoices',
    content: {
      'text/csv': {
        schema: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  async exportCsv(@CurrentUser() user: any, @Res() res: Response, @Req() req: any) {
    const invoices = await this.invoicesService.findAllForExport(user.userId);
    
    // Transform invoices to CSV format
    const csvData = invoices.map((invoice) => ({
      number: invoice.number,
      type: invoice.type,
      status: invoice.status,
      clientName: invoice.client?.name || '',
      clientEmail: invoice.client?.email || '',
      issueDate: invoice.issueDate.toISOString().split('T')[0],
      dueDate: invoice.dueDate ? invoice.dueDate.toISOString().split('T')[0] : '',
      currency: invoice.currency,
      subtotal: invoice.subtotal.toString(),
      taxTotal: invoice.taxTotal.toString(),
      discountTotal: invoice.discountTotal.toString(),
      total: invoice.total.toString(),
      notes: invoice.notes || '',
    }));

    const csv = await this.csvService.toCsv(csvData, this.csvService.getInvoiceHeaders());

    await this.auditService.log(
      user.userId,
      AuditAction.EXPORT,
      AuditResource.INVOICE,
      'all',
      { format: 'csv', count: invoices.length },
      req.ip,
    );

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="invoices-${Date.now()}.csv"`);
    res.send(csv);
  }

  @Post('import/csv')
  @ApiOperation({ summary: 'Import invoices from CSV file' })
  @ApiCreatedResponse({
    description: 'Invoices imported successfully',
    schema: {
      type: 'object',
      properties: {
        imported: { type: 'number', example: 10 },
        failed: { type: 'number', example: 2 },
        errors: { type: 'array', items: { type: 'string' } },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async importCsv(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const result = await this.invoicesImportService.importFromCsv(file.buffer, user.userId);

    await this.auditService.log(
      user.userId,
      AuditAction.CREATE,
      AuditResource.INVOICE,
      'bulk',
      { format: 'csv', imported: result.imported, failed: result.failed },
      req.ip,
    );

    return result;
  }

  @Post('bulk-archive')
  @ApiOperation({ summary: 'Bulk archive invoices' })
  @ApiOkResponse({
    description: 'Invoices archived successfully',
    schema: {
      type: 'object',
      properties: {
        archived: { type: 'number', example: 5 },
      },
    },
  })
  async bulkArchive(
    @Body() body: { ids: string[] },
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    let archived = 0;
    for (const id of body.ids) {
      try {
        await this.invoicesService.archive(id, user.userId);
        archived++;
      } catch (error) {
        // Continue with other IDs
      }
    }

    await this.auditService.log(
      user.userId,
      AuditAction.DELETE,
      AuditResource.INVOICE,
      'bulk',
      { count: archived },
      req.ip,
    );

    return { archived };
  }
}
