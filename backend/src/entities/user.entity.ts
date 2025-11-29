import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('users')
@Index(['email'])
@Index(['createdAt'])
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ name: 'company_name', type: 'varchar', length: 255, nullable: true })
  companyName: string;

  @Column({ name: 'totp_secret', type: 'varchar', length: 255, nullable: true })
  totpSecret?: string;

  @Column({ name: 'totp_enabled', type: 'boolean', default: false })
  totpEnabled: boolean;

  @Column({ name: 'backup_codes', type: 'text', nullable: true })
  backupCodes?: string; // JSON array of backup codes

  @Column({ name: 'invoice_number_format', type: 'varchar', length: 100, nullable: true })
  invoiceNumberFormat?: string; // e.g., "INV-{YYYY}-{####}" or "EST-{YYYY}-{####}"

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

