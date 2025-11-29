import { IsOptional, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../core/dto/pagination.dto';

export class ClientFilterDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Filter clients by tags. Can be comma-separated string or array. Clients must have ALL specified tags.',
    example: 'VIP,Active',
    type: [String],
    isArray: true,
  })
  @IsOptional()
  @Type(() => String)
  tags?: string | string[];

  @ApiPropertyOptional({
    description: 'Filter clients created on or after this date (ISO 8601 format)',
    example: '2025-01-01',
    type: String,
  })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({
    description: 'Filter clients created on or before this date (ISO 8601 format)',
    example: '2025-12-31',
    type: String,
  })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

