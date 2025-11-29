import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Invoice, InvoiceType, InvoiceStatus } from '../entities/invoice.entity';
import { InvoiceItem } from '../entities/invoice-item.entity';
import { Client } from '../entities/client.entity';
import { User } from '../entities/user.entity';
import { Payment, PaymentStatus } from '../entities/payment.entity';
import { CreateInvoiceDto, UpdateInvoiceDto } from './dto/invoice.dto';
import { PaginatedResponse, PaginationDto } from '../core/dto/pagination.dto';
import { NotificationService } from '../core/services/notification.service';
import { InvoiceNumberFormatterService } from '../core/services/invoice-number-formatter.service';

@Injectable()
export class InvoicesService {
  constructor(
    @InjectRepository(Invoice)
    private invoiceRepository: Repository<Invoice>,
    @InjectRepository(InvoiceItem)
    private invoiceItemRepository: Repository<InvoiceItem>,
    @InjectRepository(Client)
    private clientRepository: Repository<Client>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Payment)
    private paymentRepository: Repository<Payment>,
    private dataSource: DataSource,
    private notificationService: NotificationService,
    private invoiceNumberFormatter: InvoiceNumberFormatterService,
  ) {}

  async findAll(
    userId: string, 
    type?: InvoiceType, 
    pagination?: PaginationDto, 
    search?: string,
    status?: InvoiceStatus,
    dateFrom?: string,
    dateTo?: string,
    amountMin?: number,
    amountMax?: number,
  ): Promise<PaginatedResponse<Invoice>> {
    const page = pagination?.page || 1;
    const limit = Math.min(pagination?.limit || 20, 100); // Cap at 100 for performance
    const skip = (page - 1) * limit;
    const searchTerm = (search || pagination?.search || '').trim().toLowerCase();

    // Always load client relation for list view to display client names
    const queryBuilder = this.invoiceRepository.createQueryBuilder('invoice')
      .leftJoinAndSelect('invoice.client', 'client')
      .where('invoice.userId = :userId', { userId })
      .andWhere('invoice.deletedAt IS NULL');

    // Only load items if explicitly needed (not for list view)
    // Items are loaded separately when viewing invoice details

    if (type) {
      queryBuilder.andWhere('invoice.type = :type', { type });
    }

    if (status) {
      queryBuilder.andWhere('invoice.status = :status', { status });
    }

    if (dateFrom) {
      queryBuilder.andWhere('invoice.issueDate >= :dateFrom', { dateFrom });
    }

    if (dateTo) {
      queryBuilder.andWhere('invoice.issueDate <= :dateTo', { dateTo });
    }

    if (amountMin !== undefined && amountMin !== null) {
      queryBuilder.andWhere('invoice.total >= :amountMin', { amountMin });
    }

    if (amountMax !== undefined && amountMax !== null) {
      queryBuilder.andWhere('invoice.total <= :amountMax', { amountMax });
    }

    if (searchTerm) {
      // Client is always joined, so search in both invoice and client fields
      queryBuilder.andWhere(
        '(LOWER(invoice.number) LIKE :search OR LOWER(client.name) LIKE :search OR LOWER(client.email) LIKE :search OR CAST(invoice.total AS TEXT) LIKE :search)',
        { search: `%${searchTerm.toLowerCase()}%` }
      );
    }

    // Optimize ordering: Use indexed column
    queryBuilder.orderBy('invoice.issueDate', 'DESC')
      .addOrderBy('invoice.createdAt', 'DESC') // Secondary sort for consistency
      .skip(skip)
      .take(limit);

    // Use getManyAndCount with optimized query
    const [invoices, total] = await queryBuilder.getManyAndCount();

    return {
      data: invoices,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Calculate and update invoice status based on payments
   */
  private async calculateInvoiceStatus(invoice: Invoice): Promise<void> {
    // Skip if already paid or cancelled
    if (invoice.status === InvoiceStatus.PAID || invoice.status === InvoiceStatus.CANCELLED) {
      return;
    }

    // Get all completed payments for this invoice
    const payments = await this.paymentRepository.find({
      where: {
        invoiceId: invoice.id,
        status: PaymentStatus.COMPLETED,
      },
    });

    // Calculate total paid amount
    const totalPaid = payments.reduce((sum, payment) => {
      return sum + parseFloat(payment.amount.toString());
    }, 0);

    // Update status if fully paid
    if (totalPaid >= parseFloat(invoice.total.toString())) {
      invoice.status = InvoiceStatus.PAID;
      await this.invoiceRepository.save(invoice);

      // Send notification since status changed to PAID
      try {
        const user = await this.userRepository.findOne({ where: { id: invoice.userId } });
        if (user) {
          const invoiceWithClient = await this.invoiceRepository.findOne({
            where: { id: invoice.id },
            relations: ['client'],
          });
          if (invoiceWithClient?.client) {
            await this.notificationService.notifyInvoicePaid({
              userEmail: user.email,
              userName: user.name,
              invoiceNumber: invoiceWithClient.number,
              invoiceId: invoiceWithClient.id,
              clientName: invoiceWithClient.client.name,
              amount: parseFloat(invoiceWithClient.total.toString()),
              currency: invoiceWithClient.currency,
            });
          }
        }
      } catch (error) {
        console.error('Failed to send invoice paid notification:', error);
        // Don't fail if notification fails
      }
    }
  }

  async findOne(id: string, userId: string): Promise<Invoice> {
    const invoice = await this.invoiceRepository.findOne({
      where: { id, deletedAt: null },
      relations: ['client', 'items'],
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    // Role check: only owner can view invoices
    if (invoice.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    // Automatically calculate and update status based on payments
    await this.calculateInvoiceStatus(invoice);

    // Reload invoice to get updated status
    return this.invoiceRepository.findOne({
      where: { id, deletedAt: null },
      relations: ['client', 'items'],
    }) as Promise<Invoice>;
  }

  async create(createInvoiceDto: CreateInvoiceDto, userId: string): Promise<Invoice> {
    // Verify client belongs to user
    const client = await this.clientRepository.findOne({
      where: { id: createInvoiceDto.clientId, userId, deletedAt: null },
    });

    if (!client) {
      throw new NotFoundException('Client not found');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Generate invoice number
      const issueDate = new Date(createInvoiceDto.issueDate);
      const invoiceNumber = await this.generateInvoiceNumber(userId, createInvoiceDto.type || InvoiceType.INVOICE, issueDate);

      // Calculate totals
      const totals = this.calculateTotals(createInvoiceDto.items);

      // Create invoice
      // Use provided status or default to SENT (ready to send to client)
      // If you prefer DRAFT (editable before sending), change InvoiceStatus.DRAFT
      const invoice = this.invoiceRepository.create({
        userId,
        clientId: createInvoiceDto.clientId,
        type: createInvoiceDto.type || InvoiceType.INVOICE,
        number: invoiceNumber,
        status: createInvoiceDto.status || InvoiceStatus.SENT,
        issueDate: new Date(createInvoiceDto.issueDate),
        dueDate: createInvoiceDto.dueDate ? new Date(createInvoiceDto.dueDate) : null,
        currency: createInvoiceDto.currency || 'USD',
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        discountTotal: totals.discountTotal,
        total: totals.total,
        notes: createInvoiceDto.notes,
        metadataJson: createInvoiceDto.metadataJson,
      });

      const savedInvoice = await queryRunner.manager.save(invoice);

      // Create invoice items
      const items = createInvoiceDto.items.map((item) => {
        const lineTotal = this.calculateLineTotal(item);
        return this.invoiceItemRepository.create({
          invoiceId: savedInvoice.id,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          taxRate: item.taxRate || 0,
          discountRate: item.discountRate || 0,
          lineTotal,
        });
      });

      await queryRunner.manager.save(items);

      await queryRunner.commitTransaction();

      return this.findOne(savedInvoice.id, userId);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async update(id: string, updateInvoiceDto: UpdateInvoiceDto, userId: string): Promise<Invoice> {
    const invoice = await this.findOne(id, userId);

    if (updateInvoiceDto.clientId) {
      const client = await this.clientRepository.findOne({
        where: { id: updateInvoiceDto.clientId, userId, deletedAt: null },
      });
      if (!client) {
        throw new NotFoundException('Client not found');
      }
      invoice.clientId = updateInvoiceDto.clientId;
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      if (updateInvoiceDto.items) {
        // Delete existing items
        await queryRunner.manager.delete(InvoiceItem, { invoiceId: id });

        // Create new items
        const items = updateInvoiceDto.items.map((item) => {
          const lineTotal = this.calculateLineTotal(item);
          return this.invoiceItemRepository.create({
            invoiceId: id,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            taxRate: item.taxRate || 0,
            discountRate: item.discountRate || 0,
            lineTotal,
          });
        });

        await queryRunner.manager.save(items);

        // Recalculate totals
        const totals = this.calculateTotals(updateInvoiceDto.items);
        invoice.subtotal = totals.subtotal;
        invoice.taxTotal = totals.taxTotal;
        invoice.discountTotal = totals.discountTotal;
        invoice.total = totals.total;
      }

      if (updateInvoiceDto.status) {
        const oldStatus = invoice.status;
        invoice.status = updateInvoiceDto.status;
        
        // Send notification if status changed to PAID
        if (updateInvoiceDto.status === InvoiceStatus.PAID && oldStatus !== InvoiceStatus.PAID) {
          try {
            const user = await this.userRepository.findOne({ where: { id: userId } });
            if (user) {
              const invoiceWithClient = await this.findOne(id, userId);
              if (invoiceWithClient.client) {
                await this.notificationService.notifyInvoicePaid({
                  userEmail: user.email,
                  userName: user.name,
                  invoiceNumber: invoiceWithClient.number,
                  invoiceId: invoiceWithClient.id,
                  clientName: invoiceWithClient.client.name,
                  amount: parseFloat(invoiceWithClient.total.toString()),
                  currency: invoiceWithClient.currency,
                });
              }
            }
          } catch (error) {
            console.error('Failed to send invoice paid notification:', error);
            // Don't fail the update if notification fails
          }
        }
      }
      if (updateInvoiceDto.issueDate) {
        invoice.issueDate = new Date(updateInvoiceDto.issueDate);
      }
      if (updateInvoiceDto.dueDate) {
        invoice.dueDate = new Date(updateInvoiceDto.dueDate);
      }
      if (updateInvoiceDto.currency) {
        invoice.currency = updateInvoiceDto.currency;
      }
      if (updateInvoiceDto.notes !== undefined) {
        invoice.notes = updateInvoiceDto.notes;
      }
      if (updateInvoiceDto.metadataJson !== undefined) {
        invoice.metadataJson = updateInvoiceDto.metadataJson;
      }

      await queryRunner.manager.save(invoice);
      await queryRunner.commitTransaction();

      return this.findOne(id, userId);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async archive(id: string, userId: string): Promise<void> {
    const invoice = await this.findOne(id, userId);
    invoice.deletedAt = new Date();
    await this.invoiceRepository.save(invoice);
  }

  async duplicateInvoice(id: string, userId: string): Promise<Invoice> {
    const originalInvoice = await this.findOne(id, userId);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Generate new invoice number (same type as original)
      // Duplicates are created with today's date
      const invoiceNumber = await this.generateInvoiceNumber(userId, originalInvoice.type, new Date());

      // Create new invoice (clone of original)
      const invoice = this.invoiceRepository.create({
        userId: originalInvoice.userId,
        clientId: originalInvoice.clientId,
        type: originalInvoice.type,
        number: invoiceNumber,
        status: InvoiceStatus.SENT, // Start as sent (ready to send)
        issueDate: new Date(), // Set to today
        dueDate: originalInvoice.dueDate ? new Date(originalInvoice.dueDate) : null,
        currency: originalInvoice.currency,
        subtotal: originalInvoice.subtotal,
        taxTotal: originalInvoice.taxTotal,
        discountTotal: originalInvoice.discountTotal,
        total: originalInvoice.total,
        notes: originalInvoice.notes,
        metadataJson: originalInvoice.metadataJson,
      });

      const savedInvoice = await queryRunner.manager.save(invoice);

      // Clone all items from original to new invoice
      if (originalInvoice.items && originalInvoice.items.length > 0) {
        const invoiceItems = originalInvoice.items.map((item) => {
          return this.invoiceItemRepository.create({
            invoiceId: savedInvoice.id,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            taxRate: item.taxRate,
            discountRate: item.discountRate,
            lineTotal: item.lineTotal,
          });
        });

        await queryRunner.manager.save(invoiceItems);
      }

      await queryRunner.commitTransaction();

      // Return the new invoice with relations
      return this.findOne(savedInvoice.id, userId);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async convertEstimateToInvoice(id: string, userId: string): Promise<Invoice> {
    const estimate = await this.findOne(id, userId);

    if (estimate.type !== InvoiceType.ESTIMATE) {
      throw new BadRequestException('Only estimates can be converted to invoices');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Generate new invoice number
      const invoiceNumber = await this.generateInvoiceNumber(userId, InvoiceType.INVOICE, estimate.issueDate);

      // Create new invoice (clone of estimate)
      const invoice = this.invoiceRepository.create({
        userId: estimate.userId,
        clientId: estimate.clientId,
        type: InvoiceType.INVOICE,
        number: invoiceNumber,
        status: InvoiceStatus.SENT, // Start as sent (ready to send)
        issueDate: estimate.issueDate,
        dueDate: estimate.dueDate,
        currency: estimate.currency,
        subtotal: estimate.subtotal,
        taxTotal: estimate.taxTotal,
        discountTotal: estimate.discountTotal,
        total: estimate.total,
        notes: estimate.notes,
        metadataJson: estimate.metadataJson,
      });

      const savedInvoice = await queryRunner.manager.save(invoice);

      // Clone all items from estimate to new invoice
      if (estimate.items && estimate.items.length > 0) {
        const invoiceItems = estimate.items.map((item) => {
          return this.invoiceItemRepository.create({
            invoiceId: savedInvoice.id,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            taxRate: item.taxRate,
            discountRate: item.discountRate,
            lineTotal: item.lineTotal,
          });
        });

        await queryRunner.manager.save(invoiceItems);
      }

      await queryRunner.commitTransaction();

      // Return the new invoice with relations
      return this.findOne(savedInvoice.id, userId);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private async generateInvoiceNumber(userId: string, type: InvoiceType, issueDate?: Date): Promise<string> {
    // Get user's invoice number format preference
    const user = await this.userRepository.findOne({ where: { id: userId } });
    const format = user?.invoiceNumberFormat;

    // Find the last invoice of this type for this user to determine sequence
    const lastInvoice = await this.invoiceRepository.findOne({
      where: { userId, type },
      order: { createdAt: 'DESC' },
    });

    // Determine next sequence number
    let sequence = 1;
    if (lastInvoice && lastInvoice.number) {
      // Try to extract sequence from last invoice number
      const extractedSequence = this.invoiceNumberFormatter.extractSequence(
        lastInvoice.number,
        format,
        type,
      );
      
      if (extractedSequence !== null) {
        // Check if it's from the same year/month (depending on format)
        const date = issueDate || new Date();
        const year = date.getFullYear();
        // Convert lastInvoice.issueDate to Date if it's a string
        let lastYear = year;
        if (lastInvoice.issueDate) {
          const lastDate = lastInvoice.issueDate instanceof Date 
            ? lastInvoice.issueDate 
            : new Date(lastInvoice.issueDate);
          if (!isNaN(lastDate.getTime())) {
            lastYear = lastDate.getFullYear();
          }
        }
        
        // If same year, increment sequence; otherwise start at 1
        if (lastYear === year) {
          sequence = extractedSequence + 1;
        }
      }
    }

    // Generate formatted invoice number
    return this.invoiceNumberFormatter.format(format, type, sequence, issueDate);
  }

  private calculateLineTotal(item: { quantity: number; unitPrice: number; taxRate?: number; discountRate?: number }): number {
    let lineTotal = item.quantity * item.unitPrice;

    if (item.discountRate && item.discountRate > 0) {
      lineTotal -= (lineTotal * item.discountRate) / 100;
    }

    if (item.taxRate && item.taxRate > 0) {
      lineTotal += (lineTotal * item.taxRate) / 100;
    }

    return Math.round(lineTotal * 100) / 100;
  }

  private calculateTotals(items: Array<{ quantity: number; unitPrice: number; taxRate?: number; discountRate?: number }>): {
    subtotal: number;
    taxTotal: number;
    discountTotal: number;
    total: number;
  } {
    let subtotal = 0;
    let taxTotal = 0;
    let discountTotal = 0;

    items.forEach((item) => {
      const itemSubtotal = item.quantity * item.unitPrice;
      subtotal += itemSubtotal;

      if (item.discountRate && item.discountRate > 0) {
        discountTotal += (itemSubtotal * item.discountRate) / 100;
      }

      const afterDiscount = itemSubtotal - (item.discountRate ? (itemSubtotal * item.discountRate) / 100 : 0);
      if (item.taxRate && item.taxRate > 0) {
        taxTotal += (afterDiscount * item.taxRate) / 100;
      }
    });

    const total = subtotal - discountTotal + taxTotal;

    return {
      subtotal: Math.round(subtotal * 100) / 100,
      taxTotal: Math.round(taxTotal * 100) / 100,
      discountTotal: Math.round(discountTotal * 100) / 100,
      total: Math.round(total * 100) / 100,
    };
  }

  /**
   * Get all invoices for export (no pagination)
   */
  async findAllForExport(userId: string): Promise<Invoice[]> {
    return this.invoiceRepository.find({
      where: { userId, deletedAt: null },
      relations: ['client'],
      order: { issueDate: 'DESC' },
    });
  }

  /**
   * Get dashboard statistics for a user
   */
  async getDashboardStats(userId: string): Promise<{
    totalInvoices: number;
    totalUnpaid: number;
    totalPaid: number;
    totalOverdue: number;
    totalRevenue: number;
    monthlyRevenue: number;
  }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1; // PostgreSQL months are 1-indexed

    // Get all invoices for the user (only select needed fields for performance)
    const allInvoices = await this.invoiceRepository
      .createQueryBuilder('invoice')
      .select(['invoice.status', 'invoice.total', 'invoice.dueDate', 'invoice.issueDate'])
      .where('invoice.userId = :userId', { userId })
      .andWhere('invoice.deletedAt IS NULL')
      .getMany();

    const totalInvoices = allInvoices.length;
    const totalPaid = allInvoices.filter((inv) => inv.status === InvoiceStatus.PAID).length;
    const totalUnpaid = allInvoices.filter(
      (inv) => inv.status !== InvoiceStatus.PAID && inv.status !== InvoiceStatus.CANCELLED,
    ).length;
    const totalOverdue = allInvoices.filter((inv) => {
      if (!inv.dueDate || inv.status === InvoiceStatus.PAID || inv.status === InvoiceStatus.CANCELLED) {
        return false;
      }
      const dueDate = new Date(inv.dueDate);
      dueDate.setHours(0, 0, 0, 0);
      return dueDate < today;
    }).length;

    const totalRevenue = allInvoices
      .filter((inv) => inv.status === InvoiceStatus.PAID)
      .reduce((sum, inv) => sum + parseFloat(inv.total.toString()), 0);

    // Monthly revenue: Use SQL query to filter by current month/year for accuracy
    // This ensures we compare dates correctly regardless of timezone
    const monthlyRevenueResult = await this.invoiceRepository
      .createQueryBuilder('invoice')
      .select('COALESCE(SUM(invoice.total), 0)', 'total')
      .where('invoice.userId = :userId', { userId })
      .andWhere('invoice.deletedAt IS NULL')
      .andWhere('EXTRACT(YEAR FROM invoice.issue_date) = :year', { year: currentYear })
      .andWhere('EXTRACT(MONTH FROM invoice.issue_date) = :month', { month: currentMonth })
      .getRawOne(); 

    const monthlyRevenue = parseFloat(monthlyRevenueResult?.total || '0');

    return {
      totalInvoices,
      totalUnpaid,
      totalPaid,
      totalOverdue,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      monthlyRevenue: Math.round(monthlyRevenue * 100) / 100,
    };
  }
}

