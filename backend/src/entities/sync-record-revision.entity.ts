import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';
import { BIGINT_AS_NUMBER } from './bigint-transformer';

/** Columns changed by one revision, written by the sync_bump_revision trigger (migration 019). */
@Entity('sync_record_revisions')
@Index('idx_sync_record_revisions_object', ['objectType', 'objectId', 'revision'], { unique: true })
@Index('idx_sync_record_revisions_created', ['createdAt'])
export class SyncRecordRevision {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'object_type', type: 'varchar', length: 20 })
  objectType: string;

  @Column({ name: 'object_id', type: 'varchar', length: 64 })
  objectId: string;

  @Column({ type: 'bigint', transformer: BIGINT_AS_NUMBER })
  revision: number;

  /** Database column names. */
  @Column({ name: 'changed_fields', type: 'text', array: true })
  changedFields: string[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
