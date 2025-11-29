import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Invoice } from './invoice.entity';

@Entity('invoice_items')
@Index(['invoiceId'])
export class InvoiceItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'invoice_id' })
  invoiceId: string;

  @ManyToOne(() => Invoice, (invoice) => invoice.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 1 })
  quantity: number;

  @Column({ name: 'unit_price', type: 'numeric', precision: 12, scale: 2, default: 0 })
  unitPrice: number;

  @Column({ name: 'tax_rate', type: 'numeric', precision: 5, scale: 2, default: 0 })
  taxRate: number;

  @Column({ name: 'discount_rate', type: 'numeric', precision: 5, scale: 2, default: 0 })
  discountRate: number;

  @Column({ name: 'line_total', type: 'numeric', precision: 12, scale: 2, default: 0 })
  lineTotal: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

