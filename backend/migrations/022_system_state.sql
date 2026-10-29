-- 022: server-wide state that must survive restarts.
-- First use: `overdue.first_run` = the business date of the first overdue run
-- of this version. That run marks the historical backlog of past-due sent
-- invoices as overdue without notifications, unless the operator opts in with
-- OVERDUE_NOTIFY_HISTORICAL=true (docs/operations/upgrade-2026-10-28.md).
-- Additive and idempotent. Run with psql -v ON_ERROR_STOP=1 --single-transaction.
CREATE TABLE IF NOT EXISTS system_state (
  key varchar(100) PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
