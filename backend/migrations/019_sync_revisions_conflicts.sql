-- Migration: 019_sync_revisions_conflicts
-- Description: sync protocol 2: server-controlled record revisions, field
-- change history, deletion tombstones, sync conflicts (docs/SYNC-CONTRACT.md).
--
-- Additive and idempotent: safe to run again. Changes no existing data
-- except setting revision = 1 on existing rows (new column default).
-- REQUIRED before starting a server that includes it: the server reads the
-- new columns on every client, invoice and item query.
-- Run with: psql -v ON_ERROR_STOP=1 --single-transaction -f 019_sync_revisions_conflicts.sql

ALTER TABLE clients ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 1;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 1;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 1;

-- Columns changed by each revision (written by sync_bump_revision).
CREATE TABLE IF NOT EXISTS sync_record_revisions (
  id bigserial PRIMARY KEY,
  object_type varchar(20) NOT NULL,
  object_id varchar(64) NOT NULL,
  revision bigint NOT NULL,
  changed_fields text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_record_revisions_object
  ON sync_record_revisions (object_type, object_id, revision);
CREATE INDEX IF NOT EXISTS idx_sync_record_revisions_created ON sync_record_revisions (created_at);

-- Deletes devices must learn about (written by sync_record_tombstone).
-- No foreign key to users: rows are written while an account is being deleted.
CREATE TABLE IF NOT EXISTS sync_tombstones (
  object_type varchar(20) NOT NULL,
  object_id varchar(64) NOT NULL,
  user_id uuid NOT NULL,
  revision bigint,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  last_state jsonb,
  PRIMARY KEY (object_type, object_id)
);
CREATE INDEX IF NOT EXISTS idx_sync_tombstones_user_deleted ON sync_tombstones (user_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_sync_tombstones_deleted ON sync_tombstones (deleted_at);

-- Offline changes that were not applied, kept for the owner to resolve.
CREATE TABLE IF NOT EXISTS sync_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_type varchar(20) NOT NULL,
  object_id varchar(64) NOT NULL,
  kind varchar(30) NOT NULL,
  change_type varchar(10) NOT NULL,
  change_id uuid,
  device_id varchar(255),
  base_revision bigint,
  server_revision bigint,
  client_fields jsonb NOT NULL DEFAULT '{}',
  server_fields jsonb,
  conflicting_fields text[] NOT NULL DEFAULT '{}',
  omitted_fields text[] NOT NULL DEFAULT '{}',
  status varchar(20) NOT NULL DEFAULT 'open',
  resolution varchar(20),
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_user_status ON sync_conflicts (user_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_object ON sync_conflicts (object_type, object_id, status);

-- Outcome of each recorded change, so a replayed change_id gets the same answer.
ALTER TABLE device_changes ADD COLUMN IF NOT EXISTS base_revision bigint;
ALTER TABLE device_changes ADD COLUMN IF NOT EXISTS parent_revision bigint;
ALTER TABLE device_changes ADD COLUMN IF NOT EXISTS outcome varchar(20);
ALTER TABLE device_changes ADD COLUMN IF NOT EXISTS conflict_id uuid;

-- BEGIN SYNC SCHEMA (identical to backend/src/sync/sync-schema.ts)
CREATE OR REPLACE FUNCTION sync_bump_revision() RETURNS trigger AS $fn$
DECLARE
  changed text[];
BEGIN
  SELECT coalesce(array_agg(n.key ORDER BY n.key), '{}')
    INTO changed
    FROM jsonb_each(to_jsonb(NEW)) AS n
   WHERE n.key NOT IN ('revision', 'updated_at')
     AND (to_jsonb(OLD) -> n.key) IS DISTINCT FROM n.value;
  IF cardinality(changed) = 0 THEN
    NEW.revision := OLD.revision;
    RETURN NEW;
  END IF;
  NEW.revision := OLD.revision + 1;
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
      DO UPDATE SET revision = EXCLUDED.revision, deleted_at = EXCLUDED.deleted_at;
    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      DELETE FROM sync_tombstones WHERE object_type = TG_ARGV[0] AND object_id = NEW.id::text;
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
    DO UPDATE SET revision = EXCLUDED.revision, deleted_at = EXCLUDED.deleted_at, last_state = EXCLUDED.last_state;
  END IF;
  RETURN OLD;
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
