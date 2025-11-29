-- Migration: 014_add_invoice_number_format_to_users
-- Description: Add configurable invoice number format to users table

ALTER TABLE users ADD COLUMN invoice_number_format VARCHAR(100);

COMMENT ON COLUMN users.invoice_number_format IS 'Configurable invoice number format pattern. Supports placeholders: {PREFIX}, {YYYY}, {MM}, {DD}, {####} for sequence. Default: INV-{YYYY}-{####} or EST-{YYYY}-{####}';

