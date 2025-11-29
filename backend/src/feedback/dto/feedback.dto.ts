import { IsString, IsNotEmpty, IsOptional, IsEnum, IsEmail, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum FeedbackType {
  BUG = 'bug',
  FEATURE = 'feature',
  IMPROVEMENT = 'improvement',
  OTHER = 'other',
}

export class CreateFeedbackDto {
  @ApiProperty({
    description: 'Type of feedback',
    enum: FeedbackType,
    example: FeedbackType.FEATURE,
  })
  @IsEnum(FeedbackType)
  @IsNotEmpty()
  type: FeedbackType;

  @ApiProperty({
    description: 'Feedback message',
    example: 'It would be great to have dark mode support',
    maxLength: 5000,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  message: string;

  @ApiPropertyOptional({
    description: 'User email (optional, for follow-up)',
    example: 'user@example.com',
  })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({
    description: 'App version',
    example: '1.0.0',
  })
  @IsString()
  @IsOptional()
  appVersion?: string;

  @ApiPropertyOptional({
    description: 'User agent / browser information',
    example: 'Mozilla/5.0...',
  })
  @IsString()
  @IsOptional()
  userAgent?: string;

  @ApiPropertyOptional({
    description: 'Additional metadata (screen, action, etc.)',
    example: { screen: 'dashboard', action: 'filter' },
  })
  @IsOptional()
  metadataJson?: Record<string, any>;
}

