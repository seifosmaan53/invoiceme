# InvoiceMe API Documentation

## Base URL

```
http://localhost:3000/api/v1
```

## Authentication

Most endpoints require authentication via JWT Bearer token:

```
Authorization: Bearer <access_token>
```

## Endpoints

### Authentication

#### POST /auth/register

Register a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securePassword123",
  "name": "John Doe",
  "companyName": "Acme Inc"
}
```

**Response (201 Created):**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "email": "user@example.com",
    "name": "John Doe",
    "companyName": "Acme Inc"
  }
}
```

#### POST /auth/login

Authenticate and get tokens.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**Response (200 OK):**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "email": "user@example.com",
    "name": "John Doe",
    "companyName": "Acme Inc"
  }
}
```

#### POST /auth/refresh

Refresh access token using refresh token.

**Request Body:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response (200 OK):**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### POST /auth/password-reset

Request password reset (sends reset email).

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Response (200 OK):**
```json
{
  "message": "Password reset email sent"
}
```

#### POST /auth/password-reset/confirm

Confirm password reset with token.

**Request Body:**
```json
{
  "token": "reset_token_here",
  "newPassword": "newSecurePassword123"
}
```

**Response (200 OK):**
```json
{
  "message": "Password reset successfully"
}
```

### Clients

#### GET /clients

Get all clients for authenticated user.

**Query Parameters:**
- `archived` (optional): `true` to include archived clients

**Response (200 OK):**
```json
[
  {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "userId": "123e4567-e89b-12d3-a456-426614174001",
    "name": "Acme Corp",
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
]
```

#### POST /clients

Create a new client.

**Request Body:**
```json
{
  "name": "Acme Corp",
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
  "name": "Acme Corp",
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

#### GET /clients/:id

Get a specific client.

**Response (200 OK):**
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "userId": "123e4567-e89b-12d3-a456-426614174001",
  "name": "Acme Corp",
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

#### PATCH /clients/:id

Update a client.

**Request Body:**
```json
{
  "name": "Acme Corporation",
  "email": "newemail@acme.com"
}
```

**Response (200 OK):**
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "name": "Acme Corporation",
  "email": "newemail@acme.com",
  ...
}
```

#### DELETE /clients/:id

Archive (soft delete) a client.

**Response (200 OK):**
```json
{
  "message": "Client archived"
}
```

### Invoices

#### GET /invoices

Get all invoices for authenticated user.

**Query Parameters:**
- `type` (optional): `invoice` or `estimate` to filter by type

**Response (200 OK):**
```json
[
  {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "userId": "123e4567-e89b-12d3-a456-426614174001",
    "clientId": "123e4567-e89b-12d3-a456-426614174002",
    "type": "invoice",
    "number": "INV-2024-0001",
    "status": "draft",
    "issueDate": "2024-01-01",
    "dueDate": "2024-01-31",
    "currency": "USD",
    "subtotal": 1000.00,
    "taxTotal": 80.00,
    "discountTotal": 0.00,
    "total": 1080.00,
    "notes": "Payment terms: Net 30",
    "metadataJson": {},
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z",
    "deletedAt": null,
    "client": {
      "id": "123e4567-e89b-12d3-a456-426614174002",
      "name": "Acme Corp",
      ...
    },
    "items": [
      {
        "id": "123e4567-e89b-12d3-a456-426614174003",
        "invoiceId": "123e4567-e89b-12d3-a456-426614174000",
        "description": "Web Development Services",
        "quantity": 10,
        "unitPrice": 100.00,
        "taxRate": 8.0,
        "discountRate": 0.0,
        "lineTotal": 1080.00,
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    ]
  }
]
```

#### POST /invoices

Create a new invoice or estimate.

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
    }
  ],
  "notes": "Payment terms: Net 30"
}
```

**Response (201 Created):**
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "number": "INV-2024-0001",
  "subtotal": 1000.00,
  "taxTotal": 80.00,
  "total": 1080.00,
  ...
}
```

#### GET /invoices/:id

Get a specific invoice.

**Response (200 OK):**
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "number": "INV-2024-0001",
  "status": "draft",
  "client": {...},
  "items": [...],
  ...
}
```

#### PATCH /invoices/:id

Update an invoice.

**Request Body:**
```json
{
  "status": "sent",
  "items": [
    {
      "description": "Updated Service",
      "quantity": 15,
      "unitPrice": 100.00,
      "taxRate": 8.0
    }
  ]
}
```

**Response (200 OK):**
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "total": 1620.00,
  ...
}
```

#### DELETE /invoices/:id

Delete (soft delete) an invoice.

**Response (200 OK):**
```json
{
  "message": "Invoice deleted"
}
```

#### POST /invoices/:id/convert

Convert an estimate to an invoice.

**Response (200 OK):**
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "type": "invoice",
  "number": "INV-2024-0001",
  "status": "draft",
  ...
}
```

#### POST /invoices/:id/send

Send invoice via email (stub).

**Response (200 OK):**
```json
{
  "message": "Invoice sent (stub)",
  "invoiceId": "123e4567-e89b-12d3-a456-426614174000"
}
```

#### POST /invoices/:id/attachments

Upload an attachment to an invoice.

**Request:** `multipart/form-data`
- `file`: File (image or PDF)

**Response (201 Created):**
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174004",
  "ownerType": "invoice",
  "ownerId": "123e4567-e89b-12d3-a456-426614174000",
  "url": "https://s3.example.com/bucket/invoices/.../file.pdf",
  "filename": "invoice.pdf",
  "contentType": "application/pdf",
  "sizeBytes": 12345,
  "createdAt": "2024-01-01T00:00:00.000Z"
}
```

#### POST /invoices/:id/pdf

Generate and store PDF for invoice.

**Response (200 OK):**
```json
{
  "url": "https://s3.example.com/bucket/pdfs/.../INV-2024-0001.pdf",
  "invoiceId": "123e4567-e89b-12d3-a456-426614174000"
}
```

#### POST /invoices/:id/pay

Create Stripe PaymentIntent for invoice.

**Response (200 OK):**
```json
{
  "clientSecret": "pi_xxx_secret_xxx",
  "paymentIntentId": "pi_xxx"
}
```

### Sync

#### POST /sync/push

Push pending changes from mobile device.

**Request Body:**
```json
{
  "deviceId": "device-uuid-here",
  "changes": [
    {
      "objectType": "invoice",
      "objectId": "123e4567-e89b-12d3-a456-426614174000",
      "changeJson": {
        "status": "sent"
      },
      "changeType": "update"
    }
  ]
}
```

**Response (200 OK):**
```json
{
  "synced": 1
}
```

#### GET /sync/pull

Pull changes from server.

**Query Parameters:**
- `since` (optional): ISO 8601 timestamp to get changes since

**Response (200 OK):**
```json
{
  "clients": [...],
  "invoices": [...],
  "invoiceItems": [...],
  "attachments": [...],
  "lastSyncTimestamp": "2024-01-01T00:00:00.000Z"
}
```

### Webhooks

#### POST /webhooks/stripe

Handle Stripe webhook events.

**Headers:**
- `stripe-signature`: Stripe webhook signature

**Request Body:** (Raw Stripe event payload)

**Response (200 OK):**
```json
{
  "received": true
}
```

## Error Responses

All errors follow this format:

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "error": "Bad Request"
}
```

Common status codes:
- `400` - Bad Request (validation errors)
- `401` - Unauthorized (invalid/missing token)
- `403` - Forbidden (access denied)
- `404` - Not Found (resource doesn't exist)
- `409` - Conflict (duplicate resource)

