import { ApiProperty } from '@nestjs/swagger';
import { Invoice } from '../../entities/invoice.entity';
import { PaginationMetaDto } from '../../core/dto/pagination-meta.dto';

export class InvoicesPaginatedResponseDto {
  @ApiProperty({ 
    type: () => [Invoice],
    description: 'Array of invoice records',
  })
  data: Invoice[];

  @ApiProperty({ 
    type: () => PaginationMetaDto,
    description: 'Pagination metadata',
  })
  meta: PaginationMetaDto;
}

