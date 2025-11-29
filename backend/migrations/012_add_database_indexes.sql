-- Migration: Add database indexes for performance
-- Phase 0: Database Indexing

-- Invoice indexes
CREATE INDEX IF NOT EXISTS idx_invoices_user_id ON invoices(user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_client_id ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_type ON invoices(type);
CREATE INDEX IF NOT EXISTS idx_invoices_issue_date ON invoices(issue_date);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(number);
CREATE INDEX IF NOT EXISTS idx_invoices_deleted_at ON invoices(deleted_at) WHERE deleted_at IS NULL;

-- Client indexes (some may already exist)
CREATE INDEX IF NOT EXISTS idx_clients_user_id ON clients(user_id);
CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email);
CREATE INDEX IF NOT EXISTS idx_clients_deleted_at ON clients(deleted_at) WHERE deleted_at IS NULL;

-- GIN index for tags_json (already exists from migration 011, but ensuring it's there)
CREATE INDEX IF NOT EXISTS idx_clients_tags_json ON clients USING GIN (tags_json);

-- Invoice items indexes
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items(invoice_id);

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_invoices_user_status ON invoices(user_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_user_due_date ON invoices(user_id, due_date) WHERE deleted_at IS NULL AND status = 'unpaid';

-- Comments
COMMENT ON INDEX idx_invoices_user_status IS 'Optimizes queries filtering by user and status';
COMMENT ON INDEX idx_invoices_user_due_date IS 'Optimizes overdue invoice queries';

