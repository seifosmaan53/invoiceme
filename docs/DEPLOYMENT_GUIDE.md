# 🚀 InvoiceMe Deployment Guide

Complete guide for deploying InvoiceMe to production.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Docker Deployment](#docker-deployment)
3. [Manual Deployment](#manual-deployment)
4. [SSL/HTTPS Setup](#sslhttps-setup)
5. [PostgreSQL Setup](#postgresql-setup)
6. [Environment Configuration](#environment-configuration)
7. [Post-Deployment](#post-deployment)

---

## Prerequisites

### Server Requirements

- **OS:** Linux (Ubuntu 20.04+ recommended) or macOS
- **RAM:** Minimum 2GB, 4GB+ recommended
- **CPU:** 2+ cores recommended
- **Storage:** 20GB+ free space
- **Network:** Public IP or domain name

### Software Requirements

- **Docker** 20.10+ and Docker Compose
- **PostgreSQL** 14+ (or use Docker)
- **Node.js** 18+ (if not using Docker)
- **Nginx** (for reverse proxy and SSL)

---

## Docker Deployment (Recommended)

### Quick Start

```bash
# Clone repository
git clone <repository-url>
cd invoice-maker

# Copy environment file
cp backend/.env.example backend/.env

# Edit backend/.env with your configuration
nano backend/.env

# Start services
docker-compose up -d

# Check logs
docker-compose logs -f
```

### Docker Compose Configuration

The `docker-compose.yml` includes:
- **Backend API** (NestJS)
- **PostgreSQL Database**
- **MinIO** (S3-compatible storage)

### Environment Variables

Edit `backend/.env`:

```bash
# Database
DB_HOST=postgres
DB_PORT=5432
DB_USERNAME=invoiceme
DB_PASSWORD=your-secure-password
DB_DATABASE=invoiceme

# JWT Secrets (generate secure random strings)
JWT_SECRET=your-32-character-secret
JWT_REFRESH_SECRET=your-32-character-refresh-secret

# S3/MinIO
S3_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_BUCKET=invoiceme

# CORS (IMPORTANT: Set your domain, never use '*' in production)
CORS_ORIGIN=https://app.yourdomain.com,https://mobile.yourdomain.com

# Email (optional)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password

# Encryption Key (generate: openssl rand -hex 32)
ENCRYPTION_KEY=your-64-character-encryption-key

# Production Settings
NODE_ENV=production
ENABLE_SWAGGER=false
```

### Generate Secure Secrets

```bash
# JWT Secret
openssl rand -hex 32

# Encryption Key
openssl rand -hex 32

# Database Password
openssl rand -base64 24
```

---

## Manual Deployment

### Step 1: Install PostgreSQL

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib

# Create database
sudo -u postgres psql
CREATE DATABASE invoiceme;
CREATE USER invoiceme WITH PASSWORD 'your-password';
GRANT ALL PRIVILEGES ON DATABASE invoiceme TO invoiceme;
\q
```

**macOS:**
```bash
brew install postgresql
brew services start postgresql

# Create database
createdb invoiceme
```

### Step 2: Install Node.js

```bash
# Using nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 18
nvm use 18
```

### Step 3: Setup Backend

```bash
cd backend
npm install
npm run build

# Run migrations
npm run migration:run

# Start production server
npm run start:prod
```

### Step 4: Setup Process Manager (PM2)

```bash
npm install -g pm2

# Start with PM2
pm2 start dist/main.js --name invoiceme-api

# Save PM2 configuration
pm2 save
pm2 startup
```

---

## SSL/HTTPS Setup

### Using Nginx with Let's Encrypt

#### Step 1: Install Nginx

```bash
sudo apt update
sudo apt install nginx
```

#### Step 2: Install Certbot

```bash
sudo apt install certbot python3-certbot-nginx
```

#### Step 3: Configure Nginx

Create `/etc/nginx/sites-available/invoiceme`:

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable site:
```bash
sudo ln -s /etc/nginx/sites-available/invoiceme /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

#### Step 4: Get SSL Certificate

```bash
sudo certbot --nginx -d api.yourdomain.com
```

Certbot will automatically configure SSL and redirect HTTP to HTTPS.

---

## PostgreSQL Setup

### Production Database Configuration

Edit `/etc/postgresql/14/main/postgresql.conf`:

```conf
# Performance
shared_buffers = 256MB
effective_cache_size = 1GB
maintenance_work_mem = 64MB
checkpoint_completion_target = 0.9
wal_buffers = 16MB
default_statistics_target = 100
random_page_cost = 1.1
effective_io_concurrency = 200
work_mem = 4MB
min_wal_size = 1GB
max_wal_size = 4GB
```

### Backup Configuration

Set up automated backups:

```bash
# Add to crontab
0 2 * * * /path/to/backup-database.sh
```

See `scripts/backup-database.sh` for backup script.

---

## Environment Configuration

### Production Checklist

- [ ] `NODE_ENV=production`
- [ ] `ENABLE_SWAGGER=false` (disable in production)
- [ ] `CORS_ORIGIN` set to exact domains (never `*`)
- [ ] Strong `JWT_SECRET` and `JWT_REFRESH_SECRET`
- [ ] Strong `ENCRYPTION_KEY` for sensitive data
- [ ] Production database credentials
- [ ] S3/CDN configuration
- [ ] Email SMTP configuration
- [ ] `TRUST_PROXY=true` if behind load balancer

### Security Settings

```bash
# Force HTTPS
# Already implemented in main.ts

# Rate Limiting
RATE_LIMIT_TTL=60
RATE_LIMIT_MAX=100

# CORS (exact domains)
CORS_ORIGIN=https://app.yourdomain.com

# Disable Swagger
ENABLE_SWAGGER=false
```

---

## Post-Deployment

### Health Check

```bash
curl https://api.yourdomain.com/api/health
```

### Verify Services

```bash
# Check backend logs
docker-compose logs backend

# Check database connection
docker-compose exec backend npm run migration:run

# Test API
curl https://api.yourdomain.com/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123","name":"Test User"}'
```

### Monitoring

- Set up Sentry for error tracking
- Configure log rotation
- Set up database backups
- Monitor disk space
- Set up uptime monitoring

---

## Troubleshooting

### Backend Won't Start

1. Check logs: `docker-compose logs backend`
2. Verify database connection
3. Check environment variables
4. Verify ports aren't in use

### Database Connection Issues

1. Verify PostgreSQL is running
2. Check credentials in `.env`
3. Verify network connectivity
4. Check firewall rules

### SSL Certificate Issues

1. Verify domain DNS points to server
2. Check Nginx configuration
3. Review Certbot logs: `sudo certbot certificates`
4. Renew certificate: `sudo certbot renew`

---

## Maintenance

### Regular Tasks

- **Daily:** Check logs for errors
- **Weekly:** Review database size
- **Monthly:** Update dependencies
- **Quarterly:** Rotate secrets
- **Annually:** Renew SSL certificates

### Backup Strategy

See `docs/DISASTER_RECOVERY.md` for complete backup/restore procedures.

---

**Last Updated:** January 2025

