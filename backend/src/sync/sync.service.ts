import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, MoreThan } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { DeviceChange, ChangeType, ChangeObjectType } from '../entities/device-change.entity';
import { Client } from '../entities/client.entity';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceItem } from '../entities/invoice-item.entity';
import { Attachment } from '../entities/attachment.entity';

/**
 * Change object format for sync
 * Matches: {object_type, object_id, change_type, data, device_id, updated_at}
 */
export interface ChangeObject {
  object_type: ChangeObjectType;
  object_id: string;
  change_type: ChangeType;
  data: Record<string, any>;
  device_id: string;
  updated_at: string; // ISO 8601 timestamp
}

export class ChangeObjectDto {
  @ApiProperty({ description: 'Type of object (client, invoice, etc.)', example: 'client' })
  object_type: ChangeObjectType;

  @ApiProperty({ description: 'Unique identifier of the object', example: '123e4567-e89b-12d3-a456-426614174000' })
  object_id: string;

  @ApiProperty({ description: 'Type of change (create, update, delete)', example: 'create' })
  change_type: ChangeType;

  @ApiProperty({ description: 'Object data', example: { name: 'Acme Corp', email: 'contact@acme.com' } })
  data: Record<string, any>;

  @ApiProperty({ description: 'Device identifier', example: 'device-123' })
  device_id: string;

  @ApiProperty({ description: 'Timestamp of the change (ISO 8601)', example: '2025-11-23T10:00:00Z' })
  updated_at: string;
}

export class SyncPushDto {
  @ApiProperty({ description: 'Unique device identifier', example: 'mobile-device-abc123' })
  deviceId: string;

  @ApiProperty({ description: 'Array of changes to sync', type: [ChangeObjectDto] })
  changes: ChangeObject[];
}

export interface SyncPullResponse {
  clients: Client[];
  invoices: Invoice[];
  invoiceItems: InvoiceItem[];
  attachments: Attachment[];
  lastSyncTimestamp: string;
}

@Injectable()
export class SyncService {
  constructor(
    @InjectRepository(DeviceChange)
    private deviceChangeRepository: Repository<DeviceChange>,
    @InjectRepository(Client)
    private clientRepository: Repository<Client>,
    @InjectRepository(Invoice)
    private invoiceRepository: Repository<Invoice>,
    @InjectRepository(InvoiceItem)
    private invoiceItemRepository: Repository<InvoiceItem>,
    @InjectRepository(Attachment)
    private attachmentRepository: Repository<Attachment>,
  ) {}

  /**
   * Push changes from mobile device to server
   * Accepts array of changes in format: {object_type, object_id, change_type, data, device_id, updated_at}
   */
  async pushChanges(userId: string, syncPushDto: SyncPushDto): Promise<{ synced: number; failed: number }> {
    const deviceId = syncPushDto.deviceId;
    let syncedCount = 0;
    let failedCount = 0;

    // Process each change
    for (const changeObj of syncPushDto.changes) {
      try {
        // Create device change record
        const change = this.deviceChangeRepository.create({
          userId,
          deviceId: changeObj.device_id || deviceId,
          objectType: changeObj.object_type,
          objectId: changeObj.object_id,
          changeJson: changeObj.data,
          changeType: changeObj.change_type,
        });

        await this.deviceChangeRepository.save(change);

        // Process the change immediately
        await this.processChange(change);
        change.synced = true;
        await this.deviceChangeRepository.save(change);
        syncedCount++;
      } catch (error) {
        console.error(`Error processing change ${changeObj.object_id}:`, error);
        failedCount++;
      }
    }

    return { synced: syncedCount, failed: failedCount };
  }

  /**
   * Pull changes from server
   * Returns all entities updated after the given timestamp
   */
  async pullChanges(userId: string, since?: string): Promise<SyncPullResponse> {
    const sinceDate = since ? new Date(since) : new Date(0);

    // Fetch entities updated after the timestamp
    const [clients, invoices] = await Promise.all([
      this.clientRepository.find({
        where: {
          userId,
          deletedAt: null,
          updatedAt: MoreThan(sinceDate),
        },
        order: { updatedAt: 'ASC' },
      }),
      this.invoiceRepository.find({
        where: {
          userId,
          deletedAt: null,
          updatedAt: MoreThan(sinceDate),
        },
        relations: ['client'],
        order: { updatedAt: 'ASC' },
      }),
    ]);

    // Get invoice IDs for related data
    const invoiceIds = invoices.map((inv) => inv.id);
    const clientIds = clients.map((c) => c.id);

    // Get all invoice items for the returned invoices
    const invoiceItems = invoiceIds.length > 0
      ? await this.invoiceItemRepository.find({
          where: { invoiceId: In(invoiceIds) },
          order: { createdAt: 'ASC' },
        })
      : [];

    // Get attachments for invoices and clients
    const attachments = await this.attachmentRepository.find({
      where: [
        ...(invoiceIds.length > 0 ? [{ ownerType: 'invoice' as any, ownerId: In(invoiceIds) }] : []),
        ...(clientIds.length > 0 ? [{ ownerType: 'client' as any, ownerId: In(clientIds) }] : []),
      ],
      order: { createdAt: 'ASC' },
    });

    return {
      clients,
      invoices,
      invoiceItems,
      attachments,
      lastSyncTimestamp: new Date().toISOString(),
    };
  }

  private async processChange(change: DeviceChange): Promise<void> {
    switch (change.objectType) {
      case ChangeObjectType.CLIENT:
        await this.processClientChange(change);
        break;
      case ChangeObjectType.INVOICE:
        await this.processInvoiceChange(change);
        break;
      case ChangeObjectType.INVOICE_ITEM:
        await this.processInvoiceItemChange(change);
        break;
      case ChangeObjectType.ATTACHMENT:
        await this.processAttachmentChange(change);
        break;
    }
  }

  private async processClientChange(change: DeviceChange): Promise<void> {
    if (change.changeType === ChangeType.CREATE || change.changeType === ChangeType.UPDATE) {
      const existing = await this.clientRepository.findOne({
        where: { id: change.objectId },
      });

      if (existing) {
        // Update existing client
        Object.assign(existing, change.changeJson);
        existing.updatedAt = new Date();
        await this.clientRepository.save(existing);
      } else {
        // Create new client
        const client = this.clientRepository.create({
          id: change.objectId,
          userId: change.userId,
          ...change.changeJson,
        });
        await this.clientRepository.save(client);
      }
    } else if (change.changeType === ChangeType.DELETE) {
      const client = await this.clientRepository.findOne({
        where: { id: change.objectId },
      });
      if (client) {
        client.deletedAt = new Date();
        await this.clientRepository.save(client);
      }
    }
  }

  private async processInvoiceChange(change: DeviceChange): Promise<void> {
    if (change.changeType === ChangeType.CREATE || change.changeType === ChangeType.UPDATE) {
      const existing = await this.invoiceRepository.findOne({
        where: { id: change.objectId },
      });

      if (existing) {
        // Update existing invoice
        Object.assign(existing, change.changeJson);
        existing.updatedAt = new Date();
        await this.invoiceRepository.save(existing);
      } else {
        // Create new invoice
        const invoice = this.invoiceRepository.create({
          id: change.objectId,
          userId: change.userId,
          ...change.changeJson,
        });
        await this.invoiceRepository.save(invoice);
      }
    } else if (change.changeType === ChangeType.DELETE) {
      const invoice = await this.invoiceRepository.findOne({
        where: { id: change.objectId },
      });
      if (invoice) {
        invoice.deletedAt = new Date();
        await this.invoiceRepository.save(invoice);
      }
    }
  }

  private async processInvoiceItemChange(change: DeviceChange): Promise<void> {
    if (change.changeType === ChangeType.CREATE || change.changeType === ChangeType.UPDATE) {
      const existing = await this.invoiceItemRepository.findOne({
        where: { id: change.objectId },
      });

      if (existing) {
        Object.assign(existing, change.changeJson);
        await this.invoiceItemRepository.save(existing);
      } else {
        const item = this.invoiceItemRepository.create({
          id: change.objectId,
          ...change.changeJson,
        });
        await this.invoiceItemRepository.save(item);
      }
    } else if (change.changeType === ChangeType.DELETE) {
      await this.invoiceItemRepository.delete(change.objectId);
    }
  }

  private async processAttachmentChange(change: DeviceChange): Promise<void> {
    if (change.changeType === ChangeType.CREATE || change.changeType === ChangeType.UPDATE) {
      const existing = await this.attachmentRepository.findOne({
        where: { id: change.objectId },
      });

      if (existing) {
        Object.assign(existing, change.changeJson);
        await this.attachmentRepository.save(existing);
      } else {
        const attachment = this.attachmentRepository.create({
          id: change.objectId,
          ...change.changeJson,
        });
        await this.attachmentRepository.save(attachment);
      }
    } else if (change.changeType === ChangeType.DELETE) {
      await this.attachmentRepository.delete(change.objectId);
    }
  }
}

