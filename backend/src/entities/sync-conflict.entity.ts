import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';
import { BIGINT_AS_NUMBER } from './bigint-transformer';

export enum SyncConflictKind {
  /** The record changed on the server since the device's base revision, on a field the device also changed. */
  STALE_EDIT = 'stale_edit',
  /** A stale write to a sent, overdue or paid invoice (or one of its items): never merged. */
  PROTECTED_INVOICE = 'protected_invoice',
  /** The device edited or recreated a record that was deleted. The delete stands. */
  EDIT_AFTER_DELETE = 'edit_after_delete',
  /** The device deleted a record that changed on the server since it last saw it. The delete stands; the version it removed can be restored. */
  DELETE_AFTER_EDIT = 'delete_after_edit',
}

export enum SyncConflictStatus {
  OPEN = 'open',
  RESOLVED = 'resolved',
  DISMISSED = 'dismissed',
}

/**
 * An offline change that was not applied as sent (migration 019). Only an
 * allowlist of business fields is stored (sync/conflict-fields.ts), never
 * metadata, credentials or payment data.
 */
@Entity('sync_conflicts')
@Index('idx_sync_conflicts_user_status', ['userId', 'status', 'createdAt'])
@Index('idx_sync_conflicts_object', ['objectType', 'objectId', 'status'])
export class SyncConflict {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'object_type', type: 'varchar', length: 20 })
  objectType: string;

  @Column({ name: 'object_id', type: 'varchar', length: 64 })
  objectId: string;

  @Column({ type: 'varchar', length: 30 })
  kind: SyncConflictKind;

  @Column({ name: 'change_type', type: 'varchar', length: 10 })
  changeType: string;

  @Column({ name: 'change_id', type: 'uuid', nullable: true })
  changeId: string | null;

  @Column({ name: 'device_id', type: 'varchar', length: 255, nullable: true })
  deviceId: string | null;

  @Column({ name: 'base_revision', type: 'bigint', nullable: true, transformer: BIGINT_AS_NUMBER })
  baseRevision: number | null;

  @Column({ name: 'server_revision', type: 'bigint', nullable: true, transformer: BIGINT_AS_NUMBER })
  serverRevision: number | null;

  @Column({ name: 'client_fields', type: 'jsonb', default: {} })
  clientFields: Record<string, any>;

  @Column({ name: 'server_fields', type: 'jsonb', nullable: true })
  serverFields: Record<string, any> | null;

  @Column({ name: 'conflicting_fields', type: 'text', array: true, default: '{}' })
  conflictingFields: string[];

  @Column({ name: 'omitted_fields', type: 'text', array: true, default: '{}' })
  omittedFields: string[];

  @Column({ type: 'varchar', length: 20, default: SyncConflictStatus.OPEN })
  status: SyncConflictStatus;

  @Column({ type: 'varchar', length: 20, nullable: true })
  resolution: string | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @Column({ name: 'resolved_by', type: 'uuid', nullable: true })
  resolvedBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
