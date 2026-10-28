import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { SyncConflictsService } from './sync-conflicts.service';
import { SyncSchemaService } from './sync-schema.service';
import { SyncMaintenanceService } from './sync-maintenance.service';
import { SYNC_CONFIG, readSyncConfig } from './sync-config';
import { DeviceChange } from '../entities/device-change.entity';
import { Client } from '../entities/client.entity';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceItem } from '../entities/invoice-item.entity';
import { Attachment } from '../entities/attachment.entity';
import { SyncConflict } from '../entities/sync-conflict.entity';
import { SyncTombstone } from '../entities/sync-tombstone.entity';
import { SyncRecordRevision } from '../entities/sync-record-revision.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DeviceChange,
      Client,
      Invoice,
      InvoiceItem,
      Attachment,
      SyncConflict,
      SyncTombstone,
      SyncRecordRevision,
    ]),
  ],
  controllers: [SyncController],
  providers: [
    // Read at startup: an invalid SYNC_* value stops the server.
    { provide: SYNC_CONFIG, useFactory: () => readSyncConfig() },
    SyncService,
    SyncConflictsService,
    SyncSchemaService,
    SyncMaintenanceService,
  ],
  exports: [SyncService],
})
export class SyncModule {}
