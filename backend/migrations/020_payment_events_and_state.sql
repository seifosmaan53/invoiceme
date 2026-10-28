-- Migration: 020_payment_events_and_state
-- Description: refund and dispute state separate from invoice status; a
-- history of verified provider events; checkout attempt idempotency keys
-- (see docs/PAYMENTS.md).
--
-- Additive and idempotent: safe to run again. Changes no existing values:
-- existing payments start with nothing refunded and no dispute, and their
-- invoices keep their status. Apply after 019, before starting a server that
-- includes it (the server reads the new payments columns).
-- Run with: psql -v ON_ERROR_STOP=1 --single-transaction -f 020_payment_events_and_state.sql

ALTER TABLE payments ADD COLUMN IF NOT EXISTS refunded_amount numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS dispute_status varchar(30);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS disputed_amount numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_charge_id varchar(255);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS idempotency_key varchar(120);

-- One row per verified provider event, processed once (event ids are unique).
-- details holds amounts, currencies and provider statuses only: never secrets
-- or the provider object itself.
CREATE TABLE IF NOT EXISTS payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_event_id varchar(255) NOT NULL,
  payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
  type varchar(80) NOT NULL,
  outcome varchar(30) NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  provider_created_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_events_provider_event ON payment_events (provider_event_id);
CREATE INDEX IF NOT EXISTS idx_payment_events_payment ON payment_events (payment_id, received_at);
