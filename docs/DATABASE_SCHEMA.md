# InvoiceMe Database Schema Reference

## Overview

InvoiceMe uses PostgreSQL 14+ with UUID primary keys and UTC timestamps. All tables follow consistent naming conventions (snake_case) and include audit fields (`created_at`, `updated_at`).

## Tables

### users

Stores user account information and authentication data.

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    company_name VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

**Indexes:**
- `idx_users_email` on `email`
- `idx_users_created_at` on `created_at`

### clients

Stores client contact information with soft delete support.

```sql
CREATE TABLE clients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    address_json JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);
```

**Indexes:**
- `idx_clients_user_id` on `user_id`
- `idx_clients_deleted_at` on `deleted_at`
- `idx_clients_email` on `email`

### invoices

Stores invoices and estimates with calculated totals.

```sql
CREATE TYPE invoice_type AS ENUM ('invoice', 'estimate');
CREATE TYPE invoice_status AS ENUM ('draft', 'sent', 'paid', 'overdue', 'cancelled');

CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
    type invoice_type NOT NULL DEFAULT 'invoice',
    number VARCHAR(50) NOT NULL,
    status invoice_status NOT NULL DEFAULT 'draft',
    issue_date DATE NOT NULL,
    due_date DATE,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
    tax_total NUMERIC(12,2) NOT NULL DEFAULT 0,
    discount_total NUMERIC(12,2) NOT NULL DEFAULT 0,
    total NUMERIC(12,2) NOT NULL DEFAULT 0,
    notes TEXT,
    metadata_json JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(user_id, number)
);
```

**Indexes:**
- `idx_invoices_user_id` on `user_id`
- `idx_invoices_client_id` on `client_id`
- `idx_invoices_type` on `type`
- `idx_invoices_status` on `status`
- `idx_invoices_deleted_at` on `deleted_at`
- `idx_invoices_number` on `number`
- `idx_invoices_due_date` on `due_date`

### invoice_items

Stores line items for invoices with per-item tax and discount rates.

```sql
CREATE TABLE invoice_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    quantity NUMERIC(10,2) NOT NULL,
    unit_price NUMERIC(12,2) NOT NULL,
    tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
    discount_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
    line_total NUMERIC(12,2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

**Indexes:**
- `idx_invoice_items_invoice_id` on `invoice_id`

### attachments

Stores file attachments (images, PDFs) linked to invoices or clients.

```sql
CREATE TYPE attachment_owner_type AS ENUM ('invoice', 'client');

CREATE TABLE attachments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_type attachment_owner_type NOT NULL,
    owner_id UUID NOT NULL,
    url TEXT NOT NULL,
    filename VARCHAR(255) NOT NULL,
    content_type VARCHAR(100),
    size_bytes INTEGER,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

**Indexes:**
- `idx_attachments_owner` on `owner_type, owner_id`

### payments

Stores payment records from Stripe and other payment providers.

```sql
CREATE TYPE payment_status AS ENUM ('pending', 'completed', 'failed', 'refunded');
CREATE TYPE payment_provider AS ENUM ('stripe', 'paypal', 'other');

CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    provider payment_provider NOT NULL DEFAULT 'stripe',
    provider_payment_id VARCHAR(255) NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    status payment_status NOT NULL DEFAULT 'pending',
    metadata_json JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

**Indexes:**
- `idx_payments_invoice_id` on `invoice_id`
- `idx_payments_provider_payment_id` on `provider_payment_id`
- `idx_payments_status` on `status`

### device_changes

Stores pending changes from mobile devices for sync.

```sql
CREATE TYPE change_type AS ENUM ('create', 'update', 'delete');
CREATE TYPE change_object_type AS ENUM ('client', 'invoice', 'invoice_item', 'attachment');

CREATE TABLE device_changes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id VARCHAR(255) NOT NULL,
    object_type change_object_type NOT NULL,
    object_id UUID NOT NULL,
    change_json JSONB NOT NULL,
    change_type change_type NOT NULL,
    synced BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

**Indexes:**
- `idx_device_changes_user_id` on `user_id`
- `idx_device_changes_device_id` on `device_id`
- `idx_device_changes_synced` on `synced`
- `idx_device_changes_object` on `object_type, object_id`

### refresh_tokens

Stores JWT refresh tokens for authentication.

```sql
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(500) NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

**Indexes:**
- `idx_refresh_tokens_user_id` on `user_id`
- `idx_refresh_tokens_token` on `token`
- `idx_refresh_tokens_expires_at` on `expires_at`

### password_reset_tokens

Stores password reset tokens for password recovery.

```sql
CREATE TABLE password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

**Indexes:**
- `idx_password_reset_tokens_user_id` on `user_id`
- `idx_password_reset_tokens_token` on `token`
- `idx_password_reset_tokens_expires_at` on `expires_at`

## Relationships

- `users` → `clients` (1:N)
- `users` → `invoices` (1:N)
- `clients` → `invoices` (1:N)
- `invoices` → `invoice_items` (1:N)
- `invoices` → `payments` (1:N)
- `users` → `device_changes` (1:N)
- `users` → `refresh_tokens` (1:N)
- `users` → `password_reset_tokens` (1:N)

## Data Types

- **UUID**: Primary keys and foreign keys
- **NUMERIC(12,2)**: Money amounts (supports up to $99,999,999,999.99)
- **NUMERIC(10,2)**: Quantities
- **NUMERIC(5,2)**: Percentages (tax rates, discount rates)
- **TIMESTAMP WITH TIME ZONE**: All timestamps stored in UTC
- **JSONB**: Flexible JSON storage for addresses and metadata
- **TEXT**: Long text fields (notes, descriptions)

## Migration Files

All migrations are in `backend/migrations/`:

1. `001_create_users_table.sql`
2. `002_create_clients_table.sql`
3. `003_create_invoices_table.sql`
4. `004_create_invoice_items_table.sql`
5. `005_create_attachments_table.sql`
6. `006_create_payments_table.sql`
7. `007_create_device_changes_table.sql`
8. `008_create_refresh_tokens_table.sql`
9. `009_create_password_reset_tokens_table.sql`

## Indexing Strategy

- Primary keys: Automatically indexed
- Foreign keys: Indexed for join performance
- Filtered queries: Indexed on commonly filtered columns (`status`, `type`, `deleted_at`)
- Unique constraints: Indexed automatically

## Best Practices

1. Always use UUIDs for primary keys
2. Store timestamps in UTC
3. Use soft deletes for user-facing data (invoices, clients)
4. Use numeric types for money (never float)
5. Index foreign keys and frequently queried columns
6. Use JSONB for flexible schema (addresses, metadata)
7. Cascade deletes appropriately (user deletion cascades to their data)

