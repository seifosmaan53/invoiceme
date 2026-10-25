import { IsOptional, IsString, MaxLength, Matches, IsBoolean, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { LOGO_MAX_URL_LENGTH } from '../../core/services/pdf-logo';

export class UpdateUserSettingsDto {
  @ApiPropertyOptional({
    description:
      'Public https URL of the company logo used in PDFs (PNG, JPEG, GIF or WebP, at most 1 MB). ' +
      'The server fetches it when rendering; empty string or null removes it.',
    example: 'https://my-cdn.com/logos/company-logo.png',
  })
  @IsString()
  @IsOptional()
  @MaxLength(LOGO_MAX_URL_LENGTH)
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
  // Inserted into the PDF's CSS: letters, digits, spaces and hyphens only
  @Matches(/^[A-Za-z0-9 -]+$/, {
    message: 'Font family may contain only letters, digits, spaces and hyphens',
  })
  pdfFontFamily?: string;

  @ApiPropertyOptional({
    description: 'Layout style for PDF rendering',
    example: 'classic',
    enum: ['classic', 'minimal'],
  })
  @IsString()
  @IsOptional()
  @IsIn(['classic', 'minimal'], { message: 'Layout must be classic or minimal' })
  pdfLayout?: string;

  @ApiPropertyOptional({ description: 'Show company logo in PDF header', example: true })
  @IsBoolean()
  @IsOptional()
  pdfShowLogo?: boolean;

  @ApiPropertyOptional({ description: 'Show client details block', example: true })
  @IsBoolean()
  @IsOptional()
  pdfShowClientDetails?: boolean;

  @ApiPropertyOptional({ description: 'Show invoice metadata block', example: true })
  @IsBoolean()
  @IsOptional()
  pdfShowInvoiceDetails?: boolean;

  @ApiPropertyOptional({ description: 'Show notes section when notes exist', example: true })
  @IsBoolean()
  @IsOptional()
  pdfShowNotes?: boolean;

  @ApiPropertyOptional({ description: 'Show footer / thank you message', example: true })
  @IsBoolean()
  @IsOptional()
  pdfShowFooter?: boolean;

  @ApiPropertyOptional({
    description: 'Custom thank you message displayed in footer',
    example: 'Thanks for choosing InvoiceMe!',
  })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  pdfThankYouMessage?: string;
}

