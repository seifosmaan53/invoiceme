import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Invoice } from './invoice.entity';

export enum PaymentProvider {
  STRIPE = 'stripe',
  PAYPAL = 'paypal',
  OTHER = 'other',
}

export enum PaymentStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  FAILED = 'failed',
  REFUNDED = 'refunded',
}

@Entity('payments')
@Index(['invoiceId'])
@Index(['provider'])
@Index(['status'])
@Index(['providerPaymentId'])
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'invoice_id' })
  invoiceId: string;

  @ManyToOne(() => Invoice)
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice;

  @Column({ type: 'enum', enum: PaymentProvider, default: PaymentProvider.STRIPE })
  provider: PaymentProvider;

  @Column({ name: 'provider_payment_id', type: 'varchar', length: 255 })
  providerPaymentId: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: number;

  @Column({ type: 'varchar', length: 3, default: 'USD' })
  currency: string;

  @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.PENDING })
  status: PaymentStatus;

  /** Amount returned to the customer (provider state, migration 020). The payment stays completed. */
  @Column({ name: 'refunded_amount', type: 'numeric', precision: 12, scale: 2, default: 0 })
  refundedAmount: number;

  /** Provider dispute status (e.g. needs_response, under_review, won, lost); null when never disputed. */
  @Column({ name: 'dispute_status', type: 'varchar', length: 30, nullable: true })
  disputeStatus: string | null;

  @Column({ name: 'disputed_amount', type: 'numeric', precision: 12, scale: 2, default: 0 })
  disputedAmount: number;

  @Column({ name: 'provider_charge_id', type: 'varchar', length: 255, nullable: true })
  providerChargeId: string | null;

  /** Key sent to the provider when this attempt was created (no secrets). */
  @Column({ name: 'idempotency_key', type: 'varchar', length: 120, nullable: true })
  idempotencyKey: string | null;

  @Column({ name: 'metadata_json', type: 'jsonb', nullable: true })
  metadataJson: Record<string, any>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

