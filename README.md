# InvoiceMe

A self-hosted invoicing platform built for freelancers and small businesses. Flutter app on the front, NestJS API on the back — works offline, syncs when connected.

Built after getting tired of paying $30/month for basic invoicing software that should take a weekend to build. Runs comfortably on a $5 VPS.

---

## What it does

- Create invoices and estimates; convert estimates to invoices in one tap
- Client management with notes, tags, and contact history
- PDF generation with customizable templates (logo, colors, layout variants)
- Recurring invoices with configurable billing cycles
- Stripe payment links embedded directly in the PDF
- Offline-first: everything works without internet, syncs on reconnect via a device-change log
- Dashboard with revenue charts, overdue tracking, and monthly revenue breakdowns
- File attachments stored in S3/MinIO
- 2FA (TOTP), audit logging, GDPR data export/delete

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Flutter App                              │
│       iOS  /  Android  /  Web  /  macOS  /  Windows  /  Linux  │
│                                                                 │
│   Riverpod (state) ──► Dio (HTTP) ──► SQLite (offline cache)   │
└────────────────────────────┬────────────────────────────────────┘
                             │ REST + JWT
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      NestJS API (v10)                           │
│                                                                 │
│  Auth ──► JWT / TOTP / Refresh Tokens                          │
│  Invoices ──► PDF (Puppeteer) ──► MinIO / S3                   │
│  Sync ──► Device-change log ──► Conflict resolution            │
│  Stripe ──► Webhooks ──► Invoice status automation             │
│  Rate limiting ──► Redis cache ──► PostgreSQL                  │
└──────────────────┬──────────────────────┬───────────────────────┘
                   │                      │
                   ▼                      ▼
          PostgreSQL 15               Redis 7          MinIO / S3
          (primary store)         (cache + rate       (PDFs, file
                                   limit state)       attachments)
```

---

## Tech Stack

### Backend

| Technology | Version | Why |
|---|---|---|
| NestJS | 10 | Opinionated module/guard/interceptor structure. Decorator-based DI removes boilerplate. TypeScript first-class. |
| PostgreSQL | 15 | Reliable, supports the `EXTRACT` + window functions used in dashboard aggregations. |
| TypeORM | 0.3 | Query builder handles filtered paginated queries cleanly. Raw SQL used where ORM overhead matters (dashboard stats). |
| Redis | 7 | Rate limit state and PDF cache. Avoids re-running Puppeteer for unchanged invoices. |
| Puppeteer | 21 | HTML/CSS invoice templates are far easier to maintain than programmatic PDF construction. Trade-off is memory footprint and Docker complexity. |
| Stripe | 14 | Payment links + webhook signature verification. Raw body parsing required before JSON middleware. |
| Speakeasy | 2 | TOTP 2FA implementation. QR code enrollment via `qrcode` package. |
| Winston | 3 | Structured JSON logging with daily rotation. Sentry integration for production error tracking. |

### Frontend (Flutter)

| Package | Why |
|---|---|
| flutter_riverpod 3 | Provider-scoped state without requiring `BuildContext`. Cleaner than BLoC for this data flow. |
| dio 5 | Interceptors for JWT refresh, timeout handling, and error normalization in one place. |
| sqflite 2 | Local SQLite cache for offline support. Sync service writes mutations to `device_changes` table on reconnect. |
| flutter_stripe 11 | Stripe payment sheet integration for in-app payment collection. |
| fl_chart 1 | Revenue trend and invoice status charts on the dashboard. |
| sentry_flutter 9 | Client-side error tracking to pair with the backend Sentry integration. |

### Infrastructure

- Docker Compose: local dev stack (Postgres + Redis + MinIO + API)
- Kubernetes manifests in `/k8s` for production horizontal scaling
- GitHub Actions CI: lint → unit tests → e2e tests → Docker build

---

## Getting Started

### Prerequisites

- Node.js 20+
- Flutter 3.19+
- Docker (for Postgres, Redis, MinIO)

### 1. Start infrastructure

```bash
docker-compose up -d postgres redis minio
```

### 2. Backend

```bash
cd backend
cp env.example .env        # fill in secrets — see Configuration section
npm install
npm run migration:run -- -d migrations/data-source.ts
npm run start:dev
```

API is available at `http://localhost:3000/api`.
Set `ENABLE_SWAGGER=true` in `.env` to expose interactive docs at `/api/docs`.

### 3. Mobile / web app

```bash
cd mobile
flutter pub get
flutter run                # pick a target platform
```

For web: `flutter run -d chrome`

---

## Configuration

Key variables in `backend/env.example`:

| Variable | Required | Description |
|---|---|---|
| `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE` | Yes | PostgreSQL connection |
| `JWT_SECRET` | Yes | Access token signing key (min 32 chars) |
| `JWT_REFRESH_SECRET` | Yes | Refresh token key — must differ from `JWT_SECRET` |
| `STRIPE_SECRET_KEY` | For payments | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | For payments | From Stripe dashboard webhook config |
| `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET` | For file uploads | MinIO or AWS S3 |
| `REDIS_URL` | Yes | Redis connection string |
| `CORS_ORIGIN` | Yes (production) | Comma-separated allowed origins — never `*` in production |
| `SENTRY_DSN` | Optional | Error tracking |
| `ENABLE_SWAGGER` | Optional | Set `true` to expose `/api/docs` |
| `SMTP_*` | For email | SMTP config for invoice delivery and password reset |

---

## Project Structure

```
invoice-maker/
├── backend/
│   ├── src/
│   │   ├── auth/           JWT, TOTP, refresh tokens, password reset
│   │   ├── invoices/       Invoice + estimate CRUD, PDF generation, status automation
│   │   ├── clients/        Client management with soft delete
│   │   ├── payments/       Stripe integration + webhook handling
│   │   ├── sync/           Device-change log for offline-first sync
│   │   ├── recurring-invoices/  Cron-based recurring invoice generation
│   │   └── core/           Shared services: email, PDF, S3, cache, audit, GDPR
│   └── migrations/         Sequential SQL migration files
├── mobile/
│   └── lib/
│       ├── screens/        One file per screen
│       ├── widgets/        Reusable widget components
│       ├── models/         Dart data models with JSON serialization
│       └── core/           Services, providers, utils, DB helper
├── docs/                   Architecture docs, API reference, deployment guide
├── k8s/                    Kubernetes deployment manifests
├── scripts/                Setup and utility scripts
└── docker-compose.yml      Local development stack
```

---

## Deployment

**Single server (Docker Compose):**

```bash
cp backend/env.example backend/.env   # configure production values
docker-compose up -d
```

**Kubernetes:**

See `/k8s` directory. Includes Deployment, Service, and HPA configs. The backend is stateless and scales horizontally — Redis handles shared rate limit state.

---

## Lessons Learned

**Offline sync is more about conflict resolution than data transfer**

The naive approach to offline sync is: store locally, upload on reconnect, done. The real problem is what happens when the same invoice is edited on two devices while offline. We solved this with a `device_changes` table that acts as an operation log — each mutation is recorded with a timestamp and device ID. On sync, the server applies changes ordered by timestamp (last-write-wins). The key insight was that you can't derive sync state by diffing the main tables; you need the operation log to know *what changed*, not just *what exists*.

**Puppeteer in Docker fails silently without `--no-sandbox`**

Chromium inside a container requires `--no-sandbox --disable-setuid-sandbox` flags or it exits with code 127 and no useful error output. The other production surprise was template path resolution: in development, templates live in `src/core/templates/`; after build, they're in `dist/core/templates/`. We ended up with an ordered fallback array that checks both paths, which works but a cleaner solution would be embedding templates as compiled assets via `nest-cli.json` assets configuration.

**TypeORM `save()` is not transactional across entities**

Early versions of the invoice creation flow called `save()` separately for the invoice header and each line item. When the line item save failed, we'd end up with orphaned invoice records. The fix was wrapping all multi-entity writes in explicit `QueryRunner` transactions (`startTransaction` / `commitTransaction` / `rollbackTransaction`). Every operation that touches more than one table now follows this pattern.

**Dashboard stats should live in the database, not Node.js**

The first implementation fetched all of a user's invoices into memory and did `.filter()` / `.reduce()` in JavaScript to compute counts and totals. This worked fine at small scale but becomes a problem once a user has thousands of invoices. The correct approach is a single aggregate SQL query (`COUNT`, `SUM` with `CASE WHEN`) that returns all stats in one round trip. The refactored version runs one query for all six dashboard metrics.

**Rate limiting needs different windows per surface area**

A global rate limit breaks the developer experience. Authentication endpoints need strict limits (5 login attempts per 15 minutes) to prevent brute force, but applying that window to the general API makes development unusable. The current setup uses three tiers: general API (100/min), login (5/15min in production, 50/2min in development), and registration (3/hour). The dev/prod split on login limits specifically saved a lot of friction during testing.

**Storing refresh tokens in the database is the right call**

Stateless refresh tokens stored only on the client cannot be invalidated before they expire. If a device is lost or a session needs to be terminated remotely, you have no mechanism to revoke the token. Storing them in a `refresh_tokens` table adds a write on every token refresh (typically every 15-60 minutes), but it enables true logout, per-device session management, and emergency revocation. The overhead is negligible.

---

## API Reference

Full Swagger documentation is available when the backend runs with `ENABLE_SWAGGER=true`:

```
http://localhost:3000/api/docs
```

Key endpoints:

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/auth/register` | Create account |
| `POST` | `/api/v1/auth/login` | Get access + refresh tokens |
| `POST` | `/api/v1/auth/refresh` | Rotate refresh token |
| `GET` | `/api/v1/invoices` | List invoices (paginated, filterable) |
| `POST` | `/api/v1/invoices` | Create invoice |
| `GET` | `/api/v1/invoices/stats` | Dashboard aggregate stats |
| `POST` | `/api/v1/invoices/:id/send` | Email invoice to client |
| `GET` | `/api/v1/invoices/:id/pdf` | Generate and download PDF |
| `GET` | `/api/v1/clients` | List clients |
| `POST` | `/api/v1/sync/push` | Push device changes to server |
| `GET` | `/api/v1/sync/pull` | Pull server changes since timestamp |
| `GET` | `/api/v1/health` | Health check |

---

## Running Tests

**Backend:**

```bash
cd backend
npm test                   # unit tests
npm run test:e2e           # end-to-end tests (requires running Postgres)
npm run test:cov           # coverage report
```

**Mobile:**

```bash
cd mobile
flutter test               # unit + widget tests
flutter test integration_test/  # integration tests
```

---

## Author

**Seif Osman**

---

MIT License
