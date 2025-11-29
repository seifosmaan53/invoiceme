#!/bin/bash
# Setup automated daily database backups using cron
# Usage: ./setup-cron-backup.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_SCRIPT="$SCRIPT_DIR/backup-database.sh"

# Make backup script executable
chmod +x "$BACKUP_SCRIPT"

# Get absolute path to backup script
BACKUP_SCRIPT_ABS=$(realpath "$BACKUP_SCRIPT")

# Create cron job (runs daily at 2 AM)
CRON_JOB="0 2 * * * $BACKUP_SCRIPT_ABS >> /var/log/invoiceme-backup.log 2>&1"

# Check if cron job already exists
if crontab -l 2>/dev/null | grep -q "$BACKUP_SCRIPT_ABS"; then
    echo "⚠️  Cron job already exists. Skipping..."
    exit 0
fi

# Add cron job
(crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -

echo "✅ Automated daily backup configured"
echo "📅 Backup will run daily at 2:00 AM"
echo "📝 Logs: /var/log/invoiceme-backup.log"
echo ""
echo "To view cron jobs: crontab -l"
echo "To remove cron job: crontab -e (then delete the line)"

