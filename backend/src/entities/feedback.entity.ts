import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, Index } from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { User } from './user.entity';

@Entity('feedback')
@Index(['userId'])
export class Feedback {
  @ApiProperty({ example: 'b3b4f9b0-1d4e-4e7c-9a7e-123456789abc' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'user-uuid-here' })
  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ApiProperty({ example: 'Great app! Love the invoice features.' })
  @Column({ type: 'text' })
  message: string;

  @ApiPropertyOptional({ example: 'invoice_detail' })
  @Column({ type: 'varchar', length: 100, nullable: true })
  context?: string;

  @ApiPropertyOptional({ example: 5 })
  @Column({ type: 'integer', nullable: true })
  rating?: number;

  @ApiProperty({ example: '2025-01-20T10:00:00.000Z' })
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
