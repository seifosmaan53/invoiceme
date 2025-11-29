# 🏗️ InvoiceMe Architecture Diagram

Complete system architecture visualization.

---

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CLIENT DEVICES                                   │
│                                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                 │
│  │   iPhone     │  │   Android    │  │   Desktop    │                 │
│  │   (iOS)      │  │   (Android)  │  │  (Web/Mac)   │                 │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                 │
│         │                  │                  │                          │
│         └──────────────────┼──────────────────┘                          │
│                            │                                               │
│                    ┌───────▼────────┐                                      │
│                    │  Flutter App   │                                      │
│                    │  (Single Codebase)│                                   │
│                    │                │                                      │
│                    │  ┌──────────┐  │                                      │
│                    │  │ SQLite   │  │                                      │
│                    │  │  Cache   │  │                                      │
│                    │  └──────────┘  │                                      │
│                    │                │                                      │
│                    │  ┌──────────┐  │                                      │
│                    │  │  Sync    │  │                                      │
│                    │  │ Service  │  │                                      │
│                    │  └──────────┘  │                                      │
│                    └───────┬────────┘                                      │
└────────────────────────────┼───────────────────────────────────────────────┘
                             │
                             │ HTTPS/REST API
                             │ JWT Authentication
                             │
┌────────────────────────────▼───────────────────────────────────────────────┐
│                    CUSTOMER-HOSTED BACKEND                                  │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────┐          │
│  │              NestJS API Server                               │          │
│  │                                                               │          │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │          │
│  │  │   Auth   │  │ Clients  │  │ Invoices │  │ Payments │   │          │
│  │  │  Module  │  │  Module  │  │  Module  │  │  Module  │   │          │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │          │
│  │                                                               │          │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │          │
│  │  │   Sync   │  │   GDPR   │  │  Health  │  │  Webhooks│   │          │
│  │  │  Module  │  │  Module  │  │  Module  │  │  Module  │   │          │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │          │
│  │                                                               │          │
│  │  ┌──────────────────────────────────────────────────────┐   │          │
│  │  │              Core Services                            │   │          │
│  │  │  • PDF Service (Puppeteer)                           │   │          │
│  │  │  • S3 Service (File Storage)                         │   │          │
│  │  │  • Email Service (Nodemailer)                        │   │          │
│  │  │  • Stripe Service (Payments)                         │   │          │
│  │  │  • Audit Service (Logging)                           │   │          │
│  │  │  • Cache Service (Redis)                             │   │          │
│  │  │  • Encryption Service (AES)                           │   │          │
│  │  └──────────────────────────────────────────────────────┘   │          │
│  └───────────────────────┬─────────────────────────────────────┘          │
│                          │                                                  │
│  ┌───────────────────────▼─────────────────────────────────────┐          │
│  │              PostgreSQL Database                             │          │
│  │                                                               │          │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │          │
│  │  │  users   │  │ clients  │  │ invoices │  │ payments │   │          │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │          │
│  │                                                               │          │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │          │
│  │  │audit_logs│  │device_   │  │refresh_  │  │password_ │   │          │
│  │  │          │  │changes   │  │tokens    │  │reset_    │   │          │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │          │
│  └───────────────────────────────────────────────────────────────┘          │
│                                                                              │
│  ┌──────────────────────┐  ┌──────────────────────┐                      │
│  │   S3/MinIO Storage   │  │   Email (SMTP)        │                      │
│  │   • PDFs             │  │   • Notifications    │                      │
│  │   • Attachments       │  │   • Password Resets  │                      │
│  │   • Avatars          │  │   • Invoice Emails   │                      │
│  └──────────────────────┘  └──────────────────────┘                      │
│                                                                              │
│  ┌──────────────────────┐  ┌──────────────────────┐                      │
│  │   Redis Cache        │  │   Cron Jobs           │                      │
│  │   • Dashboard Stats  │  │   • Status Updates    │                      │
│  │   • Query Results    │  │   • Overdue Invoices  │                      │
│  └──────────────────────┘  └──────────────────────┘                      │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

### Invoice Creation Flow

```
1. User creates invoice in Flutter app
   ↓
2. Saved to SQLite (offline cache)
   ↓
3. Queued in pending_changes table
   ↓
4. When online: Sync service pushes to backend
   ↓
5. Backend validates and saves to PostgreSQL
   ↓
6. Backend generates PDF (if needed)
   ↓
7. PDF uploaded to S3
   ↓
8. Invoice data synced back to all devices
```

### Authentication Flow

```
1. User enters credentials
   ↓
2. Flutter app sends to /api/v1/auth/login
   ↓
3. Backend validates credentials
   ↓
4. Backend generates JWT tokens
   ↓
5. Tokens stored securely in app
   ↓
6. All subsequent requests include Bearer token
   ↓
7. Backend validates token on each request
```

---

## Security Layers

```
┌─────────────────────────────────────────┐
│         Client App (Flutter)            │
│  • Secure token storage                │
│  • HTTPS only                          │
└──────────────┬──────────────────────────┘
               │
               │ HTTPS (TLS 1.3)
               │
┌──────────────▼──────────────────────────┐
│         Nginx Reverse Proxy             │
│  • SSL termination                     │
│  • Rate limiting                        │
│  • Security headers                    │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│         NestJS API Server                │
│  • JWT authentication                  │
│  • Input validation                      │
│  • SQL injection protection              │
│  • XSS protection                        │
│  • CORS enforcement                      │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│         PostgreSQL Database              │
│  • Encrypted connections                 │
│  • User data isolation (userId)          │
│  • Encrypted sensitive fields            │
└──────────────────────────────────────────┘
```

---

## Deployment Architecture

### Docker Deployment

```
┌─────────────────────────────────────────┐
│         Docker Compose                  │
│                                         │
│  ┌──────────────┐  ┌──────────────┐   │
│  │   Backend    │  │  PostgreSQL  │   │
│  │   (NestJS)   │  │   Database   │   │
│  │   Port: 3000 │  │   Port: 5432 │   │
│  └──────────────┘  └──────────────┘   │
│                                         │
│  ┌──────────────┐  ┌──────────────┐   │
│  │    MinIO     │  │    Redis     │   │
│  │   (S3)      │  │   (Cache)    │   │
│  │   Port: 9000│  │   Port: 6379 │   │
│  └──────────────┘  └──────────────┘   │
└─────────────────────────────────────────┘
```

### Production Deployment

```
Internet
   │
   ▼
┌──────────────┐
│   Nginx      │  (SSL/TLS, Reverse Proxy)
│   Port: 443  │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   Backend    │  (NestJS API)
│   Port: 3000 │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  PostgreSQL  │  (Database)
│   Port: 5432 │
└──────────────┘
```

---

## Component Interactions

### Module Dependencies

```
AppModule
├── AuthModule
│   └── CoreServicesModule
├── ClientsModule
│   └── CoreServicesModule
├── InvoicesModule
│   ├── CoreServicesModule
│   └── ClientsModule
├── PaymentsModule
│   ├── CoreServicesModule
│   └── InvoicesModule
├── SyncModule
│   └── CoreServicesModule
└── GdprModule
    └── CoreServicesModule
```

### Core Services Module

```
CoreServicesModule
├── AuditService
├── EmailService
├── PdfService
├── S3Service
├── StripeService
├── CsvService
├── TotpService
├── NotificationService
├── LoggerService
├── CacheService
├── EncryptionService
└── GdprService
```

---

## Technology Stack

### Backend Stack

- **Framework:** NestJS (Node.js)
- **Database:** PostgreSQL 14+
- **ORM:** TypeORM
- **Authentication:** JWT (Passport.js)
- **File Storage:** S3-compatible (MinIO/AWS S3)
- **PDF Generation:** Puppeteer
- **Email:** Nodemailer
- **Payments:** Stripe
- **Caching:** Redis
- **Logging:** Winston
- **Monitoring:** Sentry

### Frontend Stack

- **Framework:** Flutter 3.0+
- **State Management:** Riverpod
- **Local Database:** SQLite (sqflite)
- **HTTP Client:** Dio
- **Storage:** flutter_secure_storage
- **Charts:** fl_chart
- **UI Components:** Material Design 3

---

## Data Models

### Entity Relationships

```
User (1) ──< (many) Client
User (1) ──< (many) Invoice
Client (1) ──< (many) Invoice
Invoice (1) ──< (many) InvoiceItem
Invoice (1) ──< (many) Attachment
Invoice (1) ──< (many) Payment
User (1) ──< (many) AuditLog
```

---

**Last Updated:** January 2025

