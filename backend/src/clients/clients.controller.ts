import { Controller, Get, Post, Patch, Param, Body, Delete, UseGuards, Query } from '@nestjs/common';
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
import { ClientsService } from './clients.service';
import { CreateClientDto, UpdateClientDto } from './dto/client.dto';
import { ClientFilterDto } from './dto/client-filter.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiKeyOrJwtGuard } from '../auth/guards/api-key-or-jwt.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaginationDto } from '../core/dto/pagination.dto';
import { ClientsPaginatedResponseDto } from './dto/client-response.dto';
import { Client } from '../entities/client.entity';
import { CsvService } from '../core/services/csv.service';
import { AuditService } from '../core/services/audit.service';
import { AuditAction, AuditResource } from '../entities/audit-log.entity';
import { Res, Req, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';

@ApiTags('clients')
@ApiBearerAuth('JWT-auth')
@Controller('v1/clients')
@UseGuards(ApiKeyOrJwtGuard, PermissionGuard)
export class ClientsController {
  constructor(
    private readonly clientsService: ClientsService,
    private readonly csvService: CsvService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @RequirePermission('read:clients')
  @ApiOperation({ summary: 'Get all clients (paginated)' })
  @ApiOkResponse({
    description: 'List clients with pagination and optional search',
    type: ClientsPaginatedResponseDto,
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: 'Items per page (default: 20, max: 100)' })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Search by name, email, phone, notes, address, or tags',
    example: 'apple',
  })
  @ApiQuery({
    name: 'tags',
    required: false,
    type: [String],
    description: 'Filter clients by tags (array). Clients must have ALL specified tags.',
    example: ['VIP', 'Active'],
    isArray: true,
  })
  @ApiQuery({
    name: 'dateFrom',
    required: false,
    type: String,
    description: 'Filter clients created on or after this date (ISO 8601 format)',
    example: '2025-01-01',
  })
  @ApiQuery({
    name: 'dateTo',
    required: false,
    type: String,
    description: 'Filter clients created on or before this date (ISO 8601 format)',
    example: '2025-12-31',
  })
  async findAll(@Query() filters: ClientFilterDto, @CurrentUser() user: any) {
    // Handle tags query parameter - can come as string, comma-separated string, or array
    let tags: string[] | undefined;
    if (filters.tags) {
      if (Array.isArray(filters.tags)) {
        // Already an array: ['VIP', 'Active']
        tags = filters.tags;
      } else if (typeof filters.tags === 'string') {
        // Single tag or comma-separated: 'VIP' or 'VIP,Active'
        tags = filters.tags.split(',').map((t) => t.trim()).filter((t) => t.length > 0);
      }
    }

    return this.clientsService.findAll(
      user.userId,
      filters,
      tags && tags.length > 0 ? tags : undefined,
      filters.dateFrom,
      filters.dateTo,
    );
  }

  @Get(':id')
  @RequirePermission('read:clients')
  @ApiOperation({ summary: 'Get a single client by ID' })
  @ApiOkResponse({
    description: 'Get a single client by ID',
    type: Client,
  })
  @ApiNotFoundResponse({ description: 'Client not found' })
  @ApiForbiddenResponse({ description: 'Access denied' })
  async findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.clientsService.findOne(id, user.userId);
  }

  @Post()
  @RequirePermission('write:clients')
  @ApiOperation({ summary: 'Create a new client' })
  @ApiCreatedResponse({
    description: 'Create a new client',
    type: Client,
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async create(@Body() createClientDto: CreateClientDto, @CurrentUser() user: any) {
    return this.clientsService.create(createClientDto, user.userId);
  }

  @Patch(':id')
  @RequirePermission('write:clients')
  @ApiOperation({ summary: 'Update an existing client' })
  @ApiOkResponse({
    description: 'Update an existing client',
    type: Client,
  })
  @ApiNotFoundResponse({ description: 'Client not found' })
  @ApiForbiddenResponse({ description: 'Access denied' })
  async update(
    @Param('id') id: string,
    @Body() updateClientDto: UpdateClientDto,
    @CurrentUser() user: any,
  ) {
    return this.clientsService.update(id, updateClientDto, user.userId);
  }

  @Delete(':id')
  @RequirePermission('delete:clients')
  @ApiOperation({ summary: 'Archive (soft-delete) a client' })
  @ApiNoContentResponse({
    description: 'Archive (soft-delete) a client',
  })
  @ApiNotFoundResponse({ description: 'Client not found' })
  @ApiForbiddenResponse({ description: 'Access denied' })
  async archive(@Param('id') id: string, @CurrentUser() user: any) {
    await this.clientsService.archive(id, user.userId);
  }

  @Get('export/csv')
  @RequirePermission('read:clients')
  @ApiOperation({ summary: 'Export all clients as CSV' })
  @ApiOkResponse({
    description: 'CSV file with all clients',
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
    const clients = await this.clientsService.findAllForExport(user.userId);
    
    // Transform clients to CSV format
    const csvData = clients.map((client) => ({
      name: client.name,
      email: client.email || '',
      phone: client.phone || '',
      address: client.addressJson ? JSON.stringify(client.addressJson) : '',
      notes: client.notes || '',
      tags: client.tagsJson ? client.tagsJson.join('; ') : '',
    }));

    const csv = await this.csvService.toCsv(csvData, this.csvService.getClientHeaders());

    await this.auditService.log(
      user.userId,
      AuditAction.EXPORT,
      AuditResource.CLIENT,
      'all',
      { format: 'csv', count: clients.length },
      req.ip,
    );

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="clients-${Date.now()}.csv"`);
    res.send(csv);
  }

  @Post('import/csv')
  @RequirePermission('write:clients')
  @ApiOperation({ summary: 'Import clients from CSV file' })
  @ApiCreatedResponse({
    description: 'Clients imported successfully',
    schema: {
      type: 'object',
      properties: {
        imported: { type: 'number' },
        failed: { type: 'number' },
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
      throw new Error('No file uploaded');
    }

    const records = await this.csvService.fromCsv(file.buffer);
    const clientsToCreate: CreateClientDto[] = [];
    const errors: string[] = [];

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      try {
        const tags = record.tags ? (record.tags as string).split(';').map((t) => t.trim()).filter((t) => t) : [];
        
        clientsToCreate.push({
          name: record.name || `Client ${i + 1}`,
          email: record.email || undefined,
          phone: record.phone || undefined,
          address_json: record.address ? JSON.parse(record.address as string) : undefined,
          notes: record.notes || undefined,
          tags: tags.length > 0 ? tags : undefined,
        });
      } catch (error) {
        errors.push(`Row ${i + 2}: ${error.message}`);
      }
    }

    const created = await this.clientsService.bulkCreate(user.userId, clientsToCreate);

    await this.auditService.log(
      user.userId,
      AuditAction.CREATE,
      AuditResource.CLIENT,
      'bulk',
      { format: 'csv', imported: created.length, failed: errors.length },
      req.ip,
    );

    return {
      imported: created.length,
      failed: errors.length,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  @Post('bulk-archive')
  @ApiOperation({ summary: 'Bulk archive clients' })
  @ApiOkResponse({
    description: 'Clients archived successfully',
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
    const archived = await this.clientsService.bulkArchive(user.userId, body.ids);

    await this.auditService.log(
      user.userId,
      AuditAction.DELETE,
      AuditResource.CLIENT,
      'bulk',
      { count: archived },
      req.ip,
    );

    return { archived };
  }
}

