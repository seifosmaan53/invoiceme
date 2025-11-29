import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { DeviceChange } from '../entities/device-change.entity';
import { Client } from '../entities/client.entity';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceItem } from '../entities/invoice-item.entity';
import { Attachment } from '../entities/attachment.entity';

@Module({
  imports: [TypeOrmModule.forFeature([DeviceChange, Client, Invoice, InvoiceItem, Attachment])],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}

