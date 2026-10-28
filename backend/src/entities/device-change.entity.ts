import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { User } from './user.entity';
import { BIGINT_AS_NUMBER } from './bigint-transformer';

export enum ChangeType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
}

export enum ChangeObjectType {
  CLIENT = 'client',
  INVOICE = 'invoice',
  INVOICE_ITEM = 'invoice_item',
  ATTACHMENT = 'attachment',
}

@Entity('device_changes')
@Index(['userId', 'deviceId'])
@Index(['synced'])
@Index(['createdAt'])
// Migration 018. A (user, change_id) is applied at most once; NULL (old clients) is unconstrained.
@Index('idx_device_changes_user_change_id', ['userId', 'changeId'], { unique: true, where: '"change_id" IS NOT NULL' })
export class DeviceChange {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** Optional idempotency key sent by the device for this change. */
  @Column({ name: 'change_id', type: 'uuid', nullable: true })
  changeId: string | null;

  @Column({ name: 'device_id', type: 'varchar', length: 255 })
  deviceId: string;

  @Column({ name: 'object_type', type: 'enum', enum: ChangeObjectType })
  objectType: ChangeObjectType;

  @Column({ name: 'object_id' })
  objectId: string;

  @Column({ name: 'change_json', type: 'jsonb' })
  changeJson: Record<string, any>;

  @Column({ name: 'change_type', type: 'enum', enum: ChangeType })
  changeType: ChangeType;

  @Column({ default: false })
  synced: boolean;

  /** Protocol 2: the record revision the device based this change on (migration 019). */
  @Column({ name: 'base_revision', type: 'bigint', nullable: true, transformer: BIGINT_AS_NUMBER })
  baseRevision: number | null;

  /** How the change was processed: applied, merged or conflict (null while not processed). */
  @Column({ type: 'varchar', length: 20, nullable: true })
  outcome: string | null;

  @Column({ name: 'conflict_id', type: 'uuid', nullable: true })
  conflictId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

