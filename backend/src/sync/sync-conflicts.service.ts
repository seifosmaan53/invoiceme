import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { DataSource, Repository } from 'typeorm';
import { ChangeObjectType } from '../entities/device-change.entity';
import { SyncConflict, SyncConflictKind, SyncConflictStatus } from '../entities/sync-conflict.entity';
import { SyncTombstone } from '../entities/sync-tombstone.entity';
import { conflictFields } from './conflict-fields';
import { SyncSchemaService } from './sync-schema.service';
import { SyncService } from './sync.service';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceItem } from '../entities/invoice-item.entity';
import { calculateLineTotal, calculateTotals } from '../invoices/invoice-totals';
import { PROTECTED_INVOICE_STATUSES } from './sync.service';

/** Derived amounts a resolution never takes from the device. */
const DERIVED_FIELDS: Record<string, string[]> = {
  [ChangeObjectType.INVOICE]: ['subtotal', 'taxTotal', 'discountTotal', 'total'],
  [ChangeObjectType.INVOICE_ITEM]: ['lineTotal'],
};

export type ConflictAction = 'apply_client' | 'restore' | 'dismiss';

export class ResolveConflictDto {
  @ApiProperty({
    enum: ['apply_client', 'restore', 'dismiss'],
    description:
      'apply_client: write your version over the current one (edits of editable records). ' +
      'restore: bring the deleted record back (with your edits for edit_after_delete). ' +
      'dismiss: keep the server as it is.',
  })
  @IsIn(['apply_client', 'restore', 'dismiss'])
  action: ConflictAction;

  @ApiProperty({
    required: false,
    description: 'Revision of the record the user reviewed (current.revision from GET). Required except for dismiss.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  expected_revision?: number;
}

const EXPLANATIONS: Record<SyncConflictKind, string> = {
  [SyncConflictKind.STALE_EDIT]:
    'This record was changed elsewhere after this device last synced, and both changed the same fields. Nothing was overwritten.',
  [SyncConflictKind.PROTECTED_INVOICE]:
    'This invoice was sent or paid and changed elsewhere after this device last synced, so the offline change was not applied.',
  [SyncConflictKind.EDIT_AFTER_DELETE]:
    'This record was deleted elsewhere, so the change made on this device was not applied. The deletion stands.',
  [SyncConflictKind.DELETE_AFTER_EDIT]:
    'This device deleted a record that had been changed elsewhere. The deletion stands; the version it removed can be restored.',
};

const ACTIONS: Record<SyncConflictKind, ConflictAction[]> = {
  [SyncConflictKind.STALE_EDIT]: ['apply_client', 'dismiss'],
  [SyncConflictKind.PROTECTED_INVOICE]: ['dismiss'],
  [SyncConflictKind.EDIT_AFTER_DELETE]: ['restore', 'dismiss'],
  [SyncConflictKind.DELETE_AFTER_EDIT]: ['restore', 'dismiss'],
};

export interface ConflictView {
  id: string;
  object_type: string;
  object_id: string;
  label: string;
  kind: SyncConflictKind;
  change_type: string;
  status: SyncConflictStatus;
  resolution: string | null;
  explanation: string;
  base_revision: number | null;
  server_revision: number | null;
  your_changes: Record<string, any>;
  server_version: Record<string, any> | null;
  conflicting_fields: string[];
  omitted_fields: string[];
  allowed_actions: ConflictAction[];
  created_at: string;
  resolved_at: string | null;
}

export interface ConflictDetail extends ConflictView {
  /** The record as it is now, so the user decides against current data. */
  current: { revision: number | null; deleted: boolean; fields: Record<string, any> | null };
}

/**
 * Review and resolution of sync conflicts (docs/SYNC-CONTRACT.md). JWT only
 * (SyncController); a user sees and resolves only their own conflicts, and
 * another user's conflict id answers 404.
 */
@Injectable()
export class SyncConflictsService {
  constructor(
    @InjectRepository(SyncConflict) private readonly conflicts: Repository<SyncConflict>,
    private readonly dataSource: DataSource,
    private readonly sync: SyncService,
    private readonly schema: SyncSchemaService,
  ) {}

  static label(conflict: SyncConflict): string {
    // The record as the server knows it identifies it best; the device's values are the fallback.
    const fields = { ...conflict.clientFields, ...(conflict.serverFields ?? {}) };
    switch (conflict.objectType) {
      case ChangeObjectType.INVOICE:
        return fields.number ? `Invoice ${fields.number}` : 'Invoice';
      case ChangeObjectType.CLIENT:
        return fields.name ? `Client ${fields.name}` : 'Client';
      case ChangeObjectType.INVOICE_ITEM:
        return fields.description ? `Invoice item "${String(fields.description).slice(0, 80)}"` : 'Invoice item';
      default:
        return conflict.objectType;
    }
  }

  static view(conflict: SyncConflict): ConflictView {
    return {
      id: conflict.id,
      object_type: conflict.objectType,
      object_id: conflict.objectId,
      label: SyncConflictsService.label(conflict),
      kind: conflict.kind,
      change_type: conflict.changeType,
      status: conflict.status,
      resolution: conflict.resolution,
      explanation: EXPLANATIONS[conflict.kind],
      base_revision: conflict.baseRevision,
      server_revision: conflict.serverRevision,
      your_changes: conflict.clientFields,
      server_version: conflict.serverFields,
      conflicting_fields: conflict.conflictingFields,
      omitted_fields: conflict.omittedFields,
      allowed_actions: conflict.status === SyncConflictStatus.OPEN ? ACTIONS[conflict.kind] : [],
      created_at: conflict.createdAt.toISOString(),
      resolved_at: conflict.resolvedAt ? conflict.resolvedAt.toISOString() : null,
    };
  }

  async list(userId: string, status: 'open' | 'all' = 'open'): Promise<ConflictView[]> {
    const rows = await this.conflicts.find({
      where: status === 'all' ? { userId } : { userId, status: SyncConflictStatus.OPEN },
      order: { createdAt: 'DESC' },
      take: 200,
    });
    return rows.map(SyncConflictsService.view);
  }

  async get(userId: string, id: string): Promise<ConflictDetail> {
    const conflict = await this.conflicts.findOne({ where: { id, userId } });
    if (!conflict) throw new NotFoundException('Conflict not found');
    return this.dataSource.transaction(async (manager) => {
      const bound = this.sync.bindTo(manager);
      const record = await bound.findOwnedRecord(conflict.objectType, conflict.objectId, userId);
      const tombstone = await manager.getRepository(SyncTombstone).findOne({
        where: { objectType: conflict.objectType, objectId: conflict.objectId, userId },
      });
      return {
        ...SyncConflictsService.view(conflict),
        current: {
          revision: record?.revision ?? tombstone?.revision ?? null,
          deleted: !record || !!record.deletedAt,
          fields: record ? conflictFields(conflict.objectType, record).fields : null,
        },
      };
    });
  }

  async resolve(userId: string, id: string, dto: ResolveConflictDto): Promise<ConflictDetail> {
    await this.schema.assertReady();
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(SyncConflict);
      // Row lock: two resolutions of the same conflict cannot both succeed.
      const conflict = await repository.findOne({ where: { id, userId }, lock: { mode: 'pessimistic_write' } });
      if (!conflict) throw new NotFoundException('Conflict not found');
      if (conflict.status !== SyncConflictStatus.OPEN) {
        throw new ConflictException('This conflict was already resolved');
      }

      if (dto.action !== 'dismiss') {
        if (!ACTIONS[conflict.kind].includes(dto.action)) {
          throw new BadRequestException(`"${dto.action}" is not possible for this conflict`);
        }
        if (dto.expected_revision === undefined) {
          throw new BadRequestException('expected_revision is required');
        }
        await this.sync.lockObject(manager, conflict.objectType, conflict.objectId);
        const bound = this.sync.bindTo(manager);
        if (dto.action === 'apply_client') {
          await this.applyClient(bound, manager, conflict, userId, dto.expected_revision);
        } else {
          await this.restore(bound, manager, conflict, userId, dto.expected_revision);
        }
      }

      conflict.status = dto.action === 'dismiss' ? SyncConflictStatus.DISMISSED : SyncConflictStatus.RESOLVED;
      conflict.resolution = dto.action;
      conflict.resolvedAt = new Date();
      conflict.resolvedBy = userId;
      await repository.save(conflict);
    });
    return this.get(userId, id);
  }

  private stale(current: number | null | undefined): never {
    throw new ConflictException({
      message: 'The record changed after you reviewed it. Review the conflict again.',
      current_revision: current ?? null,
    });
  }

  /**
   * Fields a resolution may write for this record type. Invoice totals and an
   * item's line total are never taken from the device: they are derived from
   * the lines (invoices/invoice-totals.ts) after the write.
   */
  private editableFields(bound: SyncService, objectType: string, fields: Record<string, any>): Record<string, any> {
    const data = bound.writableFields(bound.repositoryFor(objectType), fields);
    for (const derived of DERIVED_FIELDS[objectType] ?? []) delete data[derived];
    return data;
  }

  private async applyClient(bound: SyncService, manager: any, conflict: SyncConflict, userId: string, expected: number) {
    const record = await bound.findOwnedRecord(conflict.objectType, conflict.objectId, userId);
    if (!record || record.deletedAt) throw new ConflictException('The record was deleted; restore it instead');
    if (record.revision !== expected) this.stale(record.revision);
    const data = this.editableFields(bound, conflict.objectType, conflict.clientFields);
    if (await bound.isProtected(conflict.objectType, record, data, userId)) {
      throw new UnprocessableEntityException('This invoice is sent or paid; edit it directly instead');
    }
    if (conflict.objectType === ChangeObjectType.INVOICE_ITEM) {
      data.lineTotal = calculateLineTotal({ ...record, ...data });
    }
    // writeRecord assigns data onto record: keep the line's invoice before a move
    const previousInvoiceId = record.invoiceId;
    await bound.writeRecord(conflict.objectType, conflict.objectId, record, data, userId);
    await this.recomputeTotalsAfter(manager, conflict.objectType, conflict.objectType === ChangeObjectType.INVOICE ? conflict.objectId : record.invoiceId, userId);
    if (conflict.objectType === ChangeObjectType.INVOICE_ITEM && previousInvoiceId && previousInvoiceId !== record.invoiceId) {
      // The invoice the line left: recompute, to zero if it was its last line
      await this.recomputeTotalsAfter(manager, conflict.objectType, previousInvoiceId, userId, { allowEmpty: true });
    }
  }

  private async restore(bound: SyncService, manager: any, conflict: SyncConflict, userId: string, expected: number) {
    const { objectType, objectId } = conflict;
    const tombstones = manager.getRepository(SyncTombstone);
    const tombstone: SyncTombstone | null = await tombstones.findOne({ where: { objectType, objectId, userId } });
    if (objectType === ChangeObjectType.INVOICE) {
      // Restoring an invoice also touches its items (sync trigger). Lock them
      // first, as an item push does (item, then invoice), so the two cannot deadlock.
      await manager.query('SELECT id FROM invoice_items WHERE invoice_id::text = $1 ORDER BY id FOR UPDATE', [String(objectId)]);
    }
    const record = await bound.findOwnedRecord(objectType, objectId, userId);
    if (record && !record.deletedAt) throw new ConflictException('The record is not deleted');

    const clientEdits =
      conflict.kind === SyncConflictKind.EDIT_AFTER_DELETE ? this.editableFields(bound, objectType, conflict.clientFields) : {};

    if (record) {
      // Soft-deleted client or invoice: undo the delete (the trigger removes the tombstone).
      if (record.revision !== expected) this.stale(record.revision);
      if (objectType === ChangeObjectType.INVOICE) {
        await this.assertActiveClient(manager, record.clientId, userId);
      }
      if (Object.keys(clientEdits).length > 0 && (await bound.isProtected(objectType, record, clientEdits, userId))) {
        throw new UnprocessableEntityException('This invoice is sent or paid; restore it without the offline edits (dismiss) or edit it directly');
      }
      record.deletedAt = null;
      if (objectType === ChangeObjectType.INVOICE) record.client = undefined;
      await bound.repositoryFor(objectType).save(record);
      if (Object.keys(clientEdits).length > 0) {
        const restored = await bound.findOwnedRecord(objectType, objectId, userId);
        await bound.writeRecord(objectType, objectId, restored, clientEdits, userId);
      }
      if (objectType === ChangeObjectType.INVOICE) await this.recomputeTotalsAfter(manager, objectType, objectId, userId);
      return;
    }

    // Hard-deleted invoice item: recreate it from the state kept with its
    // tombstone, through the invoice rules: only into the same, active,
    // still-editable invoice, with its line total and the invoice totals
    // recomputed in this transaction.
    if (!tombstone || objectType !== ChangeObjectType.INVOICE_ITEM || !tombstone.lastState) {
      throw new UnprocessableEntityException('The deleted record can no longer be restored');
    }
    if (tombstone.revision !== expected) this.stale(tombstone.revision);
    const state = this.editableFields(bound, objectType, bound.fromColumns(objectType, tombstone.lastState));
    const data: Record<string, any> = { ...state, ...clientEdits, invoiceId: state.invoiceId };
    const [parent] = await bound.itemInvoices(null, data, userId); // row-locked
    if (!parent) {
      throw new UnprocessableEntityException("The line's invoice no longer exists; the line cannot be restored");
    }
    if (PROTECTED_INVOICE_STATUSES.has(parent.status)) {
      throw new UnprocessableEntityException(
        'This invoice is sent or paid; a line cannot be restored into it. Edit the invoice directly, or dismiss this conflict.',
      );
    }
    data.lineTotal = calculateLineTotal(data as any);
    await tombstones.delete({ objectType, objectId });
    await bound.writeRecord(objectType, objectId, null, data, userId);
    await this.recomputeTotalsAfter(manager, objectType, data.invoiceId, userId);
  }

  /**
   * Recompute an invoice's subtotal, tax, discount and total from its lines
   * (the same rules as the REST service), on the locked invoice row, when it
   * has lines. Runs in the resolution's transaction.
   */
  /**
   * Totals from the invoice's lines. An invoice without lines is left as it
   * is (its lines may not have synced yet) unless allowEmpty: a line was just
   * moved out of it.
   */
  private async recomputeTotalsAfter(
    manager: any,
    objectType: string,
    invoiceId: string | null | undefined,
    userId: string,
    { allowEmpty = false }: { allowEmpty?: boolean } = {},
  ) {
    if (!invoiceId || (objectType !== ChangeObjectType.INVOICE_ITEM && objectType !== ChangeObjectType.INVOICE)) return;
    const owned = await manager.query(
      'SELECT id FROM invoices WHERE id::text = $1 AND user_id::text = $2 AND deleted_at IS NULL FOR UPDATE',
      [String(invoiceId), String(userId)],
    );
    if (owned.length === 0) return;
    const lines = await manager.getRepository(InvoiceItem).find({ where: { invoiceId } });
    if (lines.length === 0 && !allowEmpty) return;
    const totals = calculateTotals(lines);
    await manager.getRepository(Invoice).update(invoiceId, totals);
  }

  private async assertActiveClient(manager: any, clientId: string, userId: string) {
    const rows = await manager.query('SELECT 1 FROM clients WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL', [clientId, userId]);
    if (rows.length === 0) throw new ConflictException("The invoice's client is deleted; restore the client first");
  }
}
