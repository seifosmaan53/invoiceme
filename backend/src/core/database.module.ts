import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { User } from '../entities/user.entity';
import { Client } from '../entities/client.entity';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceItem } from '../entities/invoice-item.entity';
import { Attachment } from '../entities/attachment.entity';
import { Payment } from '../entities/payment.entity';
import { DeviceChange } from '../entities/device-change.entity';
import { RefreshToken } from '../entities/refresh-token.entity';
import { PasswordResetToken } from '../entities/password-reset-token.entity';
import { AuditLog } from '../entities/audit-log.entity';
import { Feedback } from '../entities/feedback.entity';
import { InvoiceTemplate } from '../entities/invoice-template.entity';
import { RecurringInvoice } from '../entities/recurring-invoice.entity';
import { ApiKey } from '../entities/api-key.entity';
import { UserSettings } from '../entities/user-settings.entity';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('DB_HOST'),
        port: configService.get('DB_PORT'),
        username: configService.get('DB_USERNAME'),
        password: configService.get('DB_PASSWORD'),
        database: configService.get('DB_DATABASE'),
        entities: [
          User,
          Client,
          Invoice,
          InvoiceItem,
          Attachment,
          Payment,
          DeviceChange,
          RefreshToken,
          PasswordResetToken,
          AuditLog,
          Feedback,
          InvoiceTemplate,
          RecurringInvoice,
          ApiKey,
          UserSettings,
        ],
        synchronize: false,
        logging: true,
      }),
      inject: [ConfigService],
    }),
  ],
})
export class DatabaseModule {}
