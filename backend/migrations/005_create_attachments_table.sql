-- Migration: 005_create_attachments_table
-- Description: Creates attachments table for invoice/client attachments

CREATE TYPE attachment_owner_type AS ENUM ('invoice', 'client');

CREATE TABLE attachments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_type attachment_owner_type NOT NULL,
    owner_id UUID NOT NULL,
    url VARCHAR(500) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    content_type VARCHAR(100),
    size_bytes INTEGER,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_attachments_owner ON attachments(owner_type, owner_id);
CREATE INDEX idx_attachments_created_at ON attachments(created_at);

