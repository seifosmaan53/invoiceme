import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { User } from './user.entity';

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
export class DeviceChange {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

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

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

