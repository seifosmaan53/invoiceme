import { Entity, PrimaryGeneratedColumn, Column, OneToOne, JoinColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { User } from './user.entity';

@Entity('user_settings')
@Index(['userId'], { unique: true })
export class UserSettings {
  @ApiProperty({ example: 'b3b4f9b0-1d4e-4e7c-9a7e-123456789abc' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'user-uuid-here' })
  @Column({ name: 'user_id', unique: true })
  userId: string;

  @OneToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ApiPropertyOptional({ example: 'https://example.com/logo.png' })
  @Column({ name: 'pdf_logo_url', type: 'text', nullable: true })
  pdfLogoUrl?: string;

  @ApiProperty({ example: '#4a90e2' })
  @Column({ name: 'pdf_primary_color', type: 'varchar', length: 7, default: '#4a90e2' })
  pdfPrimaryColor: string;

  @ApiProperty({ example: '#333333' })
  @Column({ name: 'pdf_secondary_color', type: 'varchar', length: 7, default: '#333333' })
  pdfSecondaryColor: string;

  @ApiProperty({ example: 'Arial' })
  @Column({ name: 'pdf_font_family', type: 'varchar', length: 50, default: 'Arial' })
  pdfFontFamily: string;

  @ApiProperty({ example: 'classic', description: 'PDF layout style (classic or minimal)' })
  @Column({ name: 'pdf_layout', type: 'varchar', length: 20, default: 'classic' })
  pdfLayout: string;

  @ApiProperty({ example: true, description: 'Show company logo in PDF header' })
  @Column({ name: 'pdf_show_logo', type: 'boolean', default: true })
  pdfShowLogo: boolean;

  @ApiProperty({ example: true, description: 'Show client details section' })
  @Column({ name: 'pdf_show_client_details', type: 'boolean', default: true })
  pdfShowClientDetails: boolean;

  @ApiProperty({ example: true, description: 'Show invoice metadata section' })
  @Column({ name: 'pdf_show_invoice_details', type: 'boolean', default: true })
  pdfShowInvoiceDetails: boolean;

  @ApiProperty({ example: true, description: 'Show notes section when notes exist' })
  @Column({ name: 'pdf_show_notes', type: 'boolean', default: true })
  pdfShowNotes: boolean;

  @ApiProperty({ example: true, description: 'Show footer/thank you section' })
  @Column({ name: 'pdf_show_footer', type: 'boolean', default: true })
  pdfShowFooter: boolean;

  @ApiPropertyOptional({ example: 'Thanks for choosing InvoiceMe!' })
  @Column({ name: 'pdf_thank_you_message', type: 'text', nullable: true })
  pdfThankYouMessage?: string;

  @ApiProperty({ example: '2025-01-20T10:00:00.000Z' })
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ example: '2025-01-20T11:00:00.000Z' })
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

