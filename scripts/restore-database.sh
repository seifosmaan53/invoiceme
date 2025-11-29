#!/bin/bash
# Database restore script for InvoiceMe
# Usage: ./restore-database.sh <backup_file>

set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <backup_file.dump.gz>"
  exit 1
fi

BACKUP_FILE="$1"
DB_NAME="${DB_DATABASE:-invoiceme}"
DB_USER="${DB_USERNAME:-postgres}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"

# Check if backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
  echo "❌ Backup file not found: $BACKUP_FILE"
  exit 1
fi

# Confirm restore
read -p "⚠️  This will DELETE all current data. Continue? (yes/no): " confirm
if [ "$confirm" != "yes" ]; then
  echo "Restore cancelled."
  exit 0
fi

# Decompress if needed
TEMP_FILE="$BACKUP_FILE"
if [[ "$BACKUP_FILE" == *.gz ]]; then
  echo "Decompressing backup..."
  TEMP_FILE="${BACKUP_FILE%.gz}"
  gunzip -c "$BACKUP_FILE" > "$TEMP_FILE"
fi

# Drop and recreate database
echo "Dropping existing database..."
PGPASSWORD="${DB_PASSWORD}" dropdb \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  --if-exists \
  "$DB_NAME"

echo "Creating new database..."
PGPASSWORD="${DB_PASSWORD}" createdb \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  "$DB_NAME"

# Restore from backup
echo "Restoring database..."
PGPASSWORD="${DB_PASSWORD}" pg_restore \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --clean \
  --if-exists \
  "$TEMP_FILE"

# Cleanup temp file if we created it
if [[ "$BACKUP_FILE" == *.gz ]]; then
  rm -f "$TEMP_FILE"
fi

echo "✅ Database restored successfully!"

