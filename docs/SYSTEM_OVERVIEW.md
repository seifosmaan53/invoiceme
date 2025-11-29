# InvoiceMe System Overview

## Introduction

InvoiceMe is a production-ready invoicing and estimate management application designed for small businesses and freelancers. It provides a complete solution for creating invoices, managing clients, processing payments, and handling business documentation with offline-first mobile support.

## Architecture

### Technology Stack

- **Backend**: Node.js 20 + NestJS (RESTful API)
- **Database**: PostgreSQL 14+ (with UUID primary keys)
- **Storage**: S3-compatible storage (attachments and PDFs)
- **Mobile**: Flutter 3.0+ (iOS 15+, Android 8+)
- **Payment Processing**: Stripe
- **Local Database**: SQLite (sqflite) for offline support

### System Architecture Principles

1. **Clean Architecture**: Layered approach (API → Services → Repositories → Database)
2. **UUID Primary Keys**: All entities use UUID v4 for consistent identification
3. **Soft Deletes**: Invoices and clients use `deleted_at` for soft deletion
4. **UTC Timestamps**: All dates/times stored in UTC in database
5. **Offline-First**: Mobile app works offline with sync capability
6. **Consistent Naming**: Field names match between backend DTOs and mobile models (snake_case)

## Core Features

### 1. User Authentication
- Registration with email and password
- JWT-based authentication (access + refresh tokens)
- Password reset functionality
- Token refresh mechanism

### 2. Client Management
- Create, read, update, archive clients
- Store contact information (name, email, phone, address)
- Soft delete support

### 3. Invoice & Estimate Management
- Create invoices and estimates
- Line items with description, quantity, unit price, tax %, discount %
- Automatic calculation of subtotal, tax, discount, and grand total
- Convert estimates to invoices
- Multiple statuses: draft, sent, paid, overdue, cancelled
- Invoice numbering (INV-YYYY-#### or EST-YYYY-####)

### 4. Attachments
- Upload images/PDFs to invoices or clients
- Store in S3-compatible storage
- Metadata tracking (filename, content type, size)

### 5. PDF Generation
- Server-side PDF generation using PDFKit
- Invoice PDFs stored in S3
- Professional invoice layout

### 6. Payments (Stripe Integration)
- Create PaymentIntent from invoice total
- Webhook handling for payment events
- Automatic invoice status updates on payment success

### 7. Offline Mobile Sync
- Local SQLite database caching
- Pending changes queue for offline edits
- Sync service that pushes changes and pulls updates
- Conflict resolution strategy

### 8. Notifications
- Email sending stub (ready for implementation)
- Overdue invoice reminders (database records)

## Database Schema

### Core Tables

- **users**: User accounts and authentication
- **clients**: Client contact information
- **invoices**: Invoices and estimates
- **invoice_items**: Line items for invoices
- **attachments**: File attachments (images, PDFs)
- **payments**: Payment records (Stripe)
- **device_changes**: Sync queue for mobile devices
- **refresh_tokens**: JWT refresh token management

All tables include:
- `id` (UUID primary key)
- `created_at` (timestamptz)
- `updated_at` (timestamptz)
- Soft delete fields where applicable (`deleted_at`)

## API Architecture

### Endpoint Structure

All endpoints follow RESTful conventions:
- `/api/v1/auth/*` - Authentication endpoints
- `/api/v1/clients/*` - Client management
- `/api/v1/invoices/*` - Invoice management
- `/api/v1/sync/*` - Mobile synchronization
- `/api/v1/webhooks/*` - External webhooks (Stripe)

### Request/Response Format

- **Content-Type**: `application/json`
- **Timestamps**: ISO 8601 format (UTC)
- **Money**: Numeric strings or numbers with 2 decimal places
- **Authentication**: Bearer token in `Authorization` header

### Error Handling

Standard HTTP status codes:
- `200 OK` - Success
- `201 Created` - Resource created
- `400 Bad Request` - Validation error
- `401 Unauthorized` - Authentication required
- `403 Forbidden` - Access denied
- `404 Not Found` - Resource not found
- `409 Conflict` - Resource conflict (e.g., duplicate email)

## Mobile Architecture

### Flutter App Structure

```
lib/
├── core/
│   ├── database/          # SQLite database helper
│   ├── services/          # API client, sync service
│   └── models/           # Data models
├── features/
│   ├── auth/             # Authentication screens
│   ├── clients/          # Client management screens
│   ├── invoices/         # Invoice management screens
│   └── dashboard/        # Dashboard screen
└── main.dart            # App entry point
```

### Offline Sync Flow

1. User makes changes while offline
2. Changes stored in `pending_changes` table
3. When online, app calls `/v1/sync/push` with pending changes
4. Server processes changes and updates database
5. App calls `/v1/sync/pull?since=<timestamp>` to get server updates
6. Local database updated with server changes
7. Pending changes marked as synced

### Local Database

The mobile app maintains a local SQLite database mirroring server schema:
- `users_local` - Cached user data
- `clients_local` - Cached clients
- `invoices_local` - Cached invoices
- `invoice_items_local` - Cached invoice items
- `attachments_local` - Cached attachments
- `pending_changes` - Queue for offline changes

## Security

- Passwords hashed with bcrypt (10 rounds)
- JWT tokens with expiration
- Refresh token rotation
- API endpoints protected with JWT guards
- S3 pre-signed URLs for secure file access
- Stripe webhook signature verification

## Deployment

### Backend Requirements
- Node.js 20+
- PostgreSQL 14+
- S3-compatible storage
- Environment variables configured

### Mobile Requirements
- iOS 15+ / Android 8+
- Flutter 3.0+

### Environment Variables

See `.env.example` files for required configuration:
- Database connection
- JWT secrets
- S3 credentials
- Stripe keys

## Extension Points

The system is designed for easy extension:

1. **Email Service**: Replace stub with actual email provider (SendGrid, AWS SES)
2. **Additional Payment Providers**: Add new payment modules
3. **Reporting**: Add analytics and reporting endpoints
4. **Multi-tenant**: Add organization/workspace support
5. **Mobile Platforms**: Extend to web or desktop

## Development Guidelines

1. **Naming**: Use snake_case for database fields, camelCase for TypeScript/JavaScript
2. **UUIDs**: Always use UUID v4 for primary keys
3. **Timestamps**: Always store in UTC, convert to local time in UI
4. **Validation**: All DTOs must have class-validator decorators
5. **Transactions**: Use database transactions for multi-step operations
6. **Error Handling**: Provide meaningful error messages
7. **Testing**: Write unit and integration tests
8. **Documentation**: Keep API docs updated with Swagger

## Future Enhancements

- Recurring invoices
- Invoice templates
- Multi-currency support
- Advanced reporting and analytics
- Team collaboration features
- Mobile push notifications
- Automated payment reminders

