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
7. [Build Output and Operational Scripts](#build-output-and-operational-scripts)
8. [Contributing](#contributing)

---

## Getting Started

### Prerequisites

- **Node.js** 20 and npm (CI, the Docker image and update bundles use Node 20)
- **PostgreSQL** 14+
- **Chrome or Chromium**, only to render invoice PDFs from a checkout (see below)
- **Flutter** 3.0+ (for mobile development)
- **Docker** (optional, for containerized deployment)
- **Git**

### Initial Setup

#### Backend Setup

```bash
# Clone repository
git clone <repository-url>
cd invoiceme/backend

# Install dependencies (no browser download, see "Browser for PDF generation")
npm ci

# Copy environment file
cp env.example .env

# Edit .env with your configuration
# Required: DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_DATABASE
# Required: JWT_SECRET, JWT_REFRESH_SECRET

# Run migrations
npm run migration:run -- -d migrations/data-source.ts

# Start development server
npm run start:dev
```

Backend will be available at `http://localhost:3000/api`

#### Browser for PDF generation

`backend/.puppeteerrc.cjs` sets `skipDownload: true`, so `npm ci` never
downloads Puppeteer's own Chrome. Nothing needs `PUPPETEER_SKIP_DOWNLOAD` any
more, and an install cannot stall on that download (its HTTP client has no
timeout). Supported layouts never used that browser: the Docker image uses
Alpine's Chromium (`PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser` in the
Dockerfile) and update bundles use the operating system's browser
(`docs/operations/customer-update.md`).

To render PDFs from a checkout, point `PUPPETEER_EXECUTABLE_PATH` at an
installed Chrome/Chromium. `scripts/find-browser.js` looks in the usual places
for your platform and on `PATH` (it never downloads anything) and exits 1 if
it finds nothing:

```bash
cd backend
export PUPPETEER_EXECUTABLE_PATH="$(node scripts/find-browser.js)"      # bash
$env:PUPPETEER_EXECUTABLE_PATH = (node scripts/find-browser.js)          # PowerShell
```

or put the path in `.env`. Unit and E2E tests mock `PdfService` and need no
browser. If you really want Puppeteer's Chrome, run one install with
`PUPPETEER_SKIP_DOWNLOAD=false npm ci` (it goes to `~/.cache/puppeteer`).

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

### Linting

`backend/.eslintrc.js` (ESLint 8, `@typescript-eslint` recommended rules as
generated by the Nest CLI; formatting is not linted, see `npm run format`).

```bash
cd backend
npm run lint            # every finding in src/ and test/; never changes files
npm run lint:ci         # what CI runs: fails only on findings above the baseline
npm run lint:fix        # applies ESLint's automatic fixes (review the diff)
npm run lint:baseline   # rewrite scripts/lint-baseline.json after removing debt
```

The repository is **not** lint-clean. The existing findings are recorded per
file and rule in `backend/scripts/lint-baseline.json`; when the gate was added
(141 files) they were 37 errors in 24 files, no warnings:

| Rule | Count |
|---|---|
| `@typescript-eslint/no-unused-vars` | 34 |
| `@typescript-eslint/no-var-requires` | 2 |
| `prefer-const` | 1 |

`lint:ci` fails when any file has more findings for a rule than the baseline
records (new files start at zero) and lists counts that went down. It counts
per file and rule, so it does not tell a moved finding from a new one in the
same file. Lower the baseline in the same change that removes debt.

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
- **Timestamps:** UTC, stored as TIMESTAMPTZ (calendar dates: see [Dates and time zones](#dates-and-time-zones))
- **Soft Deletes:** Use `deleted_at` column
- **Indexes:** Add indexes for frequently queried columns

### Dates and time zones

Two kinds of time value, handled differently:

- **Calendar dates** (`date` columns: invoice `issue_date`/`due_date`, recurring `start_date`/`end_date`/`next_run_date`) are `YYYY-MM-DD` strings. They are stored and returned exactly as written and never converted through a JS `Date` (which would shift them a day west or east of UTC). Use `backend/src/common/calendar-date.ts`:
  - `toCalendarDate(value)` / `calendarDateParts(value)`: the written date of a string, or the local date of a `Date`.
  - `businessToday()`: today's date in `BUSINESS_TIMEZONE` (an IANA name, validated at startup in `main.ts`); unset, in the process's local timezone (`TZ`).
  - `addCalendarDays(date, n)` / `addCalendarMonths(date, n)`: pure calendar arithmetic, no timezone or DST involved.
  - Compare calendar dates as strings (`dueDate < businessToday()`) or pass the string to a TypeORM `date` condition.
- **Instants** (`timestamptz`: `created_at`, `updated_at`, `deleted_at`, token expiry, audit, webhooks) stay UTC instants: `new Date()` is right for those.

Never derive "today" with `new Date().toISOString().split('T')[0]` (that is the UTC date) or `new Date()` passed as a calendar date (server-local). Tests that depend on the date fix the clock (`jest.useFakeTimers({ now })`) and pick an instant where UTC, server and business dates differ; CI runs the date suites and the unit suite again with `TZ=America/New_York`.

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

## Build Output and Operational Scripts

`npm run build` compiles `src/` only (`tsconfig.build.json` has
`include: ["src/**/*"]`), so a checkout, the Docker builder stage and
`scripts/make-update-bundle.sh` all produce the same layout: `dist/main.js`,
`dist/integrity/`, `dist/ops/` and the HTML templates in `dist/core/templates/`.
(Before this, a checkout build also compiled `migrations/data-source.ts` and
wrote `dist/src/...`, so `start:prod` and the `:prod` scripts failed outside
Docker.)

| Command | Checkout (`backend/`) | Update bundle folder | Container (`/app`) |
|---|---|---|---|
| Start | `npm run start:prod` | `node dist/main.js` | image `CMD` (`node dist/main.js`) |
| Integrity report (read-only) | `npm run integrity:report` (ts-node) or `npm run integrity:report:prod` | `node dist/integrity/integrity-report.js` | `node dist/integrity/integrity-report.js` |
| Restore verification | `npm run backup:verify-restore` or `npm run backup:verify-restore:prod` | `node dist/ops/verify-restore.js` | `node dist/ops/verify-restore.js` |
| File/.env verification | `npm run backup:verify-files -- <a> <b>` or `npm run backup:verify-files:prod -- <a> <b>` | `node dist/ops/verify-files.js <a> <b>` | `node dist/ops/verify-files.js <a> <b>` |
| Schema review | `scripts/schema-review.sh <restored-url> <scratch-url> backend/migrations <out>` (repository root) | `scripts/schema-review.sh <restored-url> <scratch-url> migrations <out>` | not shipped in the image; run it from a checkout or bundle |
| Build a bundle | `scripts/make-update-bundle.sh [out-dir]` (repository root, clean tree) | n/a | n/a |

The `:prod` scripts need `npm run build` first. The integrity report reads
`INTEGRITY_DATABASE_URL`, restore verification `VERIFY_SOURCE_URL` and
`VERIFY_RESTORED_URL`; see the header of each source file and
`docs/operations/customer-update.md`.

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
5. `Cannot find module .../dist/main` after `npm run build`: check that
   `tsconfig.build.json` still has `include: ["src/**/*"]` (see
   [Build Output](#build-output-and-operational-scripts))

### PDF generation fails from a checkout

`Could not find Chrome` or `Failed to launch`: set `PUPPETEER_EXECUTABLE_PATH`
(see [Browser for PDF generation](#browser-for-pdf-generation)).

### `npm ci` stalls

If an install hangs in `puppeteer`'s `postinstall`, the download is not being
skipped: check that `backend/.puppeteerrc.cjs` exists and that
`PUPPETEER_SKIP_DOWNLOAD` is not set to `false`.

### Tests run out of memory

See `docs/TESTING.md`, "Memory".

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

