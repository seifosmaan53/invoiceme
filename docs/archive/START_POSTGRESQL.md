# 🔧 Fix: PostgreSQL Not Running

## 🚨 Problem Found

**PostgreSQL database is not running!** 

The backend needs PostgreSQL to start, but it's not running on port 5432.

## ✅ Solution: Start PostgreSQL

### Option 1: Using Homebrew (Most Common)

```bash
brew services start postgresql
```

Or if you have a specific version:
```bash
brew services start postgresql@14
# or
brew services start postgresql@15
```

### Option 2: Manual Start

```bash
pg_ctl -D /usr/local/var/postgres start
```

### Option 3: Check PostgreSQL Installation

```bash
# Check if PostgreSQL is installed
which postgres
which psql

# If not installed, install it:
brew install postgresql@14
```

## ✅ Verify PostgreSQL is Running

```bash
pg_isready -h localhost -p 5432
```

Should return: `localhost:5432 - accepting connections`

## 🚀 Then Start Backend

Once PostgreSQL is running:

```bash
cd ~/Desktop/invoice\ maker/backend
npm run start:dev
```

## 📝 Database Setup (If Needed)

If database doesn't exist:

```bash
# Create database
createdb invoiceme

# Or using psql:
psql -U postgres
CREATE DATABASE invoiceme;
\q
```

## ✅ Expected Flow:

1. ✅ Start PostgreSQL → `brew services start postgresql`
2. ✅ Verify PostgreSQL → `pg_isready`
3. ✅ Start Backend → `npm run start:dev`
4. ✅ Verify Backend → `curl http://localhost:3000/api/docs`
5. ✅ Restart Flutter → Press `R` in Flutter terminal

## 🎯 Current Status:

- ⚠️ PostgreSQL: NOT RUNNING (needs to be started)
- ⏳ Backend: Waiting for database
- ✅ Flutter: Running (waiting for backend)

**Start PostgreSQL first, then the backend will start successfully!**

