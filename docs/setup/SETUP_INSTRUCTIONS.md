# 🚀 Setup Instructions

## ✅ Completed

### 1. Flutter Dependencies Fixed ✅
- Updated `intl` from `^0.18.1` to `^0.20.2`
- Removed `intl_translation` (not needed)
- Ran `flutter pub upgrade --major-versions`
- All dependencies resolved successfully

**Status:** ✅ **COMPLETE**

---

## ⚠️ Migration Setup Required

### Issue: PostgreSQL Not Running

The migration failed because PostgreSQL is not currently running on your system.

### Solution Options:

#### Option 1: Start PostgreSQL (Recommended)

**macOS (using Homebrew):**
```bash
# Start PostgreSQL service
brew services start postgresql@14
# OR
brew services start postgresql@15
# OR
brew services start postgresql@16

# Verify it's running
pg_isready
```

**macOS (using Postgres.app):**
- Open Postgres.app from Applications
- Click "Start" if it's not running

**Linux:**
```bash
sudo systemctl start postgresql
# OR
sudo service postgresql start
```

**Docker (Alternative):**
```bash
docker run --name postgres-invoiceme \
  -e POSTGRES_PASSWORD=yourpassword \
  -e POSTGRES_DB=invoiceme \
  -p 5432:5432 \
  -d postgres:15
```

#### Option 2: Check Your Database Configuration

Verify your database connection settings in `backend/.env`:

```env
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=your_username
DB_PASSWORD=your_password
DB_DATABASE=invoiceme
```

#### Option 3: Run Migration Manually (If PostgreSQL is Running Elsewhere)

If PostgreSQL is running but on a different host/port, update `backend/migrations/data-source.ts` with the correct connection details, then run:

```bash
cd backend
npm run migration:run -- -d migrations/data-source.ts
```

---

## 📋 Migration Checklist

Once PostgreSQL is running:

1. **Verify PostgreSQL is running:**
   ```bash
   pg_isready
   ```

2. **Check database exists:**
   ```bash
   psql -U your_username -l | grep invoiceme
   ```

3. **Create database if needed:**
   ```bash
   createdb invoiceme
   # OR
   psql -U your_username -c "CREATE DATABASE invoiceme;"
   ```

4. **Run migration:**
   ```bash
   cd "/Users/seifosman/Desktop/invoice maker/backend"
   npm run migration:run -- -d migrations/data-source.ts
   ```

---

## 🎯 Next Steps After Migration

Once migrations run successfully:

1. **Verify tables created:**
   ```bash
   psql -U your_username -d invoiceme -c "\dt"
   ```

   You should see:
   - `invoice_templates`
   - `recurring_invoices`
   - `api_keys`
   - `user_settings`
   - `clients` (with `avatar_url` column)

2. **Test the app:**
   - Start backend: `cd backend && npm run start:dev`
   - Start Flutter: `cd mobile && flutter run`

---

## 📝 Summary

### ✅ Completed:
- Flutter dependencies fixed
- `intl` version conflict resolved
- All packages upgraded

### ⚠️ Pending:
- PostgreSQL needs to be started
- Migration needs to be run once PostgreSQL is available

### 🔧 To Complete Setup:

1. **Start PostgreSQL** (see options above)
2. **Run migration:**
   ```bash
   cd backend
   npm run migration:run -- -d migrations/data-source.ts
   ```
3. **Verify migration success** (check for "X migrations executed")

---

**Once PostgreSQL is running, the migration will complete in seconds!**

