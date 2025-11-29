import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { User } from './user.entity';

@Entity('api_keys')
@Index(['userId'])
@Index(['keyHash'])
export class ApiKey {
  @ApiProperty({ example: 'b3b4f9b0-1d4e-4e7c-9a7e-123456789abc' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'user-uuid-here' })
  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ApiProperty({ example: 'My API Key' })
  @Column()
  name: string;

  @ApiProperty({ example: 'sk_live_...' })
  @Column({ name: 'key_hash', unique: true })
  keyHash: string; // Hashed API key

  @ApiProperty({ example: ['read:invoices', 'write:invoices'] })
  @Column({ name: 'permissions_json', type: 'jsonb', default: '[]' })
  permissionsJson: string[];

  @ApiProperty({ example: '2025-12-31' })
  @Column({ name: 'expires_at', type: 'date', nullable: true })
  expiresAt?: Date;

  @ApiProperty({ example: true })
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @ApiProperty({ example: '2025-01-20T10:00:00.000Z' })
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ example: '2025-01-20T11:00:00.000Z' })
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ApiPropertyOptional({ example: '2025-01-20T12:00:00.000Z' })
  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt?: Date;
}

