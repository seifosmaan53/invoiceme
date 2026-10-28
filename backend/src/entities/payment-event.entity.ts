import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

/** A verified provider event, processed once (migration 020). No secrets in details. */
@Entity('payment_events')
@Index('idx_payment_events_provider_event', ['providerEventId'], { unique: true })
@Index('idx_payment_events_payment', ['paymentId', 'receivedAt'])
export class PaymentEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'provider_event_id', type: 'varchar', length: 255 })
  providerEventId: string;

  @Column({ name: 'payment_id', type: 'uuid', nullable: true })
  paymentId: string | null;

  @Column({ type: 'varchar', length: 80 })
  type: string;

  /** applied | duplicate | unknown_payment | mismatch | stale | ignored */
  @Column({ type: 'varchar', length: 30 })
  outcome: string;

  @Column({ type: 'jsonb', default: {} })
  details: Record<string, any>;

  @Column({ name: 'provider_created_at', type: 'timestamptz', nullable: true })
  providerCreatedAt: Date | null;

  @Column({ name: 'received_at', type: 'timestamptz', default: () => 'now()' })
  receivedAt: Date;
}
