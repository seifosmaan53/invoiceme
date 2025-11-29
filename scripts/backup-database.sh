#!/bin/bash
# Database backup script for InvoiceMe
# Usage: ./backup-database.sh

set -e

# Configuration
BACKUP_DIR="${BACKUP_DIR:-/backups/database}"
DATE=$(date +%Y%m%d_%H%M%S)
DB_NAME="${DB_DATABASE:-invoiceme}"
DB_USER="${DB_USERNAME:-postgres}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Create backup
echo "Creating database backup..."
PGPASSWORD="${DB_PASSWORD}" pg_dump \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --format=custom \
  --file="$BACKUP_DIR/backup_$DATE.dump"

# Compress backup
echo "Compressing backup..."
gzip "$BACKUP_DIR/backup_$DATE.dump"

# Remove old backups
echo "Cleaning up old backups (older than $RETENTION_DAYS days)..."
find "$BACKUP_DIR" -name "backup_*.dump.gz" -mtime +$RETENTION_DAYS -delete

echo "✅ Backup completed: backup_$DATE.dump.gz"
echo "📁 Location: $BACKUP_DIR/backup_$DATE.dump.gz"

