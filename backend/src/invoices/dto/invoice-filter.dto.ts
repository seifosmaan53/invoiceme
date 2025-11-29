import { IsOptional, IsDateString, IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../core/dto/pagination.dto';
import { InvoiceType, InvoiceStatus } from '../../entities/invoice.entity';

export class InvoiceFilterDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Filter by invoice type',
    enum: InvoiceType,
    example: InvoiceType.INVOICE,
  })
  @IsOptional()
  type?: InvoiceType;

  @ApiPropertyOptional({
    description: 'Filter by invoice status',
    enum: InvoiceStatus,
    example: InvoiceStatus.PAID,
  })
  @IsOptional()
  status?: InvoiceStatus;

  @ApiPropertyOptional({
    description: 'Filter invoices issued on or after this date (ISO 8601 format)',
    example: '2025-01-01',
    type: String,
  })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({
    description: 'Filter invoices issued on or before this date (ISO 8601 format)',
    example: '2025-12-31',
    type: String,
  })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({
    description: 'Filter invoices with total amount greater than or equal to this value',
    example: 100.0,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amountMin?: number;

  @ApiPropertyOptional({
    description: 'Filter invoices with total amount less than or equal to this value',
    example: 1000.0,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amountMax?: number;
}

