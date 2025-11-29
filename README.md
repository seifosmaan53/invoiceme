# InvoiceMe - Professional Invoicing System

A complete, self-hosted invoicing solution built with Flutter (multi-platform) and NestJS (backend).

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- Flutter 3.19+
- PostgreSQL 14+
- Docker (optional, for easy setup)

### Start PostgreSQL

**Using Homebrew:**
```bash
brew services start postgresql@14
```

**Using Docker:**
```bash
docker-compose up -d postgres
```

### Setup Backend

```bash
cd backend
npm install
cp env.example .env
# Edit .env with your database credentials
npm run migration:run -- -d migrations/data-source.ts
npm run start:dev
```

### Setup Mobile App

```bash
cd mobile
flutter pub get
flutter run
```

## 📁 Project Structure

```
invoice-maker/
├── backend/              # NestJS backend API
│   ├── src/             # Source code
│   ├── migrations/      # Database migrations
│   └── test/            # Tests
├── mobile/              # Flutter mobile app
│   ├── lib/             # Dart source code
│   └── test/            # Tests
├── docs/                # Documentation
│   ├── setup/           # Setup guides
│   ├── implementation/  # Implementation docs
│   └── status/          # Status reports
├── scripts/             # Utility scripts
└── docker-compose.yml   # Docker setup
```

## 📚 Documentation

- **[Developer Guide](docs/DEVELOPER_GUIDE.md)** - Setup and architecture
- **[User Manual](docs/USER_MANUAL.md)** - User documentation
- **[Deployment Guide](docs/DEPLOYMENT_GUIDE.md)** - Production deployment
- **[API Documentation](docs/API_DOCUMENTATION.md)** - API endpoints
- **[Troubleshooting](docs/TROUBLESHOOTING_GUIDE.md)** - Common issues

## ✨ Features

- ✅ Multi-platform (iOS, Android, Web, Desktop)
- ✅ Offline support with sync
- ✅ Invoice templates
- ✅ Recurring invoices
- ✅ PDF generation & customization
- ✅ Payment processing (Stripe)
- ✅ Client management
- ✅ Dashboard with charts
- ✅ API key management
- ✅ GDPR compliance
- ✅ 2FA support
- ✅ Audit logging

## 🛠️ Tech Stack

**Backend:**
- NestJS
- PostgreSQL
- TypeORM
- JWT Authentication
- Swagger/OpenAPI

**Frontend:**
- Flutter
- Riverpod (State Management)
- SQLite (Offline cache)

## 📝 License

See LICENSE file for details.

## 🤝 Support

For issues and questions, see [Troubleshooting Guide](docs/TROUBLESHOOTING_GUIDE.md).

---

**Version:** 1.0.0  
**Last Updated:** January 2025
