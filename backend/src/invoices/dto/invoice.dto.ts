import { IsString, IsEnum, IsDateString, IsOptional, IsNumber, IsArray, ValidateNested, IsUUID, IsObject, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InvoiceType, InvoiceStatus } from '../../entities/invoice.entity';

export class CreateInvoiceItemDto {
  @ApiProperty({
    description: 'Item description or name',
    example: 'Web Development Services',
  })
  @IsString()
  description: string;

  @ApiProperty({
    description: 'Quantity of items',
    example: 10,
    minimum: 0.01,
  })
  @IsNumber()
  quantity: number;

  @ApiProperty({
    description: 'Price per unit',
    example: 150.00,
    minimum: 0,
  })
  @IsNumber()
  unitPrice: number;

  @ApiPropertyOptional({
    description: 'Tax rate as percentage (e.g., 10 for 10%)',
    example: 10,
    minimum: 0,
    maximum: 100,
  })
  @IsNumber()
  @IsOptional()
  taxRate?: number;

  @ApiPropertyOptional({
    description: 'Discount rate as percentage (e.g., 5 for 5%)',
    example: 5,
    minimum: 0,
    maximum: 100,
  })
  @IsNumber()
  @IsOptional()
  discountRate?: number;
}

export class CreateInvoiceDto {
  @ApiProperty({
    description: 'Client UUID (get from /api/v1/clients)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  clientId: string;

  @ApiPropertyOptional({
    description: 'Invoice type',
    enum: InvoiceType,
    example: InvoiceType.INVOICE,
    default: InvoiceType.INVOICE,
  })
  @IsEnum(InvoiceType)
  @IsOptional()
  type?: InvoiceType;

  @ApiPropertyOptional({
    description: 'Invoice status. Defaults to SENT if not provided.',
    enum: InvoiceStatus,
    example: InvoiceStatus.SENT,
    default: InvoiceStatus.SENT,
  })
  @IsEnum(InvoiceStatus)
  @IsOptional()
  status?: InvoiceStatus;

  @ApiProperty({
    description: 'Invoice issue date (ISO 8601 format)',
    example: '2025-11-23T00:00:00Z',
  })
  @IsDateString()
  issueDate: string;

  @ApiPropertyOptional({
    description: 'Invoice due date (ISO 8601 format)',
    example: '2025-12-23T00:00:00Z',
  })
  @IsDateString()
  @IsOptional()
  dueDate?: string;

  @ApiPropertyOptional({
    description: 'Currency code (ISO 4217)',
    example: 'USD',
    default: 'USD',
  })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiProperty({
    description: 'Invoice line items',
    type: [CreateInvoiceItemDto],
    example: [
      {
        description: 'Web Development Services',
        quantity: 10,
        unitPrice: 150.00,
        taxRate: 10,
        discountRate: 0,
      },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceItemDto)
  items: CreateInvoiceItemDto[];

  @ApiPropertyOptional({
    description: 'Additional notes or terms',
    example: 'Payment due within 30 days. Thank you for your business!',
  })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({
    description: 'Additional metadata as JSON object',
    example: { projectId: 'proj-123', customField: 'value' },
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((o) => o.metadataJson !== null && o.metadataJson !== undefined)
  @IsObject()
  metadataJson?: Record<string, any> | null;
}

export class UpdateInvoiceDto {
  @ApiPropertyOptional({
    description: 'Client UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  @IsOptional()
  clientId?: string;

  @ApiPropertyOptional({
    description: 'Invoice status',
    enum: InvoiceStatus,
    example: InvoiceStatus.PAID,
  })
  @IsEnum(InvoiceStatus)
  @IsOptional()
  status?: InvoiceStatus;

  @ApiPropertyOptional({
    description: 'Invoice issue date (ISO 8601 format)',
    example: '2025-11-23T00:00:00Z',
  })
  @IsDateString()
  @IsOptional()
  issueDate?: string;

  @ApiPropertyOptional({
    description: 'Invoice due date (ISO 8601 format)',
    example: '2025-12-23T00:00:00Z',
  })
  @IsDateString()
  @IsOptional()
  dueDate?: string;

  @ApiPropertyOptional({
    description: 'Currency code (ISO 4217)',
    example: 'USD',
  })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiPropertyOptional({
    description: 'Invoice line items',
    type: [CreateInvoiceItemDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceItemDto)
  @IsOptional()
  items?: CreateInvoiceItemDto[];

  @ApiPropertyOptional({
    description: 'Additional notes or terms',
    example: 'Payment received. Thank you!',
  })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({
    description: 'Additional metadata as JSON object. Set to null to clear metadata.',
    example: { projectId: 'proj-123' },
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((o) => o.metadataJson !== null && o.metadataJson !== undefined)
  @IsObject()
  metadataJson?: Record<string, any> | null;
}

