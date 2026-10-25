import { DataSource, EntityManager } from 'typeorm';
import { Client } from '../../entities/client.entity';
import { ChangeObjectType } from '../../entities/device-change.entity';

/**
 * Read-side guards for cross-owner rows written before ownership was enforced
 * on sync push (see docs/security/2026-10-25-historical-cross-owner.md).
 * They never modify data; they only decide what a response may contain.
 */

/**
 * The invoice's client, or null when the client belongs to another user.
 * Use this for values that go into responses, PDFs, emails or notifications.
 */
export function ownedClient(invoice: { userId: string; client?: Client | null }): Client | null {
  const client = invoice.client;
  if (!client) return null;
  return client.userId === invoice.userId ? client : null;
}

/**
 * Replaces a foreign embedded client with null, for invoices that are only
 * serialized. Do not save an invoice after calling this: TypeORM writes a null
 * relation as a null client_id.
 */
export function withoutForeignClient<T extends { userId: string; client?: Client | null }>(invoice: T): T {
  if (invoice.client && !ownedClient(invoice)) {
    invoice.client = null;
  }
  return invoice;
}

/**
 * Ids (of the given type) that another user changed through sync. Only applied
 * changes (synced = true) count: rejected pushes are logged too, and must not
 * let anyone hide a victim's records.
 */
export async function idsChangedByOtherUser(
  db: DataSource | EntityManager,
  objectType: ChangeObjectType,
  ids: string[],
  ownerId: string,
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows: Array<{ object_id: string }> = await db.query(
    `SELECT DISTINCT object_id::text AS object_id
       FROM device_changes
      WHERE object_type::text = $1
        AND synced = true
        AND user_id::text <> $2
        AND object_id::text = ANY($3::text[])`,
    [objectType, ownerId, ids],
  );
  return new Set(rows.map((r) => r.object_id));
}

/** Drops records that another user changed through sync (see above). */
export async function withoutForeignSyncHistory<T extends { id: string }>(
  db: DataSource | EntityManager,
  objectType: ChangeObjectType,
  records: T[],
  ownerId: string,
): Promise<T[]> {
  const foreign = await idsChangedByOtherUser(db, objectType, records.map((r) => r.id), ownerId);
  return foreign.size === 0 ? records : records.filter((r) => !foreign.has(r.id));
}
