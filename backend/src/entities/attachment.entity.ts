import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export enum AttachmentOwnerType {
  INVOICE = 'invoice',
  CLIENT = 'client',
}

@Entity('attachments')
@Index(['ownerType', 'ownerId'])
export class Attachment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'owner_type', type: 'enum', enum: AttachmentOwnerType })
  ownerType: AttachmentOwnerType;

  @Column({ name: 'owner_id' })
  ownerId: string;

  @Column({ type: 'varchar', length: 500 })
  url: string;

  @Column({ type: 'varchar', length: 255 })
  filename: string;

  @Column({ name: 'content_type', type: 'varchar', length: 100, nullable: true })
  contentType: string;

  @Column({ name: 'size_bytes', nullable: true })
  sizeBytes: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

