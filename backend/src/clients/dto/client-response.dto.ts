import { ApiProperty } from '@nestjs/swagger';
import { Client } from '../../entities/client.entity';
import { PaginationMetaDto } from '../../core/dto/pagination-meta.dto';

export class ClientsPaginatedResponseDto {
  @ApiProperty({ 
    type: () => [Client],
    description: 'Array of client records',
  })
  data: Client[];

  @ApiProperty({ 
    type: () => PaginationMetaDto,
    description: 'Pagination metadata',
  })
  meta: PaginationMetaDto;
}

