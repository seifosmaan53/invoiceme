# 🔧 Fix Database Connection Error

## Problem
Backend can't connect to PostgreSQL database. Error: `ECONNREFUSED`

## Solution: Start PostgreSQL

### Option 1: If Installed via Homebrew (Most Common)

```bash
# Start PostgreSQL
brew services start postgresql@15

# OR for latest version
brew services start postgresql

# Check if it's running
pg_isready
```

### Option 2: If Installed via Postgres.app

1. Open **Postgres.app** from Applications
2. Click **Start** button

### Option 3: Manual Start

```bash
# Find PostgreSQL installation
which postgres

# Start manually (adjust path if needed)
/usr/local/bin/postgres -D /usr/local/var/postgres
```

### Option 4: Use Docker (Easiest)

```bash
# Start PostgreSQL in Docker
docker run -d \
  --name postgres-invoiceme \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=invoiceme \
  -p 5432:5432 \
  postgres:15

# Create database
docker exec -it postgres-invoiceme psql -U postgres -c "CREATE DATABASE invoiceme;"
```

---

## Verify PostgreSQL is Running

```bash
# Check if PostgreSQL is ready
pg_isready

# Should show: /tmp:5432 - accepting connections
```

---

## Create Database (If Not Exists)

```bash
# Create the database
createdb invoiceme

# OR using psql
psql -U postgres -c "CREATE DATABASE invoiceme;"
```

---

## Check Your .env Configuration

Make sure `backend/.env` has correct database settings:

```bash
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=your_postgres_password
DB_DATABASE=invoiceme
```

---

## After Starting PostgreSQL

1. **Restart backend:**
   - Stop the current backend (Ctrl+C)
   - Run again: `cd backend && npm run start:dev`

2. **Verify connection:**
   ```bash
   curl http://localhost:3000/api/health
   ```

---

## Quick Fix Commands

```bash
# Start PostgreSQL (Homebrew)
brew services start postgresql@15

# Create database
createdb invoiceme

# Restart backend
cd "/Users/seifosman/Desktop/invoice maker/backend"
npm run start:dev
```

