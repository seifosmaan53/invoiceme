import { Entity, PrimaryColumn, Column } from 'typeorm';

/**
 * Small server-wide facts that must survive restarts (migration 022), e.g.
 * the business date of the first overdue run (invoices/invoice-status.service.ts).
 */
@Entity('system_state')
export class SystemState {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  key: string;

  @Column({ type: 'text' })
  value: string;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt: Date;
}
