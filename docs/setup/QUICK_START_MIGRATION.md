# 🚀 Quick Start: Run Migrations

## ✅ Step 1: Flutter Dependencies - COMPLETE

Flutter dependencies have been fixed and upgraded:
- ✅ `intl` updated to `^0.20.2`
- ✅ All packages resolved
- ✅ No conflicts remaining

---

## ⚠️ Step 2: Start PostgreSQL

PostgreSQL is currently **not running**. You need to start it first.

### Quick Start Options:

#### Option A: Using Homebrew (macOS)

```bash
# Check which PostgreSQL version you have
brew list | grep postgresql

# Start PostgreSQL (replace @14 with your version)
brew services start postgresql@14
# OR
brew services start postgresql@15
# OR  
brew services start postgresql@16

# Verify it's running
pg_isready
```

#### Option B: Using Docker (Easiest)

```bash
# Start PostgreSQL in Docker
docker run --name invoiceme-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=invoiceme \
  -p 5432:5432 \
  -d postgres:15

# Wait a few seconds for it to start, then verify
sleep 3
pg_isready
```

#### Option C: Using Postgres.app (macOS GUI)

1. Download from: https://postgresapp.com/
2. Install and open Postgres.app
3. Click "Start" button
4. Verify: `pg_isready`

---

## ✅ Step 3: Create Database (If Needed)

```bash
# Check if database exists
psql -U postgres -l | grep invoiceme

# If it doesn't exist, create it
createdb invoiceme
# OR
psql -U postgres -c "CREATE DATABASE invoiceme;"
```

---

## ✅ Step 4: Run Migration

Once PostgreSQL is running:

```bash
cd "/Users/seifosman/Desktop/invoice maker/backend"
npm run migration:run -- -d migrations/data-source.ts
```

**Expected Output:**
```
Migration 013_add_pending_features executed successfully
```

---

## 🔍 Troubleshooting

### Error: "ECONNREFUSED"
- **Cause:** PostgreSQL is not running
- **Fix:** Start PostgreSQL (see Step 2)

### Error: "database does not exist"
- **Cause:** Database `invoiceme` doesn't exist
- **Fix:** Create database (see Step 3)

### Error: "password authentication failed"
- **Cause:** Wrong database credentials
- **Fix:** Check `backend/.env` file for correct:
  - `DB_USERNAME`
  - `DB_PASSWORD`
  - `DB_DATABASE`

### Error: "permission denied"
- **Cause:** User doesn't have permission
- **Fix:** Use a user with proper permissions or create the database as postgres user:
  ```bash
  psql -U postgres -c "CREATE DATABASE invoiceme;"
  ```

---

## 📋 Verification

After migration succeeds, verify tables were created:

```bash
psql -U postgres -d invoiceme -c "\dt"
```

You should see these new tables:
- ✅ `invoice_templates`
- ✅ `recurring_invoices`
- ✅ `api_keys`
- ✅ `user_settings`

And verify `clients` table has new column:
```bash
psql -U postgres -d invoiceme -c "\d clients"
```

Should show:
- ✅ `avatar_url` column

---

## 🎯 Summary

**Status:**
- ✅ Flutter dependencies: **FIXED**
- ⚠️ Migrations: **WAITING FOR POSTGRESQL**

**Next Action:**
1. Start PostgreSQL (choose one method above)
2. Run migration command
3. Verify tables created

**Once PostgreSQL is running, the migration takes ~5 seconds!**

