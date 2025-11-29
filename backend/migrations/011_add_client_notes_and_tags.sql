-- Migration: 011_add_client_notes_and_tags
-- Description: Adds notes and tags fields to clients table

-- Add notes field (TEXT for longer notes)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS notes TEXT;

-- Add tags field (JSONB array for flexible tagging)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS tags_json JSONB DEFAULT '[]'::jsonb;

-- Create index on tags for efficient filtering
CREATE INDEX IF NOT EXISTS idx_clients_tags ON clients USING GIN (tags_json);

