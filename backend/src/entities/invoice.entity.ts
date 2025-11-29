import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, OneToMany, Index } from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { User } from './user.entity';
import { Client } from './client.entity';
import { InvoiceItem } from './invoice-item.entity';

export enum InvoiceType {
  INVOICE = 'invoice',
  ESTIMATE = 'estimate',
}

export enum InvoiceStatus {
  DRAFT = 'draft',
  SENT = 'sent',
  PAID = 'paid',
  OVERDUE = 'overdue',
  CANCELLED = 'cancelled',
}

@Entity('invoices')
@Index(['userId'])
@Index(['clientId'])
@Index(['type'])
@Index(['status'])
@Index(['deletedAt'])
@Index(['number'])
@Index(['dueDate'])
export class Invoice {
  @ApiProperty({ example: 'b3b4f9b0-1d4e-4e7c-9a7e-123456789abc' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'user-uuid-here' })
  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ApiProperty({ example: 'client-uuid-here' })
  @Column({ name: 'client_id' })
  clientId: string;

  @ApiPropertyOptional({ type: () => Client })
  @ManyToOne(() => Client, { eager: true })
  @JoinColumn({ name: 'client_id' })
  client: Client;

  @ApiProperty({ enum: InvoiceType, example: InvoiceType.INVOICE })
  @Column({ type: 'enum', enum: InvoiceType, default: InvoiceType.INVOICE })
  type: InvoiceType;

  @ApiProperty({ example: 'INV-2025-0001' })
  @Column({ type: 'varchar', length: 50 })
  number: string;

  @ApiProperty({ enum: InvoiceStatus, example: InvoiceStatus.DRAFT })
  @Column({ type: 'enum', enum: InvoiceStatus, default: InvoiceStatus.DRAFT })
  status: InvoiceStatus;

  @ApiProperty({ example: '2025-01-20' })
  @Column({ name: 'issue_date', type: 'date' })
  issueDate: Date;

  @ApiPropertyOptional({ example: '2025-02-20' })
  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate: Date;

  @ApiProperty({ example: 'USD' })
  @Column({ default: 'USD', type: 'varchar', length: 3 })
  currency: string;

  @ApiProperty({ example: 1000.0 })
  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  subtotal: number;

  @ApiProperty({ example: 100.0 })
  @Column({ name: 'tax_total', type: 'numeric', precision: 12, scale: 2, default: 0 })
  taxTotal: number;

  @ApiProperty({ example: 50.0 })
  @Column({ name: 'discount_total', type: 'numeric', precision: 12, scale: 2, default: 0 })
  discountTotal: number;

  @ApiProperty({ example: 1050.0 })
  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  total: number;

  @ApiPropertyOptional({ example: 'Payment due within 30 days. Thank you for your business!' })
  @Column({ type: 'text', nullable: true })
  notes: string;

  @ApiPropertyOptional({ example: { projectId: 'proj-123', customField: 'value' } })
  @Column({ name: 'metadata_json', type: 'jsonb', nullable: true })
  metadataJson: Record<string, any>;

  @ApiProperty({ example: '2025-01-20T10:00:00.000Z' })
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ example: '2025-01-20T11:00:00.000Z' })
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ApiPropertyOptional({ example: '2025-01-30T10:00:00.000Z' })
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date;

  @ApiPropertyOptional({ type: () => [InvoiceItem] })
  @OneToMany(() => InvoiceItem, (item) => item.invoice)
  items: InvoiceItem[];
}

