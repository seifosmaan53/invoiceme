import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { User } from './user.entity';

@Entity('clients')
@Index(['userId'])
@Index(['deletedAt'])
@Index(['email'])
export class Client {
  @ApiProperty({ example: 'b3b4f9b0-1d4e-4e7c-9a7e-123456789abc' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'user-uuid-here' })
  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ApiProperty({ example: 'Acme Corporation' })
  @Column({ type: 'varchar', length: 255 })
  name: string;

  @ApiPropertyOptional({ example: 'contact@acme.com' })
  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string;

  @ApiPropertyOptional({ example: '+1-555-123-4567' })
  @Column({ type: 'varchar', length: 50, nullable: true })
  phone: string;

  @ApiPropertyOptional({
    example: {
      address: '123 Main St',
      city: 'New York',
      state: 'NY',
      zip: '10001',
      country: 'USA',
    },
  })
  @Column({ name: 'address_json', type: 'jsonb', nullable: true })
  addressJson: Record<string, any>;

  @ApiPropertyOptional({
    example: 'Preferred contact: email. Payment terms: Net 30.',
  })
  @Column({ type: 'text', nullable: true })
  notes: string;

  @ApiPropertyOptional({ example: ['VIP', 'Wholesale'] })
  @Column({ name: 'tags_json', type: 'jsonb', nullable: true, default: '[]' })
  tagsJson: string[];

  @ApiPropertyOptional({ example: 'https://example.com/avatar.png' })
  @Column({ name: 'avatar_url', type: 'text', nullable: true })
  avatarUrl?: string;

  @ApiProperty({ example: '2025-01-20T10:00:00.000Z' })
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ example: '2025-01-22T10:00:00.000Z' })
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ApiPropertyOptional({ example: '2025-01-25T10:00:00.000Z' })
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date;
}

