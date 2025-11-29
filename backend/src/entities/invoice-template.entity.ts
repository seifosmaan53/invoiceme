import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { User } from './user.entity';

@Entity('invoice_templates')
@Index(['userId'])
export class InvoiceTemplate {
  @ApiProperty({ example: 'b3b4f9b0-1d4e-4e7c-9a7e-123456789abc' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'user-uuid-here' })
  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ApiProperty({ example: 'Standard Service Invoice' })
  @Column()
  name: string;

  @ApiPropertyOptional({ example: 'Template for standard service invoices' })
  @Column({ type: 'text', nullable: true })
  description?: string;

  @ApiProperty({ example: 'invoice' })
  @Column({ type: 'varchar', length: 20, default: 'invoice' })
  type: string;

  @ApiProperty({ example: 'USD' })
  @Column({ default: 'USD', type: 'varchar', length: 3 })
  currency: string;

  @ApiProperty({ example: 30 })
  @Column({ name: 'default_due_days', type: 'integer', default: 30 })
  defaultDueDays: number;

  @ApiProperty({ example: [{ description: 'Service', quantity: 1, unitPrice: 100 }] })
  @Column({ name: 'line_items_json', type: 'jsonb' })
  lineItemsJson: any[];

  @ApiPropertyOptional({ example: 'Payment due within 30 days.' })
  @Column({ type: 'text', nullable: true })
  notes?: string;

  @ApiProperty({ example: '2025-01-20T10:00:00.000Z' })
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ example: '2025-01-20T11:00:00.000Z' })
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

