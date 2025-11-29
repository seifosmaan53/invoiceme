-- Migration: 013_add_2fa_to_users
-- Description: Add 2FA (TOTP) support to users table

ALTER TABLE users ADD COLUMN totp_secret VARCHAR(255);
ALTER TABLE users ADD COLUMN totp_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN backup_codes TEXT; -- JSON array of backup codes

COMMENT ON COLUMN users.totp_secret IS 'TOTP secret for 2FA (encrypted)';
COMMENT ON COLUMN users.totp_enabled IS 'Whether 2FA is enabled for this user';
COMMENT ON COLUMN users.backup_codes IS 'Backup codes for 2FA recovery (JSON array)';

