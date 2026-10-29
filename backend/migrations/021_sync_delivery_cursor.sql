-- Migration: 021_sync_delivery_cursor
-- Description: delivery of every committed change through sync pull.
-- Adds change_txid (the transaction that last changed the row) to clients,
-- invoices, invoice_items, attachments and sync_tombstones, and replaces the
-- sync trigger functions so every write sets it. Pull compares it with
-- PostgreSQL snapshots (docs/SYNC-CONTRACT.md "Delivery guarantee").
--
-- Additive and idempotent: safe to run again. Existing rows get the id of
-- the transaction that runs this migration. Apply after 020, before starting
-- a server that includes it.
-- Run with: psql -v ON_ERROR_STOP=1 --single-transaction -f 021_sync_delivery_cursor.sql

-- BEGIN SYNC SCHEMA (identical to backend/src/sync/sync-schema.ts)
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
-- END SYNC SCHEMA
