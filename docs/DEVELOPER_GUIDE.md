# 👨‍💻 InvoiceMe Developer Guide

Complete guide for developers working on InvoiceMe.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Project Architecture](#project-architecture)
3. [Folder Structure](#folder-structure)
4. [Development Workflow](#development-workflow)
5. [Code Standards](#code-standards)
6. [Testing](#testing)
7. [Contributing](#contributing)

---

## Getting Started

### Prerequisites

- **Node.js** 18+ and npm
- **PostgreSQL** 14+
- **Flutter** 3.0+ (for mobile development)
- **Docker** (optional, for containerized deployment)
- **Git**

### Initial Setup

#### Backend Setup

```bash
# Clone repository
git clone <repository-url>
cd invoice-maker/backend

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your configuration
# Required: DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_DATABASE
# Required: JWT_SECRET, JWT_REFRESH_SECRET

# Run migrations
npm run migration:run

# Start development server
npm run start:dev
```

Backend will be available at `http://localhost:3000/api`

#### Mobile Setup

```bash
cd mobile

# Install dependencies
flutter pub get

# Run on device/emulator
flutter run

# Or build for specific platform
flutter build apk        # Android
flutter build ios       # iOS
flutter build web       # Web
```

---

## Project Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Client Devices                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐             │
│  │  iPhone  │  │ Android  │  │  Desktop │             │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘             │
│       │              │              │                   │
│       └──────────────┼──────────────┘                   │
│                      │                                   │
│              ┌───────▼────────┐                          │
│              │  Flutter App   │                          │
│              │  (Offline-First)│                        │
│              │  - SQLite Cache│                         │
│              │  - Sync Service│                         │
│              └───────┬────────┘                          │
└──────────────────────┼──────────────────────────────────┘
                       │
                       │ HTTPS/REST API
                       │
┌──────────────────────▼──────────────────────────────────┐
│              Customer-Hosted Backend                    │
│  ┌──────────────────────────────────────────────┐     │
│  │         NestJS API Server                     │     │
│  │  - Authentication (JWT)                       │     │
│  │  - Business Logic                            │     │
│  │  - PDF Generation                            │     │
│  │  - File Storage (S3/MinIO)                   │     │
│  └───────────────┬──────────────────────────────┘     │
│                  │                                      │
│  ┌───────────────▼───────────────┐                     │
│  │      PostgreSQL Database      │                     │
│  │  - Users, Clients, Invoices   │                     │
│  │  - Audit Logs                 │                     │
│  │  - Sync Queue                 │                     │
│  └───────────────────────────────┘                     │
│                                                          │
│  ┌───────────────┐  ┌───────────────┐                  │
│  │  S3/MinIO     │  │  Email (SMTP) │                  │
│  │  (Files)      │  │  (Nodemailer) │                  │
│  └───────────────┘  └───────────────┘                  │
└──────────────────────────────────────────────────────────┘
```

### Technology Stack

**Backend:**
- **NestJS** - Progressive Node.js framework
- **TypeORM** - ORM for PostgreSQL
- **PostgreSQL** - Relational database
- **JWT** - Authentication
- **Puppeteer** - PDF generation
- **AWS SDK** - S3-compatible storage
- **Stripe** - Payment processing

**Mobile:**
- **Flutter** - Cross-platform UI framework
- **Riverpod** - State management
- **SQLite (sqflite)** - Local database
- **Dio** - HTTP client
- **flutter_secure_storage** - Secure token storage

---

## Folder Structure

### Backend Structure

```
backend/
├── src/
│   ├── auth/                    # Authentication module
│   │   ├── auth.controller.ts    # Auth endpoints
│   │   ├── auth.service.ts       # Auth business logic
│   │   ├── auth.module.ts        # Auth module
│   │   ├── dto/                  # Auth DTOs
│   │   ├── guards/               # Auth guards
│   │   └── decorators/           # Custom decorators
│   │
│   ├── clients/                  # Client management
│   │   ├── clients.controller.ts
│   │   ├── clients.service.ts
│   │   ├── clients.module.ts
│   │   └── dto/
│   │
│   ├── invoices/                 # Invoice management
│   │   ├── invoices.controller.ts
│   │   ├── invoices.service.ts
│   │   ├── invoices.module.ts
│   │   ├── invoice-status.service.ts  # Cron jobs
│   │   └── dto/
│   │
│   ├── payments/                 # Payment processing
│   │   ├── payments.controller.ts
│   │   ├── payments.service.ts
│   │   └── webhooks.controller.ts
│   │
│   ├── sync/                     # Offline sync
│   │   ├── sync.controller.ts
│   │   └── sync.service.ts
│   │
│   ├── gdpr/                     # GDPR compliance
│   │   ├── gdpr.controller.ts
│   │   └── gdpr.module.ts
│   │
│   ├── core/                     # Core services
│   │   ├── services/             # Shared services
│   │   │   ├── pdf.service.ts
│   │   │   ├── s3.service.ts
│   │   │   ├── stripe.service.ts
│   │   │   ├── email.service.ts
│   │   │   ├── audit.service.ts
│   │   │   ├── cache.service.ts
│   │   │   ├── encryption.service.ts
│   │   │   └── gdpr.service.ts
│   │   ├── filters/              # Exception filters
│   │   ├── middleware/           # Custom middleware
│   │   ├── strategies/           # Passport strategies
│   │   ├── dto/                  # Shared DTOs
│   │   └── utils/                # Utility functions
│   │
│   ├── entities/                 # TypeORM entities
│   │   ├── user.entity.ts
│   │   ├── client.entity.ts
│   │   ├── invoice.entity.ts
│   │   └── ...
│   │
│   ├── health/                   # Health checks
│   │
│   ├── app.module.ts             # Root module
│   └── main.ts                   # Application entry
│
├── migrations/                   # Database migrations
├── test/                         # E2E tests
├── docker-compose.yml            # Docker setup
├── Dockerfile                    # Production image
└── package.json
```

### Mobile Structure

```
mobile/
├── lib/
│   ├── core/
│   │   ├── database/             # SQLite database
│   │   │   └── database_helper.dart
│   │   ├── services/            # Business logic
│   │   │   ├── api_client.dart
│   │   │   ├── auth_service.dart
│   │   │   └── sync_service.dart
│   │   ├── providers/           # Riverpod providers
│   │   │   └── providers.dart
│   │   └── widgets/            # Shared widgets
│   │       └── copyable_error.dart
│   │
│   ├── models/                   # Data models
│   │   ├── client.dart
│   │   ├── invoice.dart
│   │   └── invoice_item.dart
│   │
│   ├── screens/                  # UI screens
│   │   ├── login_screen.dart
│   │   ├── dashboard_screen.dart
│   │   ├── clients_screen.dart
│   │   ├── invoices_screen.dart
│   │   └── ...
│   │
│   ├── widgets/                  # Reusable widgets
│   │   ├── empty_state.dart
│   │   ├── loading_skeleton.dart
│   │   ├── lazy_image.dart
│   │   └── ...
│   │
│   └── main.dart                 # App entry point
│
├── pubspec.yaml                  # Dependencies
└── analysis_options.yaml         # Linter config
```

---

## Development Workflow

### Branch Strategy

- `main` - Production-ready code
- `develop` - Development branch
- `feature/*` - Feature branches
- `fix/*` - Bug fix branches

### Commit Convention

```
feat: Add invoice duplication feature
fix: Fix pagination bug in client list
docs: Update API documentation
refactor: Optimize invoice query performance
test: Add unit tests for client service
```

### Code Review Process

1. Create feature branch
2. Implement changes
3. Write/update tests
4. Update documentation
5. Create pull request
6. Code review
7. Merge to develop
8. Deploy to staging
9. Merge to main

---

## Code Standards

### TypeScript/Backend

- **Naming:** camelCase for variables/functions, PascalCase for classes
- **Files:** kebab-case for files (e.g., `auth.service.ts`)
- **Imports:** Group by external, internal, relative
- **Error Handling:** Use NestJS exceptions (NotFoundException, ForbiddenException)
- **Validation:** All DTOs must use class-validator decorators
- **Documentation:** JSDoc comments for public methods

### Dart/Flutter

- **Naming:** camelCase for variables/functions, PascalCase for classes
- **Files:** snake_case for files (e.g., `invoice_detail_screen.dart`)
- **Widgets:** Extract reusable widgets to separate files
- **State Management:** Use Riverpod for state
- **Error Handling:** Use try-catch with user-friendly messages
- **Documentation:** Dartdoc comments for public APIs

### Database

- **Naming:** snake_case for tables and columns
- **Primary Keys:** Always UUID v4
- **Timestamps:** UTC, stored as TIMESTAMPTZ
- **Soft Deletes:** Use `deleted_at` column
- **Indexes:** Add indexes for frequently queried columns

---

## Testing

### Backend Tests

```bash
# Unit tests
npm test

# E2E tests
npm run test:e2e

# Coverage
npm run test:cov
```

### Flutter Tests

```bash
# Unit tests
flutter test

# Widget tests
flutter test test/widget_test.dart

# Integration tests
flutter test integration_test/
```

---

## Contributing

### Adding a New Feature

1. **Create Feature Branch**
   ```bash
   git checkout -b feature/new-feature
   ```

2. **Implement Feature**
   - Backend: Add controller, service, DTOs
   - Mobile: Add models, screens, widgets
   - Add tests
   - Update documentation

3. **Test Thoroughly**
   - Unit tests
   - Integration tests
   - Manual testing

4. **Update Documentation**
   - API documentation (Swagger)
   - User manual (if user-facing)
   - Developer guide (if needed)

5. **Create Pull Request**
   - Describe changes
   - Link related issues
   - Request review

---

## Common Tasks

### Adding a New API Endpoint

1. Create DTO in `dto/` folder
2. Add method to service
3. Add controller endpoint with Swagger decorators
4. Add route guard if needed
5. Add audit logging
6. Write tests

### Adding a New Database Table

1. Create entity in `entities/` folder
2. Create migration file
3. Run migration: `npm run migration:run`
4. Update service to use new entity
5. Update DTOs if needed

### Adding a New Flutter Screen

1. Create screen file in `screens/`
2. Add route in `main.dart` (if needed)
3. Create models if needed
4. Add navigation from other screens
5. Test on multiple platforms

---

## Troubleshooting

### Backend Won't Start

1. Check PostgreSQL is running
2. Verify `.env` configuration
3. Check database connection
4. Review error logs

### Mobile App Won't Connect

1. Verify API URL in build command
2. Check CORS configuration
3. Verify backend is running
4. Check network connectivity

### Database Migration Fails

1. Check migration file syntax
2. Verify database connection
3. Check for conflicting migrations
4. Review migration logs

---

## Resources

- [NestJS Documentation](https://docs.nestjs.com/)
- [Flutter Documentation](https://flutter.dev/docs)
- [TypeORM Documentation](https://typeorm.io/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)

---

**Last Updated:** January 2025

