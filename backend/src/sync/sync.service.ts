import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, MoreThan } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsNotEmpty, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { DeviceChange, ChangeType, ChangeObjectType } from '../entities/device-change.entity';
import { Client } from '../entities/client.entity';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceItem } from '../entities/invoice-item.entity';
import { Attachment, AttachmentOwnerType } from '../entities/attachment.entity';

/** Fields a device may never set: the primary key comes from object_id, the owner from the JWT. */
const PROTECTED_FIELDS = ['id', 'userId'];

/**
 * A change that targets, or references, data the authenticated user does not
 * own. It is not applied and is counted in `failed`, like any other rejected
 * change. (A failure on an id that would otherwise be a fresh create or a
 * no-op delete still shows the id exists; ids are random UUIDs.)
 */
export class SyncOwnershipError extends Error {}

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
  @IsEnum(ChangeObjectType)
  object_type: ChangeObjectType;

  @ApiProperty({ description: 'Unique identifier of the object', example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsString()
  @IsNotEmpty()
  object_id: string;

  @ApiProperty({ description: 'Type of change (create, update, delete)', example: 'create' })
  @IsEnum(ChangeType)
  change_type: ChangeType;

  @ApiProperty({ description: 'Object data', example: { name: 'Acme Corp', email: 'contact@acme.com' } })
  @IsObject()
  data: Record<string, any>;

  @ApiProperty({ description: 'Device identifier', example: 'device-123' })
  @IsOptional()
  @IsString()
  device_id: string;

  @ApiProperty({ description: 'Timestamp of the change (ISO 8601)', example: '2025-11-23T10:00:00Z' })
  @IsOptional()
  @IsString()
  updated_at: string;
}

export class SyncPushDto {
  @ApiProperty({ description: 'Unique device identifier', example: 'mobile-device-abc123' })
  @IsString()
  @IsNotEmpty()
  deviceId: string;

  @ApiProperty({ description: 'Array of changes to sync', type: [ChangeObjectDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChangeObjectDto)
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
   *
   * The owner of every created or modified record is always `userId` (the
   * authenticated user). Changes that target or reference another user's data
   * are not applied and are counted in `failed`.
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
        await this.processChange(change, userId);
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

    // Push now rejects cross-owner client references, but rows written before
    // that check may still point at another user's client: never embed it.
    for (const invoice of invoices) {
      if (invoice.client && invoice.client.userId !== userId) {
        invoice.client = null;
      }
    }

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

  private async processChange(change: DeviceChange, userId: string): Promise<void> {
    switch (change.objectType) {
      case ChangeObjectType.CLIENT:
        await this.processClientChange(change, userId);
        break;
      case ChangeObjectType.INVOICE:
        await this.processInvoiceChange(change, userId);
        break;
      case ChangeObjectType.INVOICE_ITEM:
        await this.processInvoiceItemChange(change, userId);
        break;
      case ChangeObjectType.ATTACHMENT:
        await this.processAttachmentChange(change, userId);
        break;
    }
  }

  /**
   * Keep only real columns of the entity from client-supplied data, minus the
   * primary key and owner. Relation objects (e.g. `client`, `invoice`) are
   * dropped too, so foreign keys can only change through their id column,
   * which the callers validate.
   */
  private writableFields<T>(repository: Repository<T>, data: Record<string, any>): Record<string, any> {
    const columns = new Set(repository.metadata.columns.map((column) => column.propertyName));
    return Object.fromEntries(
      Object.entries(data || {}).filter(([key]) => columns.has(key) && !PROTECTED_FIELDS.includes(key)),
    );
  }

  /**
   * A record that is not visible to the user may still exist for another user.
   * Deleting a record that does not exist anywhere stays a no-op (idempotent
   * retries); touching someone else's record is rejected.
   */
  private async assertNotOwnedByOther<T>(repository: Repository<T>, id: string): Promise<void> {
    if (await repository.exists({ where: { id } as any })) {
      throw new SyncOwnershipError(`${repository.metadata.tableName} ${id} does not belong to the user`);
    }
  }

  private async assertOwnedClient(clientId: string, userId: string): Promise<void> {
    if (!clientId || !(await this.clientRepository.exists({ where: { id: clientId, userId } }))) {
      throw new SyncOwnershipError(`client ${clientId} does not belong to the user`);
    }
  }

  private async assertOwnedInvoice(invoiceId: string, userId: string): Promise<void> {
    if (!invoiceId || !(await this.invoiceRepository.exists({ where: { id: invoiceId, userId } }))) {
      throw new SyncOwnershipError(`invoice ${invoiceId} does not belong to the user`);
    }
  }

  private async assertOwnedAttachmentOwner(ownerType: string, ownerId: string, userId: string): Promise<void> {
    if (ownerType === AttachmentOwnerType.INVOICE) {
      await this.assertOwnedInvoice(ownerId, userId);
    } else if (ownerType === AttachmentOwnerType.CLIENT) {
      await this.assertOwnedClient(ownerId, userId);
    } else {
      throw new SyncOwnershipError(`unsupported attachment owner type ${ownerType}`);
    }
  }

  private async processClientChange(change: DeviceChange, userId: string): Promise<void> {
    const existing = await this.clientRepository.findOne({
      where: { id: change.objectId, userId },
    });

    if (change.changeType === ChangeType.DELETE) {
      if (existing) {
        existing.deletedAt = new Date();
        await this.clientRepository.save(existing);
      } else {
        await this.assertNotOwnedByOther(this.clientRepository, change.objectId);
      }
      return;
    }

    const data = this.writableFields(this.clientRepository, change.changeJson);
    if (existing) {
      // Update existing client
      Object.assign(existing, data);
      existing.updatedAt = new Date();
      await this.clientRepository.save(existing);
    } else {
      // Create new client. insert() (not save()) so an id that already exists
      // for another user fails instead of being treated as an update.
      await this.clientRepository.insert({ ...data, id: change.objectId, userId });
    }
  }

  private async processInvoiceChange(change: DeviceChange, userId: string): Promise<void> {
    const existing = await this.invoiceRepository.findOne({
      where: { id: change.objectId, userId },
    });

    if (change.changeType === ChangeType.DELETE) {
      if (existing) {
        existing.deletedAt = new Date();
        await this.invoiceRepository.save(existing);
      } else {
        await this.assertNotOwnedByOther(this.invoiceRepository, change.objectId);
      }
      return;
    }

    const data = this.writableFields(this.invoiceRepository, change.changeJson);
    if (!existing || 'clientId' in data) {
      await this.assertOwnedClient(data.clientId, userId);
    }

    if (existing) {
      // Update existing invoice. Drop the eagerly loaded client so a changed
      // clientId is not overridden by the old relation on save.
      Object.assign(existing, data);
      if ('clientId' in data) {
        existing.client = undefined;
      }
      existing.updatedAt = new Date();
      await this.invoiceRepository.save(existing);
    } else {
      // Create new invoice
      await this.invoiceRepository.insert({ ...data, id: change.objectId, userId });
    }
  }

  private async processInvoiceItemChange(change: DeviceChange, userId: string): Promise<void> {
    const existing = await this.invoiceItemRepository
      .createQueryBuilder('item')
      .innerJoin('item.invoice', 'invoice')
      .where('item.id = :id', { id: change.objectId })
      .andWhere('invoice.userId = :userId', { userId })
      .getOne();

    if (change.changeType === ChangeType.DELETE) {
      if (existing) {
        await this.invoiceItemRepository.delete(existing.id);
      } else {
        await this.assertNotOwnedByOther(this.invoiceItemRepository, change.objectId);
      }
      return;
    }

    const data = this.writableFields(this.invoiceItemRepository, change.changeJson);
    if (!existing || 'invoiceId' in data) {
      await this.assertOwnedInvoice(data.invoiceId, userId);
    }

    if (existing) {
      Object.assign(existing, data);
      await this.invoiceItemRepository.save(existing);
    } else {
      await this.invoiceItemRepository.insert({ ...data, id: change.objectId });
    }
  }

  private async processAttachmentChange(change: DeviceChange, userId: string): Promise<void> {
    const existing = await this.attachmentRepository.findOne({
      where: { id: change.objectId },
    });
    if (existing) {
      await this.assertOwnedAttachmentOwner(existing.ownerType, existing.ownerId, userId);
    }

    if (change.changeType === ChangeType.DELETE) {
      if (existing) {
        await this.attachmentRepository.delete(existing.id);
      }
      return;
    }

    const data = this.writableFields(this.attachmentRepository, change.changeJson);
    if (!existing || 'ownerType' in data || 'ownerId' in data) {
      await this.assertOwnedAttachmentOwner(
        data.ownerType ?? existing?.ownerType,
        data.ownerId ?? existing?.ownerId,
        userId,
      );
    }

    if (existing) {
      Object.assign(existing, data);
      await this.attachmentRepository.save(existing);
    } else {
      await this.attachmentRepository.insert({ ...data, id: change.objectId });
    }
  }
}
