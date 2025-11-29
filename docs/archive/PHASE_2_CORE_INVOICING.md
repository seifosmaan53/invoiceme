# Phase 2 - Core Invoicing: Complete

## Overview

Phase 2 implements the core invoicing functionality with client management, invoice creation with automatic totals calculation, estimate support, and estimate-to-invoice conversion.

## ✅ Completed Endpoints

### 1. Client Management

#### POST /v1/clients
Create a new client.

**Request Body:**
```json
{
  "name": "Acme Corporation",
  "email": "contact@acme.com",
  "phone": "+1234567890",
  "addressJson": {
    "street": "123 Main St",
    "city": "New York",
    "state": "NY",
    "zip": "10001",
    "country": "USA"
  }
}
```

**Response (201 Created):**
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "userId": "123e4567-e89b-12d3-a456-426614174001",
  "name": "Acme Corporation",
  "email": "contact@acme.com",
  "phone": "+1234567890",
  "addressJson": {
    "street": "123 Main St",
    "city": "New York",
    "state": "NY",
    "zip": "10001",
    "country": "USA"
  },
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z",
  "deletedAt": null
}
```

**Validation:**
- `name`: Required string
- `email`: Optional, must be valid email format
- `phone`: Optional string
- `addressJson`: Optional object

#### GET /v1/clients
Get all clients for the authenticated user.

**Response (200 OK):**
```json
[
  {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "userId": "123e4567-e89b-12d3-a456-426614174001",
    "name": "Acme Corporation",
    "email": "contact@acme.com",
    "phone": "+1234567890",
    "addressJson": {...},
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z",
    "deletedAt": null
  }
]
```

**Features:**
- Returns only non-deleted clients (soft delete)
- Ordered by creation date (newest first)
- Filtered by authenticated user

### 2. Invoice Management

#### POST /v1/invoices
Create a new invoice or estimate. Server automatically calculates totals from line items.

**Request Body:**
```json
{
  "clientId": "123e4567-e89b-12d3-a456-426614174002",
  "type": "invoice",
  "issueDate": "2024-01-01",
  "dueDate": "2024-01-31",
  "currency": "USD",
  "items": [
    {
      "description": "Web Development Services",
      "quantity": 10,
      "unitPrice": 100.00,
      "taxRate": 8.0,
      "discountRate": 0.0
    },
    {
      "description": "Consulting Hours",
      "quantity": 5,
      "unitPrice": 150.00,
      "taxRate": 8.0,
      "discountRate": 10.0
    }
  ],
  "notes": "Payment terms: Net 30"
}
```

**Response (201 Created):**
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174003",
  "userId": "123e4567-e89b-12d3-a456-426614174001",
  "clientId": "123e4567-e89b-12d3-a456-426614174002",
  "type": "invoice",
  "number": "INV-2024-0001",
  "status": "draft",
  "issueDate": "2024-01-01",
  "dueDate": "2024-01-31",
  "currency": "USD",
  "subtotal": 1750.00,
  "taxTotal": 133.00,
  "discountTotal": 75.00,
  "total": 1808.00,
  "notes": "Payment terms: Net 30",
  "metadataJson": null,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z",
  "deletedAt": null,
  "client": {...},
  "items": [
    {
      "id": "123e4567-e89b-12d3-a456-426614174004",
      "invoiceId": "123e4567-e89b-12d3-a456-426614174003",
      "description": "Web Development Services",
      "quantity": 10,
      "unitPrice": 100.00,
      "taxRate": 8.0,
      "discountRate": 0.0,
      "lineTotal": 1080.00,
      "createdAt": "2024-01-01T00:00:00.000Z"
    },
    {
      "id": "123e4567-e89b-12d3-a456-426614174005",
      "invoiceId": "123e4567-e89b-12d3-a456-426614174003",
      "description": "Consulting Hours",
      "quantity": 5,
      "unitPrice": 150.00,
      "taxRate": 8.0,
      "discountRate": 10.0,
      "lineTotal": 728.00,
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

**Automatic Calculations:**
- **Line Total**: `(quantity × unitPrice) - discount + tax`
- **Subtotal**: Sum of all `(quantity × unitPrice)`
- **Discount Total**: Sum of all discounts applied
- **Tax Total**: Sum of all taxes (applied after discount)
- **Grand Total**: `subtotal - discountTotal + taxTotal`

**Calculation Logic:**
1. For each item:
   - Calculate base amount: `quantity × unitPrice`
   - Apply discount: `baseAmount × (discountRate / 100)`
   - Calculate after discount: `baseAmount - discount`
   - Apply tax: `afterDiscount × (taxRate / 100)`
   - Line total: `afterDiscount + tax`

2. Aggregate totals:
   - Subtotal: Sum of all base amounts
   - Discount Total: Sum of all discounts
   - Tax Total: Sum of all taxes
   - Total: Subtotal - Discount Total + Tax Total

**Invoice Number Generation:**
- Format: `{PREFIX}-{YEAR}-{SEQUENCE}`
- Invoice: `INV-2024-0001`
- Estimate: `EST-2024-0001`
- Sequenced per user and type
- Resets sequence if year changes

**Validation:**
- `clientId`: Required UUID, must belong to user
- `type`: Optional enum ('invoice' or 'estimate'), defaults to 'invoice'
- `issueDate`: Required date string (ISO 8601)
- `dueDate`: Optional date string
- `currency`: Optional string (defaults to 'USD')
- `items`: Required array with at least one item
- Each item requires: `description`, `quantity`, `unitPrice`
- Optional per item: `taxRate`, `discountRate` (as percentages)

#### GET /v1/invoices/:id
Get a specific invoice by ID.

**Response (200 OK):**
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174003",
  "userId": "123e4567-e89b-12d3-a456-426614174001",
  "clientId": "123e4567-e89b-12d3-a456-426614174002",
  "type": "invoice",
  "number": "INV-2024-0001",
  "status": "draft",
  "issueDate": "2024-01-01",
  "dueDate": "2024-01-31",
  "currency": "USD",
  "subtotal": 1750.00,
  "taxTotal": 133.00,
  "discountTotal": 75.00,
  "total": 1808.00,
  "notes": "Payment terms: Net 30",
  "client": {
    "id": "123e4567-e89b-12d3-a456-426614174002",
    "name": "Acme Corporation",
    "email": "contact@acme.com",
    ...
  },
  "items": [
    {
      "id": "123e4567-e89b-12d3-a456-426614174004",
      "description": "Web Development Services",
      "quantity": 10,
      "unitPrice": 100.00,
      "taxRate": 8.0,
      "discountRate": 0.0,
      "lineTotal": 1080.00,
      ...
    }
  ],
  ...
}
```

**Features:**
- Returns invoice with client and items relations
- Validates user ownership
- Returns 404 if invoice not found
- Returns 403 if user doesn't own invoice

### 3. Estimate Support

Estimates are supported via the `type` field in the invoice creation endpoint.

**Creating an Estimate:**
```json
{
  "clientId": "123e4567-e89b-12d3-a456-426614174002",
  "type": "estimate",
  "issueDate": "2024-01-01",
  "items": [...]
}
```

**Features:**
- Estimates use `EST-YYYY-####` numbering
- Same calculation logic as invoices
- Same status workflow
- Can be converted to invoices

### 4. Convert Estimate to Invoice

#### POST /v1/invoices/:id/convert
Convert an estimate to an invoice by creating a new invoice that clones the estimate.

**Request:** No body required

**Response (201 Created):**
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174006",
  "userId": "123e4567-e89b-12d3-a456-426614174001",
  "clientId": "123e4567-e89b-12d3-a456-426614174002",
  "type": "invoice",
  "number": "INV-2024-0002",
  "status": "draft",
  "issueDate": "2024-01-01",
  "dueDate": "2024-01-31",
  "currency": "USD",
  "subtotal": 1750.00,
  "taxTotal": 133.00,
  "discountTotal": 75.00,
  "total": 1808.00,
  "notes": "Payment terms: Net 30",
  "client": {...},
  "items": [
    {
      "id": "123e4567-e89b-12d3-a456-426614174007",
      "description": "Web Development Services",
      "quantity": 10,
      "unitPrice": 100.00,
      "taxRate": 8.0,
      "discountRate": 0.0,
      "lineTotal": 1080.00,
      ...
    }
  ],
  ...
}
```

**Conversion Process:**
1. Validates that source is an estimate
2. Creates new invoice with same data
3. Generates new invoice number
4. Sets status to 'draft'
5. Clones all line items
6. Preserves totals, dates, notes, metadata
7. Original estimate remains unchanged

**Error Responses:**
- `400 Bad Request`: If source is not an estimate
- `404 Not Found`: If estimate doesn't exist
- `403 Forbidden`: If user doesn't own estimate

## Implementation Details

### Database Transactions

All invoice creation and conversion operations use database transactions to ensure:
- Atomicity: All or nothing
- Consistency: Related data stays in sync
- Rollback on errors

### Calculation Precision

All monetary calculations use:
- Database: `NUMERIC(12,2)` for precise decimal storage
- Application: Rounding to 2 decimal places using `Math.round(value * 100) / 100`

### Security

- All endpoints require JWT authentication
- User ownership validation on all operations
- Client ownership validation when creating invoices
- Soft delete support (archived records not returned)

## Testing Examples

### Create Client
```bash
POST /api/v1/clients
Authorization: Bearer <token>
{
  "name": "Test Client",
  "email": "test@example.com"
}
```

### Create Invoice
```bash
POST /api/v1/invoices
Authorization: Bearer <token>
{
  "clientId": "<client-id>",
  "type": "invoice",
  "issueDate": "2024-01-01",
  "items": [
    {
      "description": "Test Item",
      "quantity": 1,
      "unitPrice": 100.00,
      "taxRate": 10.0
    }
  ]
}
```

### Create Estimate
```bash
POST /api/v1/invoices
Authorization: Bearer <token>
{
  "clientId": "<client-id>",
  "type": "estimate",
  "issueDate": "2024-01-01",
  "items": [...]
}
```

### Convert Estimate
```bash
POST /api/v1/invoices/<estimate-id>/convert
Authorization: Bearer <token>
```

## Phase 2 Checklist

- ✅ POST /v1/clients - Create client
- ✅ GET /v1/clients - List clients
- ✅ POST /v1/invoices - Create invoice with automatic totals
- ✅ GET /v1/invoices/:id - Get invoice
- ✅ Estimate support via type = 'estimate'
- ✅ POST /v1/invoices/:id/convert - Clone estimate to invoice

## Next Steps

Phase 2 is complete. Ready for:
- Phase 3: Additional Features (PDF generation, attachments, payments)
- Phase 4: Mobile App Integration
- Phase 5: Advanced Features

All core invoicing functionality is implemented and tested.

