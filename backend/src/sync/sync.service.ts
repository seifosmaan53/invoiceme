import { isDeepStrictEqual } from 'util';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, MoreThan, EntityManager, IsNull } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { DeviceChange, ChangeType, ChangeObjectType } from '../entities/device-change.entity';
import { Client } from '../entities/client.entity';
import { Invoice, InvoiceStatus } from '../entities/invoice.entity';
import { InvoiceItem } from '../entities/invoice-item.entity';
import { Attachment, AttachmentOwnerType } from '../entities/attachment.entity';
import { SyncConflict, SyncConflictKind, SyncConflictStatus } from '../entities/sync-conflict.entity';
import { SyncTombstone } from '../entities/sync-tombstone.entity';
import { SyncRecordRevision } from '../entities/sync-record-revision.entity';
import { withoutForeignClient, withoutForeignSyncHistory } from '../core/utils/cross-owner.util';
import { assertValidAttachmentUrl, withValidAttachmentUrls } from '../common/attachment-url';
import { toCalendarDate } from '../common/calendar-date';
import { conflictFields } from './conflict-fields';
import { SYNC_CONFIG, SyncConfig } from './sync-config';
import { SyncSchemaService } from './sync-schema.service';
import { decodeCursor, encodeCursor, PullCursor } from './sync-pull-cursor';

/**
 * Fields a device may never set: the primary key comes from object_id, the
 * owner from the JWT, the revision from the database, and deletes and restores
 * go through delete changes and conflict resolution, never through deletedAt.
 */
const PROTECTED_FIELDS = ['id', 'userId', 'revision', 'deletedAt', 'createdAt', 'updatedAt'];

/** Invoices whose content is not merged or overwritten by a stale offline write. */
export const PROTECTED_INVOICE_STATUSES: ReadonlySet<string> = new Set([
  InvoiceStatus.SENT,
  InvoiceStatus.OVERDUE,
  InvoiceStatus.PAID,
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Record types with server revisions (attachments are created and deleted, not edited). */
const VERSIONED_TYPES: ReadonlySet<string> = new Set([
  ChangeObjectType.CLIENT,
  ChangeObjectType.INVOICE,
  ChangeObjectType.INVOICE_ITEM,
]);

/**
 * A change that targets, or references, data the authenticated user does not
 * own. It is not applied and is reported `failed`, like any other rejected
 * change. (A failure on an id that would otherwise be a fresh create or a
 * no-op delete still shows the id exists; ids are random UUIDs.)
 */
export class SyncOwnershipError extends Error {}

/**
 * Change object format for sync
 * Matches: {change_id?, base_revision?, object_type, object_id, change_type, data, device_id, updated_at}
 */
export interface ChangeObject {
  change_id?: string;
  base_revision?: number;
  parent_revision?: number;
  object_type: ChangeObjectType;
  object_id: string;
  change_type: ChangeType;
  data: Record<string, any>;
  device_id: string;
  updated_at: string; // ISO 8601 timestamp; informational only, never decides which write wins
}

export class ChangeObjectDto {
  @ApiProperty({
    description:
      'Idempotency key, unique per change on the device. A change_id is processed at most once per user; ' +
      'resending it returns the first outcome ("duplicate", or "conflict" with the same conflict_id). Required in protocol 2.',
    example: '0f8fad5b-d9cb-469f-a165-70867728950e',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  change_id?: string;

  @ApiProperty({
    description:
      'Protocol 2: the server revision of the record the device edited (from pull). Required for update and delete; ' +
      'omit (or 0) for create.',
    example: 3,
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  base_revision?: number;

  @ApiProperty({
    description:
      'Protocol 2, invoice_item changes: the revision of the item\'s invoice (the target invoice for a move) as the ' +
      'device last saw it. Required for an item change on a sent, overdue or paid invoice to apply.',
    example: 4,
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  parent_revision?: number;

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

  @ApiProperty({
    description: 'Object data. In protocol 2 an update carries only the fields the user changed.',
    example: { name: 'Acme Corp', email: 'contact@acme.com' },
  })
  @IsObject()
  data: Record<string, any>;

  @ApiProperty({ description: 'Device identifier', example: 'device-123' })
  @IsOptional()
  @IsString()
  device_id: string;

  @ApiProperty({ description: 'Device time of the change (ISO 8601); not used to decide conflicts', example: '2025-11-23T10:00:00Z' })
  @IsOptional()
  @IsString()
  updated_at: string;
}

export class SyncPushDto {
  @ApiProperty({
    description: 'Sync protocol. 2 = revisions and conflicts (docs/SYNC-CONTRACT.md); omitted = 1 (older apps).',
    example: 2,
    required: false,
  })
  @IsOptional()
  @IsIn([1, 2])
  protocol?: number;

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

/**
 * - applied: applied by this request (protocol 1: applied as sent, without a concurrency check).
 * - merged: protocol 2, the record had changed on the server, but only on other fields; the device's fields were applied.
 * - duplicate: this change_id was already applied earlier; not applied again.
 * - conflict: protocol 2, not applied; kept for the owner to resolve (conflict_id). Do not resend.
 * - failed: not applied (rejected or invalid). Resending it retries it; `reason` says why when it is not an ownership check.
 */
export type ChangeStatus = 'applied' | 'merged' | 'duplicate' | 'conflict' | 'failed';

export interface ChangeResult {
  /** Position of the change in the request's `changes` array. */
  index: number;
  change_id: string | null;
  object_type: ChangeObjectType;
  object_id: string;
  status: ChangeStatus;
  reason?: string;
  conflict_id?: string;
  /** Protocol 2: the record's revision after this change (applied, merged). */
  revision?: number;
}

export interface SyncPushResponse {
  protocol: number;
  /** applied + merged + duplicate. Kept for clients that only read the counts. */
  synced: number;
  /** failed + conflict: changes that were not applied. */
  failed: number;
  /** One entry per change, in request order. */
  results: ChangeResult[];
  /** Set when every change was refused because this client must be updated. */
  notice?: string;
  message?: string;
}

export interface SyncTombstoneDto {
  object_type: string;
  object_id: string;
  deleted_at: string;
}

export interface SyncPullResponse {
  protocol: number;
  clients: Client[];
  invoices: Invoice[];
  invoiceItems: InvoiceItem[];
  attachments: Attachment[];
  /** Records deleted after `since` (protocol 2 clients remove them locally). */
  tombstones: SyncTombstoneDto[];
  /** `since` is older than the retained tombstones: drop local data and pull everything. */
  fullResyncRequired: boolean;
  /** Open conflicts of this user (protocol 2 clients show them). */
  openConflicts: number;
  lastSyncTimestamp: string;
}

/** A protocol-2 pull page (pullByCursor). */
export interface SyncPullPage extends SyncPullResponse {
  /** Send it with the next request: the next page while hasMore, else the next pull. */
  cursor: string | null;
  hasMore: boolean;
}

/** Order in which a cursor pull walks the record types. */
const PULL_TYPES = [
  ChangeObjectType.CLIENT,
  ChangeObjectType.INVOICE,
  ChangeObjectType.INVOICE_ITEM,
  ChangeObjectType.ATTACHMENT,
  'tombstone',
] as const;

const emptyPage = () => ({
  protocol: 2,
  clients: [] as Client[],
  invoices: [] as Invoice[],
  invoiceItems: [] as InvoiceItem[],
  attachments: [] as Attachment[],
  tombstones: [] as SyncTombstoneDto[],
});

interface Outcome {
  status: ChangeStatus;
  reason?: string;
  conflictId?: string;
  revision?: number;
}

const failed = (reason?: string): Outcome => ({ status: 'failed', reason });

export const UPGRADE_REQUIRED = 'client_upgrade_required';
/**
 * Any failure not explained by a more specific reason: another user's record
 * or reference, invalid data, a database error. One reason for all of them, so
 * an ownership failure stays indistinguishable from the rest, while clients
 * can still count repeated failures and stop resending.
 */
export const REJECTED = 'rejected';
/** A temporary server or database failure: nothing was applied; send the same change again later. */
export const RETRY_LATER = 'retry_later';

/** PostgreSQL error classes after which the same change can succeed unchanged. */
const TRANSIENT_SQLSTATES = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '55P03', // lock_not_available
  '57014', // query_canceled (e.g. statement_timeout)
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '53000', // insufficient_resources
  '53100', // disk_full
  '53200', // out_of_memory
  '53300', // too_many_connections
]);

/** Whether a failure is temporary (retry_later) rather than a rejection of the change itself. */
export function isTransientFailure(error: any): boolean {
  const code = error?.driverError?.code ?? error?.code;
  if (typeof code === 'string' && (TRANSIENT_SQLSTATES.has(code) || code.startsWith('08'))) return true;
  if (['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE'].includes(code)) return true;
  // node-postgres raises these without a code: a dropped connection, or no
  // pool connection free within the timeout
  const message = String(error?.driverError?.message ?? error?.message ?? '');
  return /Connection terminated|timeout exceeded when trying to connect|Client has encountered a connection error|Connection is not established/i.test(message);
}

const failureReason = (error: unknown) => (isTransientFailure(error) ? RETRY_LATER : REJECTED);

@Injectable()
export class SyncService {
  /** Set by bindTo: the transaction this instance's repositories belong to. */
  private manager?: EntityManager;

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
    @InjectRepository(SyncConflict)
    private conflictRepository: Repository<SyncConflict>,
    @InjectRepository(SyncTombstone)
    private tombstoneRepository: Repository<SyncTombstone>,
    @InjectRepository(SyncRecordRevision)
    private revisionRepository: Repository<SyncRecordRevision>,
    @Inject(SYNC_CONFIG) private readonly config: SyncConfig,
    private readonly schema: SyncSchemaService,
  ) {}

  /** Protocol-1 writes are refused once SYNC_LEGACY_WRITE_CUTOFF has passed. */
  legacyWritesRefused(now = new Date()): boolean {
    return this.config.legacyWriteCutoff !== null && now >= this.config.legacyWriteCutoff;
  }

  /**
   * Push changes from mobile device to server.
   *
   * The owner of every created or modified record is always `userId` (the
   * authenticated user). Changes are processed in array order, each in its own
   * transaction, and a failure or conflict does not stop the rest of the
   * batch. See docs/SYNC-CONTRACT.md.
   */
  async pushChanges(userId: string, syncPushDto: SyncPushDto): Promise<SyncPushResponse> {
    await this.schema.assertReady();
    const protocol = syncPushDto.protocol === 2 ? 2 : 1;
    const results: ChangeResult[] = [];
    const refuseLegacy = protocol === 1 && this.legacyWritesRefused();

    for (const [index, changeObj] of syncPushDto.changes.entries()) {
      let outcome: Outcome;
      if (refuseLegacy) {
        outcome = failed(UPGRADE_REQUIRED);
      } else {
        try {
          outcome = await this.pushChange(userId, syncPushDto.deviceId, changeObj, protocol);
        } catch (error) {
          console.error(`Error processing change ${changeObj.object_id}:`, error);
          outcome = failed(failureReason(error));
        }
      }
      results.push({
        index,
        change_id: changeObj.change_id ?? null,
        object_type: changeObj.object_type,
        object_id: changeObj.object_id,
        status: outcome.status,
        ...(outcome.reason ? { reason: outcome.reason } : {}),
        ...(outcome.conflictId ? { conflict_id: outcome.conflictId } : {}),
        ...(outcome.revision !== undefined ? { revision: outcome.revision } : {}),
      });
    }

    const notApplied = results.filter((result) => result.status === 'failed' || result.status === 'conflict').length;
    return {
      protocol,
      synced: results.length - notApplied,
      failed: notApplied,
      results,
      ...(refuseLegacy
        ? {
            notice: UPGRADE_REQUIRED,
            message: 'This version of the app can no longer send changes. Update the app to sync; your data can still be viewed.',
          }
        : {}),
    };
  }

  /**
   * Record and apply one change in a single transaction.
   *
   * The device_changes row is kept even when applying fails (the change is
   * rolled back to a savepoint), so a resend of the same change_id retries it.
   * A change_id that was already processed gets its first outcome again
   * without touching any record: duplicate, or conflict with the same id.
   */
  private async pushChange(userId: string, deviceId: string, changeObj: ChangeObject, protocol: number): Promise<Outcome> {
    const invalid = this.validate(changeObj, protocol);
    if (invalid) return failed(invalid);

    return this.deviceChangeRepository.manager.transaction(async (manager) => {
      // Changes to the same object run one after another, whatever request
      // they arrive in; conflict resolution takes the same lock.
      await this.lockObject(manager, changeObj.object_type, changeObj.object_id);

      const change = await this.recordChange(manager, userId, deviceId, changeObj);
      if (!change) {
        return failed('change_id_reused');
      }
      if (change.synced) {
        return change.outcome === 'conflict'
          ? { status: 'conflict', conflictId: change.conflictId ?? undefined }
          : { status: 'duplicate' };
      }

      await manager.query('SAVEPOINT sync_apply');
      let outcome: Outcome;
      try {
        outcome = await this.bindTo(manager).processChange(change, userId, protocol);
      } catch (error) {
        await manager.query('ROLLBACK TO SAVEPOINT sync_apply');
        if (isTransientFailure(error)) throw error; // the transaction is unusable: roll it back whole (retry_later)
        console.error(`Error processing change ${changeObj.object_id}:`, error);
        return failed(REJECTED);
      }
      if (outcome.status === 'failed') {
        await manager.query('ROLLBACK TO SAVEPOINT sync_apply');
        return outcome;
      }
      await manager.update(DeviceChange, change.id, {
        synced: true,
        outcome: outcome.status,
        conflictId: outcome.conflictId ?? null,
      });
      return outcome;
    });
  }

  private validate(changeObj: ChangeObject, protocol: number): string | null {
    if (!UUID.test(changeObj.object_id)) return 'invalid_object_id';
    if (protocol !== 2) return null;
    if (!changeObj.change_id) return 'change_id_required';
    const versioned = VERSIONED_TYPES.has(changeObj.object_type);
    if (versioned && changeObj.change_type !== ChangeType.CREATE && !(changeObj.base_revision >= 1)) {
      return 'base_revision_required';
    }
    return null;
  }

  /** Transaction-scoped lock shared by push and conflict resolution. */
  async lockObject(manager: EntityManager, objectType: string, objectId: string): Promise<void> {
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`sync:${objectType}:${objectId}`]);
  }

  /**
   * The device_changes row for this change, locked for the transaction.
   * Without a change_id a new row is written every time (old clients).
   * With one, an existing row for the same user and change_id is reused; it
   * must describe the same change, otherwise null is returned (rejected).
   */
  private async recordChange(
    manager: EntityManager,
    userId: string,
    deviceId: string,
    changeObj: ChangeObject,
  ): Promise<DeviceChange | null> {
    const repository = manager.getRepository(DeviceChange);
    const values = {
      userId,
      changeId: changeObj.change_id ?? null,
      deviceId: changeObj.device_id || deviceId,
      objectType: changeObj.object_type,
      objectId: changeObj.object_id,
      changeJson: changeObj.data,
      changeType: changeObj.change_type,
      baseRevision: changeObj.base_revision ?? null,
      parentRevision: changeObj.parent_revision ?? null,
    };

    if (!changeObj.change_id) {
      const change = repository.create(values);
      await repository.save(change);
      return change;
    }

    // A concurrent insert of the same change_id waits on the unique index here.
    await repository.createQueryBuilder().insert().values(values).orIgnore().execute();
    const change = await repository.findOne({
      where: { userId, changeId: changeObj.change_id },
      lock: { mode: 'pessimistic_write' },
    });
    const sameChange =
      change.objectType === changeObj.object_type &&
      change.objectId === changeObj.object_id &&
      change.changeType === changeObj.change_type &&
      (change.baseRevision ?? null) === (changeObj.base_revision ?? null) &&
      (change.parentRevision ?? null) === (changeObj.parent_revision ?? null) &&
      isDeepStrictEqual(change.changeJson, changeObj.data);
    if (!sameChange) {
      console.error(`Change ${changeObj.change_id} was already recorded with different contents`);
      return null;
    }
    return change;
  }

  /**
   * This service with its repositories bound to `manager`, so that the
   * process*Change methods below run inside the caller's transaction.
   */
  bindTo(manager: EntityManager): this {
    return Object.assign(Object.create(this), {
      manager,
      deviceChangeRepository: manager.getRepository(DeviceChange),
      clientRepository: manager.getRepository(Client),
      invoiceRepository: manager.getRepository(Invoice),
      invoiceItemRepository: manager.getRepository(InvoiceItem),
      attachmentRepository: manager.getRepository(Attachment),
      conflictRepository: manager.getRepository(SyncConflict),
      tombstoneRepository: manager.getRepository(SyncTombstone),
      revisionRepository: manager.getRepository(SyncRecordRevision),
    });
  }

  /**
   * Pull changes from server
   * Returns all entities updated after the given timestamp, and the records
   * deleted after it.
   */
  async pullChanges(userId: string, since?: string): Promise<SyncPullResponse> {
    const sinceDate = since ? new Date(since) : new Date(0);
    const horizon = new Date(Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000);
    const fullResyncRequired = !!since && !isNaN(sinceDate.getTime()) && sinceDate < horizon;
    const lastSyncTimestamp = new Date().toISOString();

    // Fetch entities updated after the timestamp
    const [clients, invoices] = await Promise.all([
      this.clientRepository.find({
        where: {
          userId,
          deletedAt: IsNull(),
          updatedAt: MoreThan(sinceDate),
        },
        order: { updatedAt: 'ASC' },
      }),
      this.invoiceRepository.find({
        where: {
          userId,
          deletedAt: IsNull(),
          updatedAt: MoreThan(sinceDate),
        },
        relations: ['client'],
        order: { updatedAt: 'ASC' },
      }),
    ]);

    // Push now rejects cross-owner client references, but rows written before
    // that check may still point at another user's client: never embed it.
    invoices.forEach(withoutForeignClient);

    // Get invoice IDs for related data
    const invoiceIds = invoices.map((inv) => inv.id);
    const clientIds = clients.map((c) => c.id);

    // Get all invoice items for the returned invoices. Items and attachments
    // another user created or re-pointed through the old push are left out.
    // Items also come back on their own when they were created or changed
    // after `since` (their invoice's updatedAt does not move then).
    const itemsOfInvoices =
      invoiceIds.length > 0
        ? await this.invoiceItemRepository.find({ where: { invoiceId: In(invoiceIds) }, order: { createdAt: 'ASC' } })
        : [];
    const changedItems = await this.invoiceItemRepository
      .createQueryBuilder('item')
      .innerJoin('item.invoice', 'invoice')
      .where('invoice.userId = :userId AND invoice.deletedAt IS NULL', { userId })
      .andWhere(
        `(item.createdAt > :since OR item.id::text IN (
           SELECT r.object_id FROM sync_record_revisions r WHERE r.object_type = 'invoice_item' AND r.created_at > :since))`,
        { since: sinceDate },
      )
      .orderBy('item.createdAt', 'ASC')
      .getMany();
    const seen = new Set(itemsOfInvoices.map((item) => item.id));
    const invoiceItems = await withoutForeignSyncHistory(
      this.deviceChangeRepository.manager,
      ChangeObjectType.INVOICE_ITEM,
      [...itemsOfInvoices, ...changedItems.filter((item) => !seen.has(item.id))],
      userId,
    );

    // Get attachments for invoices and clients
    // Historical rows with invalid URLs are left out (stored data unchanged); see common/attachment-url.ts.
    const attachments = withValidAttachmentUrls(
      await withoutForeignSyncHistory(
      this.deviceChangeRepository.manager,
      ChangeObjectType.ATTACHMENT,
      await this.attachmentRepository.find({
        where: [
          ...(invoiceIds.length > 0 ? [{ ownerType: 'invoice' as any, ownerId: In(invoiceIds) }] : []),
          ...(clientIds.length > 0 ? [{ ownerType: 'client' as any, ownerId: In(clientIds) }] : []),
        ],
        order: { createdAt: 'ASC' },
      }),
      userId,
      ),
    );

    const tombstones = await this.tombstoneRepository.find({
      where: { userId, deletedAt: MoreThan(sinceDate) },
      order: { deletedAt: 'ASC' },
    });
    const openConflicts = await this.conflictRepository.count({ where: { userId, status: SyncConflictStatus.OPEN } });

    return {
      protocol: 2,
      clients,
      invoices,
      invoiceItems,
      attachments,
      tombstones: tombstones.map((t) => ({
        object_type: t.objectType,
        object_id: t.objectId,
        deleted_at: t.deletedAt.toISOString(),
      })),
      fullResyncRequired,
      openConflicts,
      lastSyncTimestamp,
    };
  }

  /**
   * Protocol-2 pull by snapshot cursor (sync-pull-cursor.ts; docs
   * "Delivery guarantee"): paged, every committed change delivered.
   */
  async pullByCursor(userId: string, token: string | undefined, limitRaw?: number): Promise<SyncPullPage> {
    await this.schema.assertReady(); // change_txid and its triggers (migration 021)
    const limit = Math.min(Math.max(Number.isInteger(limitRaw) ? (limitRaw as number) : 500, 1), 1000);
    const now = new Date();
    let from: string | null = null;
    let upto: string;
    let type = 0;
    let after: string | null = null;
    let issued = now.toISOString();
    const openConflicts = await this.conflictRepository.count({ where: { userId, status: SyncConflictStatus.OPEN } });

    const cursor = token ? decodeCursor(token) : null;
    if (cursor) await this.assertValidSnapshots([cursor.snap, cursor.from, cursor.upto]);
    const known = cursor?.upto ?? cursor?.snap;
    if (known) {
      // A cursor from ahead of this database's transaction counter means the
      // database was restored or replaced since (new transactions could reuse
      // ids the cursor counts as delivered): start over.
      const [{ ahead }] = await this.deviceChangeRepository.manager.query(
        'SELECT pg_snapshot_xmax($1::pg_snapshot) > pg_snapshot_xmax(pg_current_snapshot()) AS ahead',
        [known],
      );
      if (ahead) {
        return { ...emptyPage(), fullResyncRequired: true, openConflicts, lastSyncTimestamp: issued, cursor: null, hasMore: false };
      }
    }
    if (cursor?.upto) {
      ({ from = null, upto, t: type = 0, after = null, issued } = cursor as Required<PullCursor>);
    } else {
      if (cursor?.snap) {
        const horizon = now.getTime() - this.config.retentionDays * 86_400_000;
        if (Date.parse(cursor.issued) < horizon) {
          // Tombstones older than this cursor may be pruned: start over.
          return { ...emptyPage(), fullResyncRequired: true, openConflicts, lastSyncTimestamp: issued, cursor: null, hasMore: false };
        }
        from = cursor.snap;
      }
      upto = (await this.deviceChangeRepository.manager.query('SELECT pg_current_snapshot()::text AS s'))[0].s;
    }

    const page = emptyPage();
    let remaining = limit;
    let next: { t: number; after: string } | null = null;
    for (let t = type; t < PULL_TYPES.length; t++) {
      const rows = await this.pullRows(t, userId, from, upto, t === type ? after : null, remaining);
      const lastKey: string | undefined = rows[rows.length - 1]?.__key; // before addToPage strips it
      await this.addToPage(page, t, rows, userId);
      if (rows.length === remaining) {
        next = { t, after: lastKey };
        break;
      }
      remaining -= rows.length;
    }

    return {
      ...page,
      fullResyncRequired: false,
      openConflicts,
      lastSyncTimestamp: issued,
      hasMore: next !== null,
      cursor: encodeCursor(next ? { v: 1, from, upto, t: next.t, after: next.after, issued } : { v: 1, snap: upto, issued }),
    };
  }

  /** Rows of one record type changed by transactions visible in `upto` but not in `from`, in key order. */
  /** Snapshots PostgreSQL accepts (the regex lets through e.g. xmin > xmax): else 400 invalid_cursor. */
  private async assertValidSnapshots(values: Array<string | null | undefined>): Promise<void> {
    for (const value of values) {
      if (!value) continue;
      try {
        await this.deviceChangeRepository.manager.query('SELECT $1::pg_snapshot', [value]);
      } catch {
        throw new BadRequestException({ message: 'Invalid sync cursor; pull again without it', reason: 'invalid_cursor' });
      }
    }
  }

  private async pullRows(t: number, userId: string, from: string | null, upto: string, after: string | null, limit: number): Promise<any[]> {
    const kind = PULL_TYPES[t];
    const qb = (this.repositoryFor(kind === 'tombstone' ? 'tombstone' : kind) as Repository<any>).createQueryBuilder('r');
    const key = kind === 'tombstone' ? "r.object_type || ':' || r.object_id" : 'r.id::text';
    switch (kind) {
      case ChangeObjectType.CLIENT:
        qb.where('r.user_id::text = :userId AND r.deleted_at IS NULL', { userId });
        break;
      case ChangeObjectType.INVOICE:
        qb.leftJoinAndSelect('r.client', 'client').where('r.user_id::text = :userId AND r.deleted_at IS NULL', { userId });
        break;
      case ChangeObjectType.INVOICE_ITEM:
        qb.innerJoin('r.invoice', 'inv').where('inv.user_id::text = :userId AND inv.deleted_at IS NULL', { userId });
        break;
      case ChangeObjectType.ATTACHMENT:
        qb.where(
          `((r.owner_type::text = 'invoice' AND r.owner_id::text IN (SELECT id::text FROM invoices WHERE user_id::text = :userId AND deleted_at IS NULL))
            OR (r.owner_type::text = 'client' AND r.owner_id::text IN (SELECT id::text FROM clients WHERE user_id::text = :userId AND deleted_at IS NULL)))`,
          { userId },
        );
        break;
      default:
        qb.where('r.user_id::text = :userId', { userId });
    }
    if (from) qb.andWhere('NOT pg_visible_in_snapshot(r.change_txid, CAST(:from AS pg_snapshot))', { from });
    qb.andWhere('pg_visible_in_snapshot(r.change_txid, CAST(:upto AS pg_snapshot))', { upto });
    if (after) qb.andWhere(`${key} > :after`, { after });
    qb.addSelect(key, 'r___key').orderBy(key, 'ASC').limit(limit);
    const { entities, raw } = await qb.getRawAndEntities();
    // getRawAndEntities keeps order; attach each row's key for the cursor
    return entities.map((entity, i) => Object.assign(entity, { __key: raw[i]?.r___key ?? String(entity.id) }));
  }

  private async addToPage(page: ReturnType<typeof emptyPage>, t: number, rows: any[], userId: string): Promise<void> {
    const strip = (row: any) => {
      delete row.__key;
      return row;
    };
    switch (PULL_TYPES[t]) {
      case ChangeObjectType.CLIENT:
        page.clients.push(...rows.map(strip));
        break;
      case ChangeObjectType.INVOICE:
        page.invoices.push(...rows.map(strip).map((invoice) => (withoutForeignClient(invoice), invoice)));
        break;
      case ChangeObjectType.INVOICE_ITEM:
        page.invoiceItems.push(
          ...(await withoutForeignSyncHistory(this.deviceChangeRepository.manager, ChangeObjectType.INVOICE_ITEM, rows.map(strip), userId)),
        );
        break;
      case ChangeObjectType.ATTACHMENT:
        page.attachments.push(
          ...withValidAttachmentUrls(
            await withoutForeignSyncHistory(this.deviceChangeRepository.manager, ChangeObjectType.ATTACHMENT, rows.map(strip), userId),
          ),
        );
        break;
      default:
        page.tombstones.push(
          ...rows.map((tomb: SyncTombstone) => ({ object_type: tomb.objectType, object_id: tomb.objectId, deleted_at: tomb.deletedAt.toISOString() })),
        );
    }
  }

  private async processChange(change: DeviceChange, userId: string, protocol: number): Promise<Outcome> {
    if (change.objectType === ChangeObjectType.ATTACHMENT) {
      return this.processAttachmentChange(change, userId);
    }
    return this.processRecordChange(change, userId, protocol);
  }

  repositoryFor(objectType: string): Repository<any> {
    switch (objectType) {
      case ChangeObjectType.CLIENT:
        return this.clientRepository;
      case ChangeObjectType.INVOICE:
        return this.invoiceRepository;
      case ChangeObjectType.INVOICE_ITEM:
        return this.invoiceItemRepository;
      case 'tombstone':
        return this.tombstoneRepository;
      default:
        return this.attachmentRepository;
    }
  }

  /**
   * Keep only real columns of the entity from client-supplied data, minus the
   * protected fields. Relation objects (e.g. `client`, `invoice`) are dropped
   * too, so foreign keys can only change through their id column, which the
   * callers validate.
   */
  writableFields<T>(repository: Repository<T>, data: Record<string, any>): Record<string, any> {
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
    if (!clientId || !(await this.clientRepository.exists({ where: { id: clientId, userId, deletedAt: IsNull() } }))) {
      throw new SyncOwnershipError(`client ${clientId} does not belong to the user`);
    }
  }

  private async assertOwnedInvoice(invoiceId: string, userId: string): Promise<void> {
    if (!invoiceId || !(await this.invoiceRepository.exists({ where: { id: invoiceId, userId, deletedAt: IsNull() } }))) {
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

  /** The user's record (soft-deleted ones included), row-locked for the transaction. */
  async findOwnedRecord(objectType: string, id: string, userId: string): Promise<any | null> {
    const repository = this.repositoryFor(objectType);
    await this.manager.query(`SELECT 1 FROM "${repository.metadata.tableName}" WHERE id = $1 FOR UPDATE`, [id]);
    if (objectType === ChangeObjectType.INVOICE_ITEM) {
      return this.invoiceItemRepository
        .createQueryBuilder('item')
        .innerJoin('item.invoice', 'invoice')
        .where('item.id = :id', { id })
        .andWhere('invoice.userId = :userId', { userId })
        .getOne();
    }
    return repository.findOne({ where: { id, userId } });
  }

  /**
   * Whether the record belongs to a sent, overdue or paid invoice (or is one).
   * An item is protected when its current invoice or the invoice it would be
   * moved to is.
   */
  async isProtected(objectType: string, existing: any | null, data: Record<string, any>, userId: string): Promise<boolean> {
    if (objectType === ChangeObjectType.INVOICE) {
      return !!existing && PROTECTED_INVOICE_STATUSES.has(existing.status);
    }
    if (objectType === ChangeObjectType.INVOICE_ITEM) {
      return (await this.itemInvoices(existing, data, userId)).some((invoice) => PROTECTED_INVOICE_STATUSES.has(invoice.status));
    }
    return false;
  }

  /**
   * The user's invoices an item change touches (its current one and, for a
   * move, the target), row-locked so a concurrent status change waits until
   * this change is decided.
   */
  async itemInvoices(existing: any | null, data: Record<string, any>, userId: string): Promise<Array<{ id: string; status: string; revision: number }>> {
    const invoiceIds = [...new Set([existing?.invoiceId, data.invoiceId].filter(Boolean))];
    if (invoiceIds.length === 0) return [];
    const rows = await this.manager.query(
      'SELECT id::text AS id, status::text AS status, revision FROM invoices WHERE id::text = ANY($1) AND user_id::text = $2 ORDER BY id FOR UPDATE',
      [invoiceIds.map(String), String(userId)],
    );
    return rows.map((row: any) => ({ id: row.id, status: row.status, revision: Number(row.revision) }));
  }

  /** The record's current revision, read after a write (the trigger sets it). */
  async currentRevision(objectType: string, id: string): Promise<number | undefined> {
    const repository = this.repositoryFor(objectType);
    const rows = await this.manager.query(`SELECT revision FROM "${repository.metadata.tableName}" WHERE id = $1`, [id]);
    return rows[0] ? Number(rows[0].revision) : undefined;
  }

  /**
   * Fields (property names) the server changed after `base` up to `current`,
   * from the history the revision trigger writes; null when that history is
   * incomplete (pruned, or base 0), so the change cannot be proven safe.
   */
  async changedSince(objectType: string, id: string, base: number, current: number): Promise<Set<string> | null> {
    if (base < 1) return null;
    const rows = await this.revisionRepository
      .createQueryBuilder('r')
      .where('r.objectType = :objectType AND r.objectId = :id', { objectType, id })
      .andWhere('r.revision > :base AND r.revision <= :current', { base, current })
      .getMany();
    if (rows.length !== current - base) return null;
    const byColumn = new Map(this.repositoryFor(objectType).metadata.columns.map((c) => [c.databaseName, c.propertyName]));
    const fields = new Set<string>();
    for (const row of rows) for (const column of row.changedFields) fields.add(byColumn.get(column) ?? column);
    return fields;
  }

  /** Whether a client-sent value equals the stored one (numeric strings, dates and JSON normalised). */
  sameValue(repository: Repository<any>, property: string, stored: any, sent: any): boolean {
    if (stored == null || sent == null) return stored == sent;
    const column = repository.metadata.columns.find((c) => c.propertyName === property);
    const type = String(column?.type ?? '');
    if (['numeric', 'decimal', 'bigint', 'int', 'integer', 'float', 'double precision', 'real'].includes(type) || column?.type === Number) {
      return Number(stored) === Number(sent);
    }
    if (type === 'date') {
      try {
        return toCalendarDate(stored) === toCalendarDate(sent);
      } catch {
        return false;
      }
    }
    if (typeof stored === 'object' || typeof sent === 'object') {
      return isDeepStrictEqual(stored instanceof Date ? stored.toISOString() : stored, sent);
    }
    return String(stored) === String(sent);
  }

  /** Fields whose sent value differs from the stored record. */
  private differingFields(repository: Repository<any>, existing: any, data: Record<string, any>): string[] {
    return Object.keys(data).filter((key) => !this.sameValue(repository, key, existing[key], data[key]));
  }

  private async openConflictFor(objectType: string, objectId: string, userId: string): Promise<boolean> {
    return this.conflictRepository.exists({ where: { objectType, objectId, userId, status: SyncConflictStatus.OPEN } });
  }

  private async recordConflict(
    change: DeviceChange,
    userId: string,
    kind: SyncConflictKind,
    serverState: Record<string, any> | null,
    serverRevision: number | null,
    conflicting: string[],
  ): Promise<string> {
    const proposed = conflictFields(change.objectType, change.changeType === ChangeType.DELETE ? {} : change.changeJson);
    const conflict = this.conflictRepository.create({
      userId,
      objectType: change.objectType,
      objectId: change.objectId,
      kind,
      changeType: change.changeType,
      changeId: change.changeId,
      deviceId: change.deviceId,
      baseRevision: change.baseRevision,
      serverRevision,
      clientFields: proposed.fields,
      serverFields: serverState ? conflictFields(change.objectType, serverState).fields : null,
      conflictingFields: [...conflicting].sort(),
      omittedFields: proposed.omitted,
      status: SyncConflictStatus.OPEN,
    });
    await this.conflictRepository.save(conflict);
    return conflict.id;
  }

  /** Validate references, then create or update the record; returns its new revision. */
  async writeRecord(objectType: string, id: string, existing: any | null, data: Record<string, any>, userId: string): Promise<number | undefined> {
    const repository = this.repositoryFor(objectType);
    if (objectType === ChangeObjectType.INVOICE && (!existing || 'clientId' in data)) {
      await this.assertOwnedClient(data.clientId ?? existing?.clientId, userId);
    }
    if (objectType === ChangeObjectType.INVOICE_ITEM && (!existing || 'invoiceId' in data)) {
      await this.assertOwnedInvoice(data.invoiceId ?? existing?.invoiceId, userId);
    }

    if (existing) {
      if (Object.keys(data).length === 0) return existing.revision;
      Object.assign(existing, data);
      // Drop the eagerly loaded client so a changed clientId is not
      // overridden by the old relation on save.
      if (objectType === ChangeObjectType.INVOICE && 'clientId' in data) existing.client = undefined;
      if ('updatedAt' in existing) existing.updatedAt = new Date();
      await repository.save(existing);
    } else if (objectType === ChangeObjectType.INVOICE_ITEM) {
      // insert() (not save()) so an id that already exists for another user fails instead of updating.
      await repository.insert({ ...data, id });
    } else {
      await repository.insert({ ...data, id, userId });
    }
    return this.currentRevision(objectType, id);
  }

  /** Soft-delete clients and invoices; hard-delete items. The trigger writes the tombstone. */
  async deleteRecord(objectType: string, existing: any): Promise<void> {
    if (objectType === ChangeObjectType.INVOICE_ITEM) {
      await this.invoiceItemRepository.delete(existing.id);
      return;
    }
    existing.deletedAt = new Date();
    if (objectType === ChangeObjectType.INVOICE) existing.client = undefined;
    await this.repositoryFor(objectType).save(existing);
  }

  /** Clients, invoices and invoice items, for both protocols. */
  private async processRecordChange(change: DeviceChange, userId: string, protocol: number): Promise<Outcome> {
    const { objectType, objectId, changeType } = change;
    const repository = this.repositoryFor(objectType);

    const existing = await this.findOwnedRecord(objectType, objectId, userId);
    const tombstone = await this.tombstoneRepository.findOne({ where: { objectType, objectId } });
    if (tombstone && tombstone.userId !== userId) {
      throw new SyncOwnershipError(`${objectType} ${objectId} does not belong to the user`);
    }
    if (!existing && !tombstone) await this.assertNotOwnedByOther(repository, objectId);

    const deleted = !!tombstone || !!existing?.deletedAt;
    const data = this.writableFields(repository, change.changeJson);
    const isProtected = await this.isProtected(objectType, existing, data, userId);

    if (protocol !== 2) {
      return this.processLegacy(change, userId, existing, deleted, isProtected, data);
    }

    // ---- protocol 2 ----
    const base = change.baseRevision ?? 0;
    const serverState = existing ?? (tombstone?.lastState ? this.fromColumns(objectType, tombstone.lastState) : null);
    const serverRevision = existing?.revision ?? tombstone?.revision ?? null;

    // An item's own revision does not move when its invoice is sent or paid,
    // so an item change on such an invoice must show the device saw the
    // invoice as it is now (parent_revision). A move into or out of one is
    // always a conflict: one revision cannot prove both invoices were seen.
    if (objectType === ChangeObjectType.INVOICE_ITEM && isProtected && !deleted) {
      const parents = await this.itemInvoices(existing, data, userId);
      const sawCurrent =
        parents.length === 1 && change.parentRevision != null && change.parentRevision === parents[0].revision;
      if (!sawCurrent) {
        const conflictId = await this.recordConflict(change, userId, SyncConflictKind.PROTECTED_INVOICE, serverState, serverRevision, []);
        return { status: 'conflict', conflictId };
      }
    }

    if (changeType === ChangeType.DELETE) {
      if (deleted || !existing) return { status: 'applied' };
      if (base > existing.revision) return failed('invalid_base_revision');
      if (base < existing.revision) {
        if (isProtected) {
          const conflictId = await this.recordConflict(change, userId, SyncConflictKind.PROTECTED_INVOICE, existing, existing.revision, []);
          return { status: 'conflict', conflictId };
        }
        // Deletion wins; the version it removed stays recoverable through the conflict.
        const conflictId = await this.recordConflict(change, userId, SyncConflictKind.DELETE_AFTER_EDIT, existing, existing.revision, []);
        await this.deleteRecord(objectType, existing);
        return { status: 'applied', conflictId };
      }
      await this.deleteRecord(objectType, existing);
      return { status: 'applied' };
    }

    // create or update
    if (deleted) {
      const conflictId = await this.recordConflict(change, userId, SyncConflictKind.EDIT_AFTER_DELETE, serverState, serverRevision, []);
      return { status: 'conflict', conflictId };
    }
    if (!existing) {
      if (changeType === ChangeType.UPDATE) return failed('not_found');
      const revision = await this.writeRecord(objectType, objectId, null, data, userId);
      return { status: 'applied', revision };
    }

    // The record exists: a create of an existing id is an edit based on nothing (base 0).
    const effectiveBase = changeType === ChangeType.CREATE ? 0 : base;
    if (effectiveBase > existing.revision) return failed('invalid_base_revision');
    if (effectiveBase === existing.revision) {
      const revision = await this.writeRecord(objectType, objectId, existing, data, userId);
      return { status: 'applied', revision };
    }

    const differing = this.differingFields(repository, existing, data);
    if (differing.length === 0) return { status: 'applied', revision: existing.revision };
    if (isProtected) {
      const conflictId = await this.recordConflict(change, userId, SyncConflictKind.PROTECTED_INVOICE, existing, existing.revision, differing);
      return { status: 'conflict', conflictId };
    }
    const serverChanged = await this.changedSince(objectType, objectId, effectiveBase, existing.revision);
    const overlapping = serverChanged === null ? differing : differing.filter((field) => serverChanged.has(field));
    if (overlapping.length > 0) {
      const conflictId = await this.recordConflict(change, userId, SyncConflictKind.STALE_EDIT, existing, existing.revision, overlapping);
      return { status: 'conflict', conflictId };
    }
    const merged = Object.fromEntries(differing.map((field) => [field, data[field]]));
    const revision = await this.writeRecord(objectType, objectId, existing, merged, userId);
    return { status: 'merged', revision };
  }

  /**
   * Protocol 1 (apps without revisions): applied as sent, last write wins,
   * except where that would bypass a protection the app cannot honour.
   */
  private async processLegacy(
    change: DeviceChange,
    userId: string,
    existing: any | null,
    deleted: boolean,
    isProtected: boolean,
    data: Record<string, any>,
  ): Promise<Outcome> {
    const { objectType, objectId, changeType } = change;

    if (changeType === ChangeType.DELETE) {
      if (deleted || !existing) return { status: 'applied' };
      if (isProtected) return failed(UPGRADE_REQUIRED);
      await this.deleteRecord(objectType, existing);
      return { status: 'applied' };
    }

    // No resurrection of deleted records.
    if (deleted) return failed('record_deleted');
    // Without a base revision the server cannot tell a stale write from a
    // current one (this includes an item created in a sent or paid invoice).
    if (isProtected) return failed(UPGRADE_REQUIRED);
    if (existing && (await this.openConflictFor(objectType, objectId, userId))) return failed('open_conflict');
    await this.writeRecord(objectType, objectId, existing, data, userId);
    return { status: 'applied' };
  }

  /** A stored row (column names) as entity properties. */
  fromColumns(objectType: string, row: Record<string, any>): Record<string, any> {
    const byColumn = new Map(this.repositoryFor(objectType).metadata.columns.map((c) => [c.databaseName, c.propertyName]));
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [byColumn.get(key) ?? key, value]));
  }

  private async processAttachmentChange(change: DeviceChange, userId: string): Promise<Outcome> {
    const existing = await this.attachmentRepository.findOne({
      where: { id: change.objectId },
    });
    if (existing) {
      await this.assertOwnedAttachmentOwner(existing.ownerType, existing.ownerId, userId);
    }
    const tombstone = await this.tombstoneRepository.findOne({
      where: { objectType: ChangeObjectType.ATTACHMENT, objectId: change.objectId },
    });
    if (tombstone && tombstone.userId !== userId) {
      throw new SyncOwnershipError(`attachment ${change.objectId} does not belong to the user`);
    }

    if (change.changeType === ChangeType.DELETE) {
      if (existing) {
        await this.attachmentRepository.delete(existing.id);
      }
      return { status: 'applied' };
    }
    if (!existing && tombstone) return failed('record_deleted');

    const data = this.writableFields(this.attachmentRepository, change.changeJson);
    if (!existing || 'url' in data) assertValidAttachmentUrl(data.url);
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
    return { status: 'applied' };
  }
}
