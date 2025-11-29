import { IsString, IsEmail, IsOptional, IsObject, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateClientDto {
  @ApiProperty({
    description: 'Client full name or company name',
    example: 'Acme Corporation',
  })
  @IsString()
  name: string;

  @ApiPropertyOptional({
    description: 'Client email address',
    example: 'contact@acme.com',
  })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({
    description: 'Client phone number',
    example: '+1-555-123-4567',
  })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({
    description: 'Client address as JSON object',
    example: { address: '123 Main St', city: 'New York', state: 'NY', zip: '10001', country: 'USA' },
  })
  @IsObject()
  @IsOptional()
  address_json?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Client notes',
    example: 'Preferred contact method: email. Payment terms: Net 30.',
  })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({
    description: 'Client tags for categorization',
    example: ['VIP', 'Wholesale', 'Regular'],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];
}

export class UpdateClientDto {
  @ApiPropertyOptional({
    description: 'Client full name or company name',
    example: 'Acme Corporation',
  })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({
    description: 'Client email address',
    example: 'contact@acme.com',
  })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({
    description: 'Client phone number',
    example: '+1-555-123-4567',
  })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({
    description: 'Client address as JSON object',
    example: { address: '123 Main St', city: 'New York', state: 'NY', zip: '10001', country: 'USA' },
  })
  @IsObject()
  @IsOptional()
  address_json?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Client notes',
    example: 'Preferred contact method: email. Payment terms: Net 30.',
  })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({
    description: 'Client tags for categorization',
    example: ['VIP', 'Wholesale', 'Regular'],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];
}

