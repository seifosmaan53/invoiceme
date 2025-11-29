-- Migration: 007_create_device_changes_table
-- Description: Creates device_changes table for offline sync

CREATE TYPE change_type AS ENUM ('create', 'update', 'delete');
CREATE TYPE change_object_type AS ENUM ('client', 'invoice', 'invoice_item', 'attachment');

CREATE TABLE device_changes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id VARCHAR(255) NOT NULL,
    object_type change_object_type NOT NULL,
    object_id UUID NOT NULL,
    change_json JSONB NOT NULL,
    change_type change_type NOT NULL,
    synced BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_device_changes_user_device ON device_changes(user_id, device_id);
CREATE INDEX idx_device_changes_synced ON device_changes(synced);
CREATE INDEX idx_device_changes_created_at ON device_changes(created_at);

