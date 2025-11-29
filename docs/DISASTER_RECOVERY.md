# 🛡️ Disaster Recovery Guide

Complete guide for backing up and restoring your InvoiceMe system.

---

## Table of Contents

1. [Backup Strategy](#backup-strategy)
2. [Automated Backups](#automated-backups)
3. [Manual Backups](#manual-backups)
4. [Restore Procedures](#restore-procedures)
5. [Testing Backups](#testing-backups)
6. [Recovery Scenarios](#recovery-scenarios)

---

## Backup Strategy

### What to Backup

1. **PostgreSQL Database** - All business data
2. **S3/MinIO Files** - PDFs, attachments
3. **Environment Variables** - `.env` files
4. **Configuration Files** - Docker compose, nginx configs

### Backup Frequency

- **Database**: Daily (automated)
- **Files**: Daily (automated)
- **Config**: Weekly (manual)

### Retention Policy

- **Daily backups**: Keep 30 days
- **Weekly backups**: Keep 12 weeks
- **Monthly backups**: Keep 12 months

---

## Automated Backups

### Database Backup Script

Create `/scripts/backup-database.sh`:

```bash
#!/bin/bash
# Database backup script

BACKUP_DIR="/backups/database"
DATE=$(date +%Y%m%d_%H%M%S)
DB_NAME="${DB_DATABASE:-invoiceme}"
DB_USER="${DB_USERNAME:-postgres}"
DB_HOST="${DB_HOST:-localhost}"
RETENTION_DAYS=30

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Create backup
pg_dump -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" \
  --format=custom \
  --file="$BACKUP_DIR/backup_$DATE.dump"

# Compress backup
gzip "$BACKUP_DIR/backup_$DATE.dump"

# Remove old backups
find "$BACKUP_DIR" -name "backup_*.dump.gz" -mtime +$RETENTION_DAYS -delete

echo "Backup completed: backup_$DATE.dump.gz"
```

### S3/MinIO Backup Script

Create `/scripts/backup-s3.sh`:

```bash
#!/bin/bash
# S3/MinIO backup script

BACKUP_DIR="/backups/s3"
DATE=$(date +%Y%m%d_%H%M%S)
S3_ENDPOINT="${S3_ENDPOINT:-http://localhost:9000}"
S3_BUCKET="${S3_BUCKET:-invoiceme}"
RETENTION_DAYS=30

mkdir -p "$BACKUP_DIR"

# Sync S3 bucket to local directory
aws s3 sync "s3://$S3_BUCKET" "$BACKUP_DIR/s3_$DATE" \
  --endpoint-url="$S3_ENDPOINT"

# Create archive
tar -czf "$BACKUP_DIR/s3_$DATE.tar.gz" -C "$BACKUP_DIR" "s3_$DATE"
rm -rf "$BACKUP_DIR/s3_$DATE"

# Remove old backups
find "$BACKUP_DIR" -name "s3_*.tar.gz" -mtime +$RETENTION_DAYS -delete

echo "S3 backup completed: s3_$DATE.tar.gz"
```

### Cron Job Setup

Add to crontab (`crontab -e`):

```bash
# Daily database backup at 2 AM
0 2 * * * /path/to/scripts/backup-database.sh >> /var/log/backup-db.log 2>&1

# Daily S3 backup at 3 AM
0 3 * * * /path/to/scripts/backup-s3.sh >> /var/log/backup-s3.log 2>&1
```

---

## Manual Backups

### Database Backup

```bash
# Full backup
pg_dump -h localhost -U postgres -d invoiceme \
  --format=custom \
  --file=backup_$(date +%Y%m%d).dump

# Compress
gzip backup_$(date +%Y%m%d).dump
```

### S3/MinIO Backup

```bash
# Using AWS CLI
aws s3 sync s3://invoiceme ./backup-s3-$(date +%Y%m%d) \
  --endpoint-url=http://localhost:9000

# Create archive
tar -czf backup-s3-$(date +%Y%m%d).tar.gz backup-s3-$(date +%Y%m%d)
```

### Configuration Backup

```bash
# Backup environment files
cp .env .env.backup.$(date +%Y%m%d)

# Backup Docker compose
cp docker-compose.yml docker-compose.yml.backup.$(date +%Y%m%d)
```

---

## Restore Procedures

### Database Restore

#### From Custom Format Backup

```bash
# Stop application
docker-compose stop backend

# Drop existing database (CAUTION: This deletes all data!)
dropdb -h localhost -U postgres invoiceme

# Create new database
createdb -h localhost -U postgres invoiceme

# Restore from backup
pg_restore -h localhost -U postgres -d invoiceme \
  --clean \
  --if-exists \
  backup_YYYYMMDD.dump

# Start application
docker-compose start backend
```

#### From SQL Dump

```bash
# Restore from SQL file
psql -h localhost -U postgres -d invoiceme < backup_YYYYMMDD.sql
```

### S3/MinIO Restore

```bash
# Extract backup
tar -xzf backup-s3-YYYYMMDD.tar.gz

# Restore to S3
aws s3 sync ./backup-s3-YYYYMMDD s3://invoiceme \
  --endpoint-url=http://localhost:9000
```

### Full System Restore

1. **Stop all services**
   ```bash
   docker-compose down
   ```

2. **Restore database**
   ```bash
   ./scripts/restore-database.sh backup_YYYYMMDD.dump
   ```

3. **Restore S3 files**
   ```bash
   ./scripts/restore-s3.sh backup-s3-YYYYMMDD.tar.gz
   ```

4. **Restore configuration**
   ```bash
   cp .env.backup.YYYYMMDD .env
   ```

5. **Start services**
   ```bash
   docker-compose up -d
   ```

---

## Testing Backups

### Verify Backup Integrity

```bash
# Test database backup
pg_restore --list backup_YYYYMMDD.dump | head -20

# Test S3 backup
tar -tzf backup-s3-YYYYMMDD.tar.gz | head -20
```

### Test Restore (Staging)

1. **Create test environment**
   ```bash
   docker-compose -f docker-compose.test.yml up -d
   ```

2. **Restore backup to test DB**
   ```bash
   pg_restore -d invoiceme_test backup_YYYYMMDD.dump
   ```

3. **Verify data**
   ```bash
   psql -d invoiceme_test -c "SELECT COUNT(*) FROM invoices;"
   psql -d invoiceme_test -c "SELECT COUNT(*) FROM clients;"
   ```

4. **Cleanup**
   ```bash
   docker-compose -f docker-compose.test.yml down -v
   ```

---

## Recovery Scenarios

### Scenario 1: Database Corruption

**Symptoms:**
- Database connection errors
- Data inconsistencies
- Application crashes

**Recovery:**
1. Stop application
2. Identify last good backup
3. Restore database from backup
4. Check application logs for errors
5. Restart application

### Scenario 2: Accidental Data Deletion

**Symptoms:**
- Missing records
- User reports missing data

**Recovery:**
1. **Immediate**: Stop application to prevent further changes
2. Identify deletion time
3. Restore from backup before deletion
4. **Alternative**: Use PostgreSQL point-in-time recovery (if WAL archiving enabled)

### Scenario 3: Server Failure

**Symptoms:**
- Server unreachable
- Complete system down

**Recovery:**
1. **New Server Setup:**
   ```bash
   # Install Docker
   curl -fsSL https://get.docker.com | sh
   
   # Clone repository
   git clone <repo-url>
   cd invoiceme
   
   # Restore configuration
   cp .env.backup.YYYYMMDD .env
   ```

2. **Restore Database:**
   ```bash
   # Install PostgreSQL
   sudo apt install postgresql
   
   # Create database
   createdb invoiceme
   
   # Restore from backup
   pg_restore -d invoiceme backup_YYYYMMDD.dump
   ```

3. **Restore S3:**
   ```bash
   # Setup MinIO/S3
   docker-compose up -d minio
   
   # Restore files
   ./scripts/restore-s3.sh backup-s3-YYYYMMDD.tar.gz
   ```

4. **Start Services:**
   ```bash
   docker-compose up -d
   ```

### Scenario 4: Partial Data Loss

**Symptoms:**
- Some tables missing data
- Specific records deleted

**Recovery:**
1. Identify affected tables
2. Export current data (if any)
3. Restore specific tables from backup:
   ```bash
   pg_restore -d invoiceme \
     -t clients \
     -t invoices \
     backup_YYYYMMDD.dump
   ```

---

## Backup Verification Checklist

- [ ] Backup runs daily without errors
- [ ] Backup files are created and compressed
- [ ] Old backups are automatically deleted
- [ ] Backups are stored in secure location
- [ ] Backup integrity verified monthly
- [ ] Restore procedure tested quarterly
- [ ] Backup location documented
- [ ] Recovery time objective (RTO) defined
- [ ] Recovery point objective (RPO) defined

---

## Best Practices

### 1. Multiple Backup Locations

- **Primary**: Local server
- **Secondary**: Remote storage (S3, Google Cloud Storage)
- **Tertiary**: Off-site backup

### 2. Encryption

Encrypt sensitive backups:

```bash
# Encrypt backup
gpg --symmetric --cipher-algo AES256 backup_YYYYMMDD.dump

# Decrypt for restore
gpg --decrypt backup_YYYYMMDD.dump.gpg > backup_YYYYMMDD.dump
```

### 3. Monitoring

Monitor backup success:

```bash
# Check backup logs
tail -f /var/log/backup-db.log

# Alert on backup failure
if [ $? -ne 0 ]; then
  # Send alert email/notification
fi
```

### 4. Documentation

- Document backup location
- Document restore procedures
- Keep backup schedule visible
- Update after any changes

---

## Quick Reference

### Backup Commands

```bash
# Database
pg_dump -h localhost -U postgres -d invoiceme -Fc -f backup.dump

# S3
aws s3 sync s3://invoiceme ./backup --endpoint-url=http://localhost:9000

# Config
cp .env .env.backup
```

### Restore Commands

```bash
# Database
pg_restore -h localhost -U postgres -d invoiceme --clean backup.dump

# S3
aws s3 sync ./backup s3://invoiceme --endpoint-url=http://localhost:9000
```

---

## Support

For backup/restore issues:
1. Check backup logs: `/var/log/backup-*.log`
2. Verify database connectivity
3. Check disk space
4. Review this guide
5. Contact support if needed

---

**Last Updated:** January 2025  
**Version:** 1.0.0

