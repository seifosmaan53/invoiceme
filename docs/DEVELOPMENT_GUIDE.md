# InvoiceMe Development Guide

## Quick Start

### Backend Setup

```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your configuration
npm run migration:run
npm run start:dev
```

Backend will be available at `http://localhost:3000/api`

### Mobile Setup

```bash
cd mobile
flutter pub get
flutter run
```

## Project Structure

```
invoice-maker/
├── backend/
│   ├── migrations/          # SQL migration files
│   ├── src/
│   │   ├── auth/            # Authentication module
│   │   ├── clients/        # Client management
│   │   ├── invoices/       # Invoice management
│   │   ├── payments/       # Payment processing
│   │   ├── sync/           # Offline sync
│   │   ├── core/           # Core services (PDF, S3, Stripe)
│   │   └── entities/       # TypeORM entities
│   └── package.json
├── mobile/
│   └── lib/
│       ├── core/
│       │   ├── database/   # SQLite database helper
│       │   └── services/   # API client, sync service
│       ├── models/         # Data models
│       └── features/       # UI screens (to be implemented)
├── docs/
│   ├── SYSTEM_OVERVIEW.md
│   ├── API_DOCUMENTATION.md
│   ├── DATABASE_SCHEMA.md
│   └── CI_CD.md
└── README.md
```

## Key Features Implemented

### Backend

✅ User authentication (register, login, refresh tokens, password reset)
✅ Client management (CRUD with soft delete)
✅ Invoice & estimate management
✅ Line items with automatic totals calculation
✅ Convert estimates to invoices
✅ PDF generation and S3 storage
✅ Attachment uploads (images, PDFs)
✅ Stripe payment integration
✅ Offline sync endpoints (/sync/push, /sync/pull)
✅ Webhook handlers for Stripe events

### Mobile

✅ Local SQLite database with schema matching server
✅ Data models (Client, Invoice, InvoiceItem)
✅ API client with JWT authentication
✅ Sync service for offline/online synchronization
✅ Pending changes queue for offline edits

## API Endpoints

### Authentication
- `POST /api/v1/auth/register` - Register new user
- `POST /api/v1/auth/login` - Login
- `POST /api/v1/auth/refresh` - Refresh access token
- `POST /api/v1/auth/password-reset` - Request password reset
- `POST /api/v1/auth/password-reset/confirm` - Confirm password reset

### Clients
- `GET /api/v1/clients` - List clients
- `POST /api/v1/clients` - Create client
- `GET /api/v1/clients/:id` - Get client
- `PATCH /api/v1/clients/:id` - Update client
- `DELETE /api/v1/clients/:id` - Archive client

### Invoices
- `GET /api/v1/invoices` - List invoices
- `POST /api/v1/invoices` - Create invoice/estimate
- `GET /api/v1/invoices/:id` - Get invoice
- `PATCH /api/v1/invoices/:id` - Update invoice
- `DELETE /api/v1/invoices/:id` - Delete invoice
- `POST /api/v1/invoices/:id/convert` - Convert estimate to invoice
- `POST /api/v1/invoices/:id/send` - Send invoice (stub)
- `POST /api/v1/invoices/:id/attachments` - Upload attachment
- `POST /api/v1/invoices/:id/pdf` - Generate PDF
- `POST /api/v1/invoices/:id/pay` - Create payment intent

### Sync
- `POST /api/v1/sync/push` - Push pending changes
- `GET /api/v1/sync/pull` - Pull server changes

### Webhooks
- `POST /api/v1/webhooks/stripe` - Stripe webhook handler

## Database Schema

All tables use UUID primary keys and UTC timestamps:

- `users` - User accounts
- `clients` - Client contacts (soft delete)
- `invoices` - Invoices and estimates (soft delete)
- `invoice_items` - Line items
- `attachments` - File attachments
- `payments` - Payment records
- `device_changes` - Sync queue
- `refresh_tokens` - JWT refresh tokens
- `password_reset_tokens` - Password reset tokens

See `docs/DATABASE_SCHEMA.md` for complete schema.

## Environment Variables

See `backend/.env.example` for required variables:

- Database: `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE`
- JWT: `JWT_SECRET`, `JWT_EXPIRES_IN`, `JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRES_IN`
- S3: `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`
- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`

## Testing

### Backend
```bash
npm test
npm run test:e2e
```

### Mobile
```bash
flutter test
```

## Development Guidelines

1. **Naming**: Use snake_case for database fields, camelCase for TypeScript/JavaScript
2. **UUIDs**: Always use UUID v4 for primary keys
3. **Timestamps**: Store in UTC, convert to local time in UI
4. **Validation**: All DTOs must have class-validator decorators
5. **Transactions**: Use database transactions for multi-step operations
6. **Error Handling**: Provide meaningful error messages
7. **Field Consistency**: Field names must match between backend DTOs and mobile models

## Next Steps

### Mobile UI Implementation

Create Flutter screens:
- Dashboard (stats: unpaid, overdue, total this month)
- Clients list → client details
- Invoices list → invoice details → edit

### Email Service

Replace email stub with actual email provider (SendGrid, AWS SES).

### Additional Features

- Recurring invoices
- Invoice templates
- Multi-currency support
- Advanced reporting
- Mobile push notifications

## Documentation

- `docs/SYSTEM_OVERVIEW.md` - System architecture and design
- `docs/API_DOCUMENTATION.md` - Complete API reference
- `docs/DATABASE_SCHEMA.md` - Database schema reference
- `docs/CI_CD.md` - Deployment and CI/CD guide

## Support

For issues or questions, refer to the documentation or check the code comments for implementation details.

