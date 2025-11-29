import { IsOptional, IsString, MaxLength, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateUserSettingsDto {
  @ApiPropertyOptional({
    description: 'Public URL to company logo used in PDFs',
    example: 'https://my-cdn.com/logos/company-logo.png',
  })
  @IsString()
  @IsOptional()
  pdfLogoUrl?: string;

  @ApiPropertyOptional({
    description: 'Primary color (HEX) used in PDF header and accents',
    example: '#4a90e2',
  })
  @IsString()
  @IsOptional()
  @Matches(/^#[0-9A-Fa-f]{6}$/, {
    message: 'Primary color must be a valid HEX color (e.g., #4a90e2)',
  })
  pdfPrimaryColor?: string;

  @ApiPropertyOptional({
    description: 'Secondary color (HEX) used in PDF',
    example: '#333333',
  })
  @IsString()
  @IsOptional()
  @Matches(/^#[0-9A-Fa-f]{6}$/, {
    message: 'Secondary color must be a valid HEX color (e.g., #333333)',
  })
  pdfSecondaryColor?: string;

  @ApiPropertyOptional({
    description: 'Font family used in PDF generation',
    example: 'Arial',
  })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  pdfFontFamily?: string;
}

