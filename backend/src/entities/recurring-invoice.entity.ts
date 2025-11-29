import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { User } from './user.entity';
import { Client } from './client.entity';

export enum RecurrenceFrequency {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
  QUARTERLY = 'quarterly',
  YEARLY = 'yearly',
}

@Entity('recurring_invoices')
@Index(['userId'])
@Index(['clientId'])
@Index(['isActive'])
export class RecurringInvoice {
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

  @ManyToOne(() => Client)
  @JoinColumn({ name: 'client_id' })
  client: Client;

  @ApiProperty({ example: 'Monthly Subscription' })
  @Column()
  name: string;

  @ApiProperty({ enum: RecurrenceFrequency, example: RecurrenceFrequency.MONTHLY })
  @Column({ type: 'enum', enum: RecurrenceFrequency })
  frequency: RecurrenceFrequency;

  @ApiProperty({ example: 1 })
  @Column({ type: 'integer', default: 1 })
  interval: number; // Every N days/weeks/months

  @ApiProperty({ example: '2025-01-20' })
  @Column({ name: 'start_date', type: 'date' })
  startDate: Date;

  @ApiPropertyOptional({ example: '2025-12-31' })
  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate?: Date;

  @ApiProperty({ example: '2025-01-20' })
  @Column({ name: 'next_run_date', type: 'date' })
  nextRunDate: Date;

  @ApiProperty({ example: 'USD' })
  @Column({ default: 'USD', type: 'varchar', length: 3 })
  currency: string;

  @ApiProperty({ example: [{ description: 'Service', quantity: 1, unitPrice: 100 }] })
  @Column({ name: 'line_items_json', type: 'jsonb' })
  lineItemsJson: any[];

  @ApiPropertyOptional({ example: 'Payment due within 30 days.' })
  @Column({ type: 'text', nullable: true })
  notes?: string;

  @ApiProperty({ example: true })
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @ApiProperty({ example: 0 })
  @Column({ name: 'invoices_generated', type: 'integer', default: 0 })
  invoicesGenerated: number;

  @ApiProperty({ example: '2025-01-20T10:00:00.000Z' })
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ example: '2025-01-20T11:00:00.000Z' })
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

