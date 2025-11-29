-- Migration for pending features: templates, recurring invoices, API keys, client avatars

-- Invoice Templates
CREATE TABLE IF NOT EXISTS invoice_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  type VARCHAR(20) DEFAULT 'invoice',
  currency VARCHAR(3) DEFAULT 'USD',
  default_due_days INTEGER DEFAULT 30,
  line_items_json JSONB NOT NULL DEFAULT '[]',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invoice_templates_user_id ON invoice_templates(user_id);

-- Recurring Invoices
CREATE TABLE IF NOT EXISTS recurring_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  frequency VARCHAR(20) NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'quarterly', 'yearly')),
  interval INTEGER DEFAULT 1,
  start_date DATE NOT NULL,
  end_date DATE,
  next_run_date DATE NOT NULL,
  currency VARCHAR(3) DEFAULT 'USD',
  line_items_json JSONB NOT NULL DEFAULT '[]',
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  invoices_generated INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_recurring_invoices_user_id ON recurring_invoices(user_id);
CREATE INDEX idx_recurring_invoices_client_id ON recurring_invoices(client_id);
CREATE INDEX idx_recurring_invoices_is_active ON recurring_invoices(is_active);
CREATE INDEX idx_recurring_invoices_next_run_date ON recurring_invoices(next_run_date);

-- API Keys
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  key_hash VARCHAR(255) NOT NULL UNIQUE,
  permissions_json JSONB NOT NULL DEFAULT '[]',
  expires_at DATE,
  is_active BOOLEAN DEFAULT true,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash);

-- Client Avatar (add to existing clients table)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- User Settings for PDF customization
CREATE TABLE IF NOT EXISTS user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  pdf_logo_url TEXT,
  pdf_primary_color VARCHAR(7) DEFAULT '#4a90e2',
  pdf_secondary_color VARCHAR(7) DEFAULT '#333333',
  pdf_font_family VARCHAR(50) DEFAULT 'Arial',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_settings_user_id ON user_settings(user_id);

