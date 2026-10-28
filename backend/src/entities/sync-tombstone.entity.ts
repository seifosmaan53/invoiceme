import { Entity, PrimaryColumn, Column, Index } from 'typeorm';
import { BIGINT_AS_NUMBER } from './bigint-transformer';

/** A deleted record, written by the sync_record_tombstone trigger (migration 019). */
@Entity('sync_tombstones')
@Index('idx_sync_tombstones_user_deleted', ['userId', 'deletedAt'])
@Index('idx_sync_tombstones_deleted', ['deletedAt'])
export class SyncTombstone {
  @PrimaryColumn({ name: 'object_type', type: 'varchar', length: 20 })
  objectType: string;

  @PrimaryColumn({ name: 'object_id', type: 'varchar', length: 64 })
  objectId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'bigint', nullable: true, transformer: BIGINT_AS_NUMBER })
  revision: number | null;

  @Column({ name: 'deleted_at', type: 'timestamptz', default: () => 'now()' })
  deletedAt: Date;

  /** Last stored state of a hard-deleted invoice item, so it can be restored. */
  @Column({ name: 'last_state', type: 'jsonb', nullable: true })
  lastState: Record<string, any> | null;
}
