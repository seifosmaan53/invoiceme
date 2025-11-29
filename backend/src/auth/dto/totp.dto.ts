import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, Length } from 'class-validator';

export class SetupTotpDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsString()
  @IsNotEmpty()
  email: string;
}

export class VerifyTotpSetupDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6)
  token: string;
}

export class VerifyTotpLoginDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6)
  token: string;

  @ApiProperty({ example: 'backup-code-12345678', required: false })
  @IsString()
  @IsNotEmpty()
  backupCode?: string;
}

export class DisableTotpDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6)
  token: string;
}

