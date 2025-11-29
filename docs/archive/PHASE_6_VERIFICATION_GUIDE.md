# Phase 6 - Next Steps & Verification Guide

## Prerequisites Check

Before running migrations and tests, ensure:

1. **Node.js 20+ is installed**
   ```bash
   node --version
   ```

2. **PostgreSQL is running**
   ```bash
   # Check if PostgreSQL is running
   pg_isready
   ```

3. **Environment variables are set**
   - Copy `backend/env.example` to `backend/.env`
   - Configure database connection details

## Step 1: Install Dependencies

```bash
cd backend
npm install
```

This will install all required packages including:
- NestJS framework
- TypeORM
- Jest testing framework
- All other dependencies

## Step 2: Configure Environment

Create `.env` file in `backend/` directory:

```bash
cd backend
cp env.example .env
```

Edit `.env` with your database credentials:
```env
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_DATABASE=invoiceme
```

## Step 3: Run Database Migrations

**Note:** The migration system uses TypeORM CLI. You have two options:

### Option A: Manual SQL Execution (Recommended for now)

Run migrations manually using `psql`:

```bash
# Connect to PostgreSQL
psql -U postgres -d invoiceme

# Run each migration file in order
\i migrations/001_create_users_table.sql
\i migrations/002_create_clients_table.sql
\i migrations/003_create_invoices_table.sql
\i migrations/004_create_invoice_items_table.sql
\i migrations/005_create_attachments_table.sql
\i migrations/006_create_payments_table.sql
\i migrations/007_create_device_changes_table.sql
\i migrations/008_create_refresh_tokens_table.sql
\i migrations/009_create_password_reset_tokens_table.sql
\i migrations/010_create_audit_logs_table.sql
```

### Option B: TypeORM CLI (If configured)

If you have TypeORM CLI properly configured:

```bash
npm run migration:run
```

**Note:** The current `data-source.ts` is configured for TypeORM migrations, but SQL files need to be executed manually or converted to TypeORM migration format.

## Step 4: Run Tests

```bash
npm test
```

Expected output:
- Invoice math calculation tests (calculateLineTotal, calculateTotals)
- Sync service tests (pushChanges, pullChanges)

To run with coverage:
```bash
npm run test:cov
```

## Step 5: Verify Application Starts

```bash
npm run start:dev
```

Expected output:
```
Application is running on: http://localhost:3000/api
API Documentation available at: http://localhost:3000/api/docs
```

## Troubleshooting

### Dependencies Not Installed
```bash
cd backend
npm install
```

### Database Connection Issues
- Verify PostgreSQL is running
- Check `.env` file has correct credentials
- Ensure database `invoiceme` exists:
  ```sql
  CREATE DATABASE invoiceme;
  ```

### Migration Issues
- Migrations are SQL files - run them manually with `psql`
- Or convert to TypeORM migration format for CLI usage

### Test Failures
- Ensure all dependencies are installed
- Check that test files are properly configured
- Verify Jest configuration in `jest.config.js`

## Quick Verification Checklist

- [ ] Dependencies installed (`npm install`)
- [ ] `.env` file configured
- [ ] Database created and migrations run
- [ ] Tests pass (`npm test`)
- [ ] Application starts (`npm run start:dev`)
- [ ] API accessible at `http://localhost:3000/api`
- [ ] Swagger docs at `http://localhost:3000/api/docs`

## Next Steps After Verification

1. **Test API Endpoints:**
   - Register a user: `POST /api/v1/auth/register`
   - Login: `POST /api/v1/auth/login`
   - Create client: `POST /api/v1/clients`
   - Create invoice: `POST /api/v1/invoices`
   - Test pagination: `GET /api/v1/invoices?page=1&limit=10`

2. **Verify Audit Logs:**
   - Check `audit_logs` table after API calls
   - Verify logs are created for CREATE, UPDATE, DELETE actions

3. **Test Math Calculations:**
   - Create invoice with items having tax and discount
   - Verify totals are calculated correctly

4. **Test Sync:**
   - Use sync endpoints to push/pull changes
   - Verify offline sync functionality

All Phase 6 features are implemented and ready for verification!

