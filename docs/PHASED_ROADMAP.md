# 🗺️ Phased Roadmap - Invoice App

## Overview

This roadmap breaks down the TODO list into actionable phases, prioritizing what's needed to get a **sellable V1** first, then adding premium features.

---

## 🧱 Phase 0 – "Ready To Sell to First Client"

**Goal:** A stable, self-hosted app you can confidently install for a small startup and get paid.

**Timeline:** Focus ONLY on core functionality, basic security, basic performance, and basic docs.

---

### ✅ Core Features (Must Have)

#### 4️⃣ Invoice Status Automation
- **What:** Simple cron job that marks invoices as overdue
- **When:** `due_date < today` AND `status = UNPAID`
- **Implementation:**
  - Create scheduled task (NestJS `@Cron` or separate cron service)
  - Query: `UPDATE invoices SET status = 'overdue' WHERE due_date < CURRENT_DATE AND status = 'unpaid'`
  - Run daily at midnight
- **Priority:** HIGH - Critical for invoice management

#### 5️⃣ Invoice Number Formatting
- **What:** Configurable invoice number patterns (INV-YYYY-###)
- **Implementation:**
  - Add `invoiceNumberFormat` field to User entity (or config table)
  - Update `generateInvoiceNumber()` to use format
  - Default: `INV-{YYYY}-{####}` (e.g., INV-2025-0001)
  - Support: `EST-{YYYY}-{####}` for estimates
- **Priority:** HIGH - Professional appearance

#### 11️⃣ Client Filtering
- **What:** Filter clients by tags, date created
- **Implementation:**
  - Add filter dropdown in `ClientsScreen`
  - Backend: Extend `findAll` to accept `tags[]` and `dateFrom`/`dateTo`
  - Query: `WHERE tags_json @> '["VIP"]'::jsonb`
- **Priority:** MEDIUM - Improves usability

#### 12️⃣ Invoice Advanced Filters
- **What:** Filter by date range, status, amount range
- **Implementation:**
  - Add filter UI in `InvoicesScreen`
  - Backend: Extend `findAll` to accept `status`, `dateFrom`, `dateTo`, `amountMin`, `amountMax`
  - Query: `WHERE issue_date BETWEEN :dateFrom AND :dateTo`
- **Priority:** MEDIUM - Essential for managing many invoices

---

### 🧪 Testing & Quality Assurance

#### 21️⃣ Flutter Unit Tests
- **What:** Unit tests for models, services, utilities
- **Files to Test:**
  - `mobile/lib/models/client.dart`
  - `mobile/lib/models/invoice.dart`
  - `mobile/lib/models/invoice_item.dart`
  - `mobile/lib/core/services/api_client.dart`
  - `mobile/lib/core/services/sync_service.dart`
- **Coverage Goal:** 80%+ for models and services
- **Priority:** HIGH - Prevents regressions

#### 22️⃣ Flutter Widget Tests
- **What:** Widget tests for critical screens
- **Screens to Test:**
  - `LoginScreen` - Login form validation
  - `ClientsScreen` - List rendering, search
  - `InvoicesScreen` - List rendering, filters
  - `CreateInvoiceScreen` - Form validation, item calculations
- **Coverage Goal:** At least happy paths for critical flows
- **Priority:** HIGH - Ensures UI works

#### 24️⃣ Backend E2E Test Coverage
- **What:** E2E tests for auth, clients, invoices
- **Flows to Test:**
  - Auth: Register → Login → Refresh token
  - Clients: Create → List → Search → Update → Archive
  - Invoices: Create → List → Search → Update → Archive → Convert estimate
- **Coverage Goal:** 90%+ for critical endpoints
- **Priority:** HIGH - Prevents breaking changes

---

### 🔒 Security & Backend

#### 41️⃣ Rate Limiting
- **What:** Basic per-IP + per-user rate limiting
- **Implementation:**
  - Use `@nestjs/throttler` package
  - Apply to: `/auth/login`, `/auth/register`, all POST/PATCH/DELETE routes
  - Limits:
    - Auth routes: 5 requests/minute per IP
    - Write routes: 20 requests/minute per user
- **Priority:** HIGH - Prevents abuse

#### 42️⃣ Input Sanitization
- **What:** Ensure DTO validation + TypeORM are used safely
- **Check:**
  - All DTOs use `class-validator` decorators
  - No raw SQL queries (use QueryBuilder)
  - XSS protection in email templates
  - File upload validation (already done, verify)
- **Priority:** HIGH - Security critical

---

### ⚡ Performance & Database

#### 51️⃣ Database Indexing
- **What:** Add indexes for frequently queried fields
- **Indexes to Add:**
  ```sql
  CREATE INDEX idx_invoices_user_id ON invoices(user_id);
  CREATE INDEX idx_invoices_client_id ON invoices(client_id);
  CREATE INDEX idx_invoices_status ON invoices(status);
  CREATE INDEX idx_invoices_issue_date ON invoices(issue_date);
  CREATE INDEX idx_invoices_due_date ON invoices(due_date);
  CREATE INDEX idx_clients_user_id ON clients(user_id);
  CREATE INDEX idx_clients_tags_json ON clients USING GIN(tags_json);
  ```
- **Priority:** HIGH - Performance critical

#### 52️⃣ Query Optimization
- **What:** Check N+1 queries, ensure joins are reasonable
- **Check:**
  - `findAll` methods use `leftJoinAndSelect` (already done ✅)
  - No N+1 queries in invoice list (items loaded with invoice)
  - Pagination limits are reasonable (20-50 items)
- **Priority:** MEDIUM - Prevents slow queries

---

### 📚 Documentation & DevOps

#### 61️⃣ API Documentation
- **What:** Complete Swagger documentation
- **Status:** ✅ Already done for clients and invoices!
- **Verify:**
  - Auth endpoints documented
  - All query params have examples
  - Response types are correct
- **Priority:** HIGH - Essential for integration

#### 64️⃣ Deployment Guide
- **What:** Step-by-step guide for self-hosting
- **Contents:**
  - Docker Compose setup
  - PostgreSQL installation
  - Environment variables
  - Initial setup (create admin user)
  - How to update/restart
- **Priority:** HIGH - Required for customers

#### 71️⃣ CI/CD Pipeline
- **What:** Automated testing and building
- **Implementation:**
  - GitHub Actions workflow
  - Run tests on push to main
  - Build backend Docker image
  - Build Flutter apps (optional for now)
- **Priority:** MEDIUM - Saves time, prevents broken deployments

---

### 🛡️ Stability

#### 91️⃣ Error Handling
- **What:** Nice error messages, don't crash app on 401/500
- **Implementation:**
  - Global error handler in Flutter
  - Show user-friendly messages
  - Handle 401 (logout), 500 (retry), network errors
  - Log errors for debugging
- **Priority:** HIGH - User experience

#### 92️⃣ Form Validation
- **What:** Required fields, nice messages, no silent fails
- **Check:**
  - All forms have validation
  - Error messages are clear
  - Required fields marked with *
  - Email/phone format validation
- **Priority:** HIGH - Prevents bad data

#### 75️⃣ Backup Strategy
- **What:** Daily Postgres dump; restore instructions
- **Implementation:**
  - Cron job: `pg_dump` daily
  - Store backups in S3 or local directory
  - Document restore process
  - Test restore procedure
- **Priority:** HIGH - Data safety

---

## 🚀 Phase 1 – "Feels Premium & Professional"

**Goal:** Once first client is happy or close to signing, add premium polish.

**Timeline:** After Phase 0 is stable and tested.

---

### 🎨 UI/UX Improvements

#### 31️⃣ Invoice PDF Customization
- **What:** Custom logo, colors, simple template
- **Implementation:**
  - Add `logoUrl` to User entity
  - Add `brandColors` JSON field (primary, secondary)
  - Update PDF template to use logo and colors
  - Settings screen to upload logo
- **Priority:** MEDIUM - Professional appearance

#### 32️⃣ Invoice Preview
- **What:** Live preview before saving/sending
- **Implementation:**
  - Preview button in create/edit invoice screen
  - Generate PDF preview (client-side or API call)
  - Show in modal or new screen
- **Priority:** MEDIUM - Reduces errors

#### 34️⃣ Dashboard Charts
- **What:** Visual charts for revenue, unpaid, overdue
- **Implementation:**
  - Use `fl_chart` package
  - Revenue over time (line chart)
  - Unpaid vs Paid (pie chart)
  - Overdue count (bar chart)
- **Priority:** MEDIUM - Better insights

---

### ⚡ Features

#### 13️⃣ Invoice Duplication
- **What:** Clone invoice → open edit screen
- **Implementation:**
  - "Duplicate" button in invoice detail
  - Copy invoice data, generate new number
  - Open in edit screen with pre-filled data
- **Priority:** LOW - Time saver

#### 14️⃣ Quick Actions
- **What:** Swipe to edit/share/delete
- **Implementation:**
  - Use `flutter_slidable` package
  - Swipe left: Edit, Share, Delete
  - Swipe right: Mark as paid
- **Priority:** LOW - Nice UX

#### 17️⃣ Pull to Refresh
- **What:** Refresh data with pull gesture
- **Implementation:**
  - Wrap lists in `RefreshIndicator`
  - Call `_loadClients()` or `_loadInvoices()` on refresh
- **Priority:** LOW - Standard mobile pattern

#### 18️⃣ Empty States
- **What:** Nice screens when no data
- **Implementation:**
  - Illustrations for empty clients/invoices
  - "Create your first client" CTA
  - Friendly messaging
- **Priority:** LOW - Professional feel

#### 19️⃣ Loading Skeletons
- **What:** Skeleton loaders instead of spinners
- **Implementation:**
  - Use `shimmer` package
  - Show skeleton for list items while loading
- **Priority:** LOW - Modern UX

---

### 📚 Documentation

#### 62️⃣ User Manual
- **What:** End-user documentation with screenshots
- **Contents:**
  - Getting started
  - Creating clients
  - Creating invoices
  - Sending invoices
  - Managing payments
  - Settings
- **Priority:** MEDIUM - Reduces support burden

#### 65️⃣ Troubleshooting Guide
- **What:** Common errors, how to restart, backup/restore
- **Contents:**
  - "App won't start" → Check Docker, check logs
  - "Can't connect to server" → Check API URL, check network
  - "Invoice not sending" → Check email config
  - How to restart services
  - How to restore from backup
- **Priority:** MEDIUM - Self-service support

---

### 🔒 Security

#### 47️⃣ Session Management
- **What:** Token expiry, refresh, basic logout-on-expiry
- **Implementation:**
  - JWT expiry: 15 minutes
  - Refresh token: 7 days
  - Auto-refresh on 401
  - Logout if refresh fails
- **Priority:** MEDIUM - Security best practice

---

## 📊 Phase 0 Summary

### Must Complete (Before First Sale)

**Core Features (4 items):**
- ✅ Invoice Status Automation
- ✅ Invoice Number Formatting
- ✅ Client Filtering
- ✅ Invoice Advanced Filters

**Testing (3 items):**
- ✅ Flutter Unit Tests
- ✅ Flutter Widget Tests
- ✅ Backend E2E Tests

**Security (2 items):**
- ✅ Rate Limiting
- ✅ Input Sanitization

**Performance (2 items):**
- ✅ Database Indexing
- ✅ Query Optimization

**Docs/DevOps (3 items):**
- ✅ API Documentation (mostly done ✅)
- ✅ Deployment Guide
- ✅ CI/CD Pipeline

**Stability (3 items):**
- ✅ Error Handling
- ✅ Form Validation
- ✅ Backup Strategy

**Total: 17 items** to complete Phase 0

---

## 📊 Phase 1 Summary

### Premium Features (After First Sale)

**UI/UX (3 items):**
- Invoice PDF Customization
- Invoice Preview
- Dashboard Charts

**Features (5 items):**
- Invoice Duplication
- Quick Actions
- Pull to Refresh
- Empty States
- Loading Skeletons

**Docs (2 items):**
- User Manual
- Troubleshooting Guide

**Security (1 item):**
- Session Management

**Total: 11 items** for Phase 1

---

## 🎯 Recommended Order (Phase 0)

### Week 1: Core Features
1. Invoice Status Automation (cron job)
2. Invoice Number Formatting
3. Client Filtering
4. Invoice Advanced Filters

### Week 2: Testing
5. Flutter Unit Tests
6. Flutter Widget Tests
7. Backend E2E Tests

### Week 3: Security & Performance
8. Rate Limiting
9. Input Sanitization (audit)
10. Database Indexing
11. Query Optimization

### Week 4: Docs & Stability
12. Deployment Guide
13. CI/CD Pipeline
14. Error Handling
15. Form Validation
16. Backup Strategy

**Timeline:** ~4 weeks to Phase 0 completion

---

## ✅ Already Complete

- ✅ Client Notes & Tags
- ✅ Invoice Search
- ✅ Native Share
- ✅ Swagger Documentation (Clients & Invoices)
- ✅ toApiPayload() methods
- ✅ Paginated responses
- ✅ Archive methods

---

## 🚀 Next Steps

1. **Start with Phase 0, Week 1** - Core features
2. **Test as you go** - Don't skip testing
3. **Document as you build** - Deployment guide is critical
4. **Get first client feedback** - Before Phase 1

**You're ready to build a sellable V1!** 💪

