import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from './core/database.module';
import { CoreServicesModule } from './core/core-services.module';
import { AccessLogMiddleware } from './core/middleware/access-log.middleware';
import { AuthModule } from './auth/auth.module';
import { ClientsModule } from './clients/clients.module';
import { InvoicesModule } from './invoices/invoices.module';
import { PaymentsModule } from './payments/payments.module';
import { SyncModule } from './sync/sync.module';
import { HealthModule } from './health/health.module';
import { GdprModule } from './gdpr/gdpr.module';
import { FeedbackModule } from './feedback/feedback.module';
import { RecurringInvoicesModule } from './recurring-invoices/recurring-invoices.module';
import { InvoiceTemplatesModule } from './invoice-templates/invoice-templates.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { UserSettingsModule } from './user-settings/user-settings.module';
import { ConfigModule as PublicConfigModule } from './config/config.module';

@Module({
  imports: [
    // Register CacheModule as GLOBAL so CACHE_MANAGER is available to all modules
    CacheModule.registerAsync({
      isGlobal: true, // Make it global so CoreServicesModule can access CACHE_MANAGER
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService): any => {
        const redisHost = configService.get<string>('REDIS_HOST');
        const redisPort = configService.get<number>('REDIS_PORT') || 6379;
        const redisPassword = configService.get<string>('REDIS_PASSWORD');

        if (redisHost) {
          return {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            store: require('cache-manager-redis-store').redisStore,
            host: redisHost,
            port: Number(redisPort),
            password: redisPassword,
            ttl: 300,
          } as any;
        }

        return {
          ttl: 300,
          max: 100,
        };
      },
    }),
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    CoreServicesModule, // CacheModule must be registered before this
    AuthModule,
    ClientsModule,
    InvoicesModule,
    PaymentsModule,
    SyncModule,
    HealthModule,
    GdprModule,
    FeedbackModule,
    RecurringInvoicesModule,
    InvoiceTemplatesModule,
    ApiKeysModule,
    UserSettingsModule,
    PublicConfigModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply access log middleware to all routes
    consumer.apply(AccessLogMiddleware).forRoutes('*');
  }
}

