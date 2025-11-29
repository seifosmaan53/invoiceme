import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { PdfService } from './services/pdf.service';
import { S3Service } from './services/s3.service';
import { StripeService } from './services/stripe.service';
import { AuditService } from './services/audit.service';
import { EmailService } from './services/email.service';
import { CsvService } from './services/csv.service';
import { TotpService } from './services/totp.service';
import { NotificationService } from './services/notification.service';
import { LoggerService } from './services/logger.service';
import { CacheService } from './services/cache.service';
import { InvoiceNumberFormatterService } from './services/invoice-number-formatter.service';
import { EncryptionService } from './services/encryption.service';
import { GdprService } from './services/gdpr.service';
import { PdfCacheService } from './services/pdf-cache.service';
import { AuditLog } from '../entities/audit-log.entity';
import { User } from '../entities/user.entity';
import { Client } from '../entities/client.entity';
import { Invoice } from '../entities/invoice.entity';

@Global()
@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([AuditLog, User, Client, Invoice]),
    // CacheModule is registered as global in AppModule, so CACHE_MANAGER is available
    // No need to import CacheModule here since it's global
  ],
  providers: [AuditService, EmailService, PdfService, S3Service, StripeService, CsvService, TotpService, NotificationService, LoggerService, CacheService, InvoiceNumberFormatterService, EncryptionService, GdprService, PdfCacheService],
  exports: [AuditService, EmailService, PdfService, S3Service, StripeService, CsvService, TotpService, NotificationService, LoggerService, CacheService, InvoiceNumberFormatterService, EncryptionService, GdprService, PdfCacheService],
})
export class CoreServicesModule {}

