-- Migration: 018_add_device_change_change_id
-- Description: Optional per-change idempotency key for POST /api/v1/sync/push.
--
-- A device may send `change_id` with each change. The server records it in
-- device_changes.change_id and applies a given (user_id, change_id) at most
-- once; replays are answered as "duplicate". Rows from older clients keep
-- change_id NULL and are not constrained. See docs/SYNC-CONTRACT.md.
--
-- Idempotent: safe to run again. Changes no data. If duplicate
-- (user_id, change_id) pairs already exist (only possible if the column was
-- added earlier by hand or by TypeORM synchronize without the index), it stops
-- with an error naming the count BEFORE changing anything, and the duplicates
-- must be resolved by a person. Run it with
-- `psql -v ON_ERROR_STOP=1 --single-transaction`.

DO $$
DECLARE
  duplicate_groups bigint;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'device_changes' AND column_name = 'change_id'
  ) THEN
    EXECUTE 'SELECT count(*) FROM (
               SELECT 1 FROM device_changes
               WHERE change_id IS NOT NULL
               GROUP BY user_id, change_id
               HAVING count(*) > 1
             ) d'
      INTO duplicate_groups;
    IF duplicate_groups > 0 THEN
      RAISE EXCEPTION 'migration 018: device_changes has % duplicate (user_id, change_id) group(s); unique index not created and no data changed. Resolve the duplicates by hand, then run this migration again.', duplicate_groups;
    END IF;
  END IF;
END $$;

ALTER TABLE device_changes ADD COLUMN IF NOT EXISTS change_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_device_changes_user_change_id
  ON device_changes (user_id, change_id)
  WHERE change_id IS NOT NULL;
