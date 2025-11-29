# Phase 1 - Foundations: Complete

## Overview

Phase 1 establishes the foundation of InvoiceMe with properly defined entities, database schema, TypeORM models, and NestJS project setup with authentication, error handling, and validation.

## ✅ Completed Components

### 1. Database Entities (TypeORM)

All entities are defined in `backend/src/entities/`:

#### Core Entities

1. **User** (`user.entity.ts`)
   - UUID primary key
   - Email (unique, indexed)
   - Password hash
   - Name, company name
   - Timestamps (created_at, updated_at)

2. **Client** (`client.entity.ts`)
   - UUID primary key
   - User relationship (many-to-one)
   - Name, email, phone
   - Address JSONB
   - Soft delete (deleted_at)
   - Indexes on user_id, deleted_at, email

3. **Invoice** (`invoice.entity.ts`)
   - UUID primary key
   - User and client relationships
   - Type enum (invoice/estimate)
   - Status enum (draft/sent/paid/overdue/cancelled)
   - Invoice number (unique per user)
   - Dates (issue_date, due_date)
   - Financial fields (subtotal, tax_total, discount_total, total)
   - Notes and metadata JSONB
   - Soft delete (deleted_at)
   - Multiple indexes for performance

4. **InvoiceItem** (`invoice-item.entity.ts`)
   - UUID primary key
   - Invoice relationship (many-to-one, cascade delete)
   - Description, quantity, unit_price
   - Tax and discount rates
   - Calculated line_total
   - Index on invoice_id

5. **Attachment** (`attachment.entity.ts`)
   - UUID primary key
   - Owner type enum (invoice/client)
   - Owner ID
   - URL (VARCHAR 500), filename (VARCHAR 255)
   - Content type, size
   - Index on (owner_type, owner_id)

6. **Payment** (`payment.entity.ts`)
   - UUID primary key
   - Invoice relationship
   - Provider enum (stripe/paypal/other)
   - Provider payment ID (indexed)
   - Amount, currency
   - Status enum (pending/completed/failed/refunded)
   - Metadata JSONB
   - Indexes on invoice_id, provider, status, provider_payment_id

7. **DeviceChange** (`device-change.entity.ts`)
   - UUID primary key
   - User relationship
   - Device ID (VARCHAR 255)
   - Object type enum (client/invoice/invoice_item/attachment)
   - Object ID
   - Change JSONB
   - Change type enum (create/update/delete)
   - Synced boolean
   - Indexes on (user_id, device_id), synced, created_at

8. **RefreshToken** (`refresh-token.entity.ts`)
   - UUID primary key
   - User relationship
   - Token (unique, indexed)
   - Expires at (indexed)
   - Created at

9. **PasswordResetToken** (`password-reset-token.entity.ts`)
   - UUID primary key
   - User relationship
   - Token (unique, indexed)
   - Expires at (indexed)
   - Used boolean
   - Created at

### 2. SQL Migrations

All migrations are in `backend/migrations/`:

1. `001_create_users_table.sql` - Users table with UUID extension
2. `002_create_clients_table.sql` - Clients with soft delete
3. `003_create_invoices_table.sql` - Invoices/estimates with enums
4. `004_create_invoice_items_table.sql` - Line items
5. `005_create_attachments_table.sql` - Attachments with owner type enum
6. `006_create_payments_table.sql` - Payments with provider/status enums
7. `007_create_device_changes_table.sql` - Sync queue with change enums
8. `008_create_refresh_tokens_table.sql` - JWT refresh tokens
9. `009_create_password_reset_tokens_table.sql` - Password reset tokens

**Migration Features:**
- UUID primary keys with `uuid_generate_v4()`
- Foreign key constraints with proper CASCADE/RESTRICT
- Indexes on all foreign keys and frequently queried columns
- ENUM types for status fields
- JSONB for flexible data (addresses, metadata)
- Timestamps in UTC (TIMESTAMP WITH TIME ZONE)
- Soft deletes where appropriate (deleted_at)

### 3. Entity-Migration Alignment

All entities match their migrations 1:1:

- ✅ Field names match (snake_case in DB, camelCase in entities)
- ✅ Data types match (NUMERIC precision/scale, VARCHAR lengths, ENUMs)
- ✅ Constraints match (UNIQUE, NOT NULL, defaults)
- ✅ Relationships match (foreign keys, cascade rules)
- ✅ Indexes match (all indexes from migrations are in entities)

### 4. NestJS Project Setup

#### Project Structure

```
backend/
├── src/
│   ├── entities/          # TypeORM entities
│   ├── auth/              # Authentication module
│   ├── clients/           # Client management
│   ├── invoices/          # Invoice management
│   ├── payments/          # Payment processing
│   ├── sync/              # Offline sync
│   ├── core/              # Core services & filters
│   │   ├── filters/       # Global exception filter
│   │   ├── services/      # PDF, S3, Stripe services
│   │   └── strategies/    # Passport strategies
│   └── main.ts            # Application entry point
├── migrations/            # SQL migration files
└── package.json
```

#### Configuration

**Database Module** (`core/database.module.ts`):
- TypeORM configuration
- PostgreSQL connection
- All entities registered
- Synchronize: false (migrations only)

**Core Services Module** (`core/core-services.module.ts`):
- Global module for shared services
- PDF, S3, Stripe services

**Auth Core Module** (`core/auth-core.module.ts`):
- Passport configuration
- JWT strategy
- Local strategy

### 5. Error Handling

**Global Exception Filter** (`core/filters/global-exception.filter.ts`):
- Catches all exceptions
- Transforms to consistent error format
- Logs errors with context
- Returns proper HTTP status codes
- Includes timestamp and path

**Error Response Format:**
```json
{
  "statusCode": 400,
  "message": ["Validation error message"],
  "error": "Bad Request",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "path": "/api/v1/resource"
}
```

### 6. Validation

**Global Validation Pipe** (configured in `main.ts`):
- `whitelist: true` - Strips non-whitelisted properties
- `forbidNonWhitelisted: true` - Throws error on extra properties
- `transform: true` - Transforms payloads to DTO instances
- `transformOptions.enableImplicitConversion: true` - Auto-converts types

**DTO Validation:**
- All DTOs use `class-validator` decorators
- Email validation
- String length validation
- Number validation
- UUID validation
- Enum validation

### 7. CORS Configuration

- Configurable via `CORS_ORIGIN` environment variable
- Default: `*` (allows all origins)
- Methods: GET, POST, PATCH, DELETE, PUT
- Credentials: enabled

### 8. API Documentation

- Swagger/OpenAPI setup
- Available at `/api/docs`
- Bearer token authentication documented
- All endpoints documented

## Verification Checklist

- ✅ All 9 entities defined with TypeORM decorators
- ✅ All 9 migrations match entities exactly
- ✅ UUID primary keys throughout
- ✅ UTC timestamps (timestamptz)
- ✅ Proper indexes on all foreign keys
- ✅ Soft deletes where appropriate
- ✅ Global exception filter implemented
- ✅ Global validation pipe configured
- ✅ CORS enabled
- ✅ Swagger documentation enabled
- ✅ Database module configured
- ✅ All entities registered in database module

## Running Migrations

```bash
cd backend
npm run migration:run
```

## Entity-Migration Mapping

| Entity | Migration | Status |
|--------|-----------|--------|
| User | 001_create_users_table.sql | ✅ Aligned |
| Client | 002_create_clients_table.sql | ✅ Aligned |
| Invoice | 003_create_invoices_table.sql | ✅ Aligned |
| InvoiceItem | 004_create_invoice_items_table.sql | ✅ Aligned |
| Attachment | 005_create_attachments_table.sql | ✅ Aligned |
| Payment | 006_create_payments_table.sql | ✅ Aligned |
| DeviceChange | 007_create_device_changes_table.sql | ✅ Aligned |
| RefreshToken | 008_create_refresh_tokens_table.sql | ✅ Aligned |
| PasswordResetToken | 009_create_password_reset_tokens_table.sql | ✅ Aligned |

## Next Steps

Phase 1 is complete. Ready for:
- Phase 2: API Endpoints Implementation
- Phase 3: Business Logic
- Phase 4: Mobile App Development

All foundations are in place with proper error handling, validation, and database schema alignment.

