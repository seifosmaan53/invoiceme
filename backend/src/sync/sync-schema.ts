/**
 * Database side of sync protocol 2 (docs/SYNC-CONTRACT.md), shared by
 * migration 019 and by databases built with DB_SYNCHRONIZE (tests, local
 * development), which create tables and columns from the entities but not
 * functions or triggers.
 *
 * Revisions are kept by the database, not the application, so every write
 * path (REST, sync, webhooks, scheduled jobs, raw SQL) moves them:
 * - sync_bump_revision: on UPDATE of clients, invoices and invoice_items,
 *   when any column other than revision/updated_at changes, revision becomes
 *   OLD.revision + 1 (a value written by the application is ignored) and the
 *   names of the changed columns are recorded in sync_record_revisions. That
 *   history is what lets the server prove which fields changed since a
 *   device's base revision.
 * - sync_record_tombstone: when a client or invoice is soft-deleted, or a
 *   client, invoice, invoice item or attachment row is deleted, a tombstone
 *   is written so devices learn about the delete and cannot recreate the id.
 *   Restoring a soft-deleted record removes its tombstone.
 *
 * Delivery (migration 021): every client, invoice, item, attachment and
 * tombstone row carries change_txid, the id of the transaction that last
 * changed it (restoring a client or invoice also sets it on its items and
 * attachments, which pulls skipped while it was deleted). Pull compares it with PostgreSQL snapshots (sync-pull-cursor.ts),
 * so a change is delivered by the first pull whose snapshot sees it committed,
 * whatever its timestamps.
 *
 * Must stay byte-identical to the block between the BEGIN/END SYNC SCHEMA
 * markers in the latest migration that defines it,
 * backend/migrations/021_sync_delivery_cursor.sql (a unit test checks this);
 * 019 keeps the first version as applied. Ids and owner columns are compared as text and cast to uuid
 * because databases built with DB_SYNCHRONIZE store them as varchar.
 */
export const SYNC_SCHEMA_SQL = `
ALTER TABLE clients ADD COLUMN IF NOT EXISTS change_txid xid8 NOT NULL DEFAULT pg_current_xact_id();
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS change_txid xid8 NOT NULL DEFAULT pg_current_xact_id();
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS change_txid xid8 NOT NULL DEFAULT pg_current_xact_id();
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS change_txid xid8 NOT NULL DEFAULT pg_current_xact_id();
ALTER TABLE sync_tombstones ADD COLUMN IF NOT EXISTS change_txid xid8 NOT NULL DEFAULT pg_current_xact_id();

CREATE OR REPLACE FUNCTION sync_bump_revision() RETURNS trigger AS $fn$
DECLARE
  changed text[];
BEGIN
  SELECT coalesce(array_agg(n.key ORDER BY n.key), '{}')
    INTO changed
    FROM jsonb_each(to_jsonb(NEW)) AS n
   WHERE n.key NOT IN ('revision', 'updated_at', 'change_txid')
     AND (to_jsonb(OLD) -> n.key) IS DISTINCT FROM n.value;
  IF cardinality(changed) = 0 THEN
    -- No data change: same revision. change_txid stays as written, so a
    -- touch (SET change_txid = pg_current_xact_id()) re-delivers the row.
    NEW.revision := OLD.revision;
    RETURN NEW;
  END IF;
  NEW.revision := OLD.revision + 1;
  NEW.change_txid := pg_current_xact_id();
  INSERT INTO sync_record_revisions (object_type, object_id, revision, changed_fields)
  VALUES (TG_ARGV[0], NEW.id::text, NEW.revision, changed)
  ON CONFLICT (object_type, object_id, revision)
  DO UPDATE SET changed_fields = EXCLUDED.changed_fields, created_at = now();
  RETURN NEW;
END
$fn$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sync_record_tombstone() RETURNS trigger AS $fn$
DECLARE
  owner uuid;
  state jsonb;
  rev bigint;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      INSERT INTO sync_tombstones (object_type, object_id, user_id, revision, deleted_at)
      VALUES (TG_ARGV[0], NEW.id::text, NEW.user_id::text::uuid, NEW.revision, NEW.deleted_at)
      ON CONFLICT (object_type, object_id)
      DO UPDATE SET revision = EXCLUDED.revision, deleted_at = EXCLUDED.deleted_at, change_txid = pg_current_xact_id();
    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      DELETE FROM sync_tombstones WHERE object_type = TG_ARGV[0] AND object_id = NEW.id::text;
      -- Devices dropped the children with the tombstone, and pulls skipped
      -- their changes while the parent was deleted: deliver them again.
      IF TG_ARGV[0] = 'invoice' THEN
        UPDATE invoice_items SET change_txid = pg_current_xact_id() WHERE invoice_id::text = NEW.id::text;
      END IF;
      UPDATE attachments SET change_txid = pg_current_xact_id()
       WHERE owner_type::text = TG_ARGV[0] AND owner_id::text = NEW.id::text;
    END IF;
    RETURN NEW;
  END IF;

  -- DELETE
  IF TG_ARGV[0] IN ('client', 'invoice') THEN
    owner := OLD.user_id::text::uuid;
    rev := OLD.revision;
  ELSIF TG_ARGV[0] = 'invoice_item' THEN
    SELECT user_id::text::uuid INTO owner FROM invoices WHERE id::text = OLD.invoice_id::text;
    rev := OLD.revision;
    state := to_jsonb(OLD) - 'revision';
  ELSE
    IF OLD.owner_type::text = 'invoice' THEN
      SELECT user_id::text::uuid INTO owner FROM invoices WHERE id::text = OLD.owner_id::text;
    ELSE
      SELECT user_id::text::uuid INTO owner FROM clients WHERE id::text = OLD.owner_id::text;
    END IF;
  END IF;
  IF owner IS NOT NULL THEN
    INSERT INTO sync_tombstones (object_type, object_id, user_id, revision, deleted_at, last_state)
    VALUES (TG_ARGV[0], OLD.id::text, owner, rev, now(), state)
    ON CONFLICT (object_type, object_id)
    DO UPDATE SET revision = EXCLUDED.revision, deleted_at = EXCLUDED.deleted_at, last_state = EXCLUDED.last_state,
                  change_txid = pg_current_xact_id();
  END IF;
  RETURN OLD;
END
$fn$ LANGUAGE plpgsql;

-- Attachments have no revision, but their changes are delivered by transaction too.
CREATE OR REPLACE FUNCTION sync_touch_change_txid() RETURNS trigger AS $fn$
BEGIN
  NEW.change_txid := pg_current_xact_id();
  RETURN NEW;
END
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_revision ON clients;
CREATE TRIGGER sync_revision BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION sync_bump_revision('client');
DROP TRIGGER IF EXISTS sync_revision ON invoices;
CREATE TRIGGER sync_revision BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION sync_bump_revision('invoice');
DROP TRIGGER IF EXISTS sync_revision ON invoice_items;
CREATE TRIGGER sync_revision BEFORE UPDATE ON invoice_items
  FOR EACH ROW EXECUTE FUNCTION sync_bump_revision('invoice_item');

DROP TRIGGER IF EXISTS sync_change_txid ON attachments;
CREATE TRIGGER sync_change_txid BEFORE UPDATE ON attachments
  FOR EACH ROW EXECUTE FUNCTION sync_touch_change_txid();

DROP TRIGGER IF EXISTS sync_tombstone_soft ON clients;
CREATE TRIGGER sync_tombstone_soft AFTER UPDATE OF deleted_at ON clients
  FOR EACH ROW EXECUTE FUNCTION sync_record_tombstone('client');
DROP TRIGGER IF EXISTS sync_tombstone_soft ON invoices;
CREATE TRIGGER sync_tombstone_soft AFTER UPDATE OF deleted_at ON invoices
  FOR EACH ROW EXECUTE FUNCTION sync_record_tombstone('invoice');
DROP TRIGGER IF EXISTS sync_tombstone_delete ON clients;
CREATE TRIGGER sync_tombstone_delete AFTER DELETE ON clients
  FOR EACH ROW EXECUTE FUNCTION sync_record_tombstone('client');
DROP TRIGGER IF EXISTS sync_tombstone_delete ON invoices;
CREATE TRIGGER sync_tombstone_delete AFTER DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION sync_record_tombstone('invoice');
DROP TRIGGER IF EXISTS sync_tombstone_delete ON invoice_items;
CREATE TRIGGER sync_tombstone_delete AFTER DELETE ON invoice_items
  FOR EACH ROW EXECUTE FUNCTION sync_record_tombstone('invoice_item');
DROP TRIGGER IF EXISTS sync_tombstone_delete ON attachments;
CREATE TRIGGER sync_tombstone_delete AFTER DELETE ON attachments
  FOR EACH ROW EXECUTE FUNCTION sync_record_tombstone('attachment');
`;

/** Trigger names the server checks for before accepting versioned writes. */
export const SYNC_REQUIRED_TRIGGERS: ReadonlyArray<{ table: string; name: string }> = [
  { table: 'clients', name: 'sync_revision' },
  { table: 'invoices', name: 'sync_revision' },
  { table: 'invoice_items', name: 'sync_revision' },
  { table: 'clients', name: 'sync_tombstone_soft' },
  { table: 'invoices', name: 'sync_tombstone_soft' },
  { table: 'clients', name: 'sync_tombstone_delete' },
  { table: 'invoices', name: 'sync_tombstone_delete' },
  { table: 'invoice_items', name: 'sync_tombstone_delete' },
  { table: 'attachments', name: 'sync_tombstone_delete' },
  { table: 'attachments', name: 'sync_change_txid' },
];
