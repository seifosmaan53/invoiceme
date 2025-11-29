# 🚀 Quick Start Guide

This is the fastest way to get InvoiceMe up and running. For detailed documentation, see [README.md](README.md) and [DEPLOYMENT.md](DEPLOYMENT.md).

## Prerequisites

- **Node.js 20+** - [Download](https://nodejs.org/)
- **Flutter 3.19+** - [Installation Guide](https://docs.flutter.dev/get-started/install)
- **PostgreSQL 15+** - [Download](https://www.postgresql.org/download/)
- **Docker & Docker Compose** (optional, for full stack) - [Download](https://www.docker.com/get-started)

## Quick Start Options

### Option 1: Docker Compose (Recommended for Full Stack)

The fastest way to run the entire stack (backend + database + S3):

```bash
# Start all services
docker-compose up

# Backend will be available at http://localhost:3000
# API docs at http://localhost:3000/api/docs (if ENABLE_SWAGGER=true)
```

See [DEPLOYMENT.md](DEPLOYMENT.md) for production Docker setup.

### Option 2: Manual Setup

#### Backend Setup

```bash
# Navigate to backend directory
cd backend

# Install dependencies
npm install

# Copy environment template
cp env.example .env

# Edit .env file with your configuration:
# - Database credentials (DB_HOST, DB_USERNAME, DB_PASSWORD, DB_DATABASE)
# - JWT secrets (generate with: openssl rand -base64 32)
# - S3 credentials (or use MinIO for local development)
# - SMTP settings (optional, for email features)
# - Set ENABLE_SWAGGER=true for development, false for production

# Run database migrations
npm run migration:run

# Start backend server
npm run start:dev
# Or for production: npm run start:prod
```

Backend will start on `http://localhost:3000` (or port specified in `API_PORT`).

**Verify Backend:**
- Health check: `http://localhost:3000/api/health`
- API docs (if enabled): `http://localhost:3000/api/docs`

#### Mobile App Setup

```bash
# Navigate to mobile directory
cd mobile

# Install dependencies
flutter pub get

# For development (uses default localhost URLs):
flutter run

# For production build with custom API URL:
flutter build apk --release --dart-define=API_BASE_URL=https://api.example.com/api/v1

# For web build:
flutter build web --release --dart-define=API_BASE_URL=https://api.example.com/api/v1
```

**Platform-Specific Defaults:**
- **Web (Chrome)**: `http://localhost:3000/api/v1`
- **Android Emulator**: `http://10.0.2.2:3000/api/v1`
- **iOS Simulator**: `http://localhost:3000/api/v1`
- **Physical Device**: `http://<your-computer-ip>:3000/api/v1`

See [mobile/README.md](mobile/README.md) for detailed mobile configuration.

## Configuration

### Environment Variables

**Backend** (`backend/.env`):
- Copy `backend/env.example` to `backend/.env`
- Configure database, JWT secrets, S3, Stripe, SMTP
- Set `ENABLE_SWAGGER=true` for development, `false` for production

**Mobile** (build-time):
- Use `--dart-define=API_BASE_URL=...` for API endpoint
- Use `--dart-define=API_CONNECT_TIMEOUT=60` for custom connection timeout (default: 30s)
- Use `--dart-define=API_RECEIVE_TIMEOUT=60` for custom receive timeout (default: 30s)

### Database Setup

```bash
# Create database
createdb invoiceme

# Or using PostgreSQL CLI:
psql -U postgres -c "CREATE DATABASE invoiceme;"

# Run migrations
cd backend
npm run migration:run
```

## Verification

### Backend Health Check

```bash
curl http://localhost:3000/api/health
```

Should return:
```json
{
  "status": "ok",
  "uptime": 123.45,
  "database": "connected",
  "environment": "development"
}
```

### Test API Endpoints

```bash
# Register a test user
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test123!","name":"Test User"}'

# Login
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test123!"}'
```

## Troubleshooting

### Backend Issues

**Port already in use:**
```bash
# Change API_PORT in .env or kill process using port 3000
lsof -ti:3000 | xargs kill -9
```

**Database connection error:**
- Verify PostgreSQL is running: `pg_isready`
- Check database credentials in `.env`
- Ensure database exists: `psql -U postgres -l`

**Migration errors:**
- Ensure database is empty or run: `npm run migration:revert`
- Check database connection before running migrations

### Mobile Issues

**Cannot connect to backend:**
- Verify backend is running: `curl http://localhost:3000/api/health`
- Check API URL configuration (see [mobile/README.md](mobile/README.md))
- For physical devices, ensure device and computer are on same network
- Check firewall settings

**CORS errors (web builds only):**
- Configure `CORS_ORIGIN` in backend `.env` to include your app's domain
- See [DEPLOYMENT.md](DEPLOYMENT.md) for CORS configuration

**Build errors:**
- Run `flutter clean && flutter pub get`
- Check Flutter version: `flutter --version` (requires 3.19+)
- See [mobile/README.md](mobile/README.md) for detailed troubleshooting

## Next Steps

- **Full Documentation**: See [README.md](README.md) for comprehensive guide
- **Production Deployment**: See [DEPLOYMENT.md](DEPLOYMENT.md) for production setup
- **Development Guide**: See [docs/DEVELOPMENT_GUIDE.md](docs/DEVELOPMENT_GUIDE.md)
- **API Documentation**: See [docs/API_DOCUMENTATION.md](docs/API_DOCUMENTATION.md)
- **Testing**: See [docs/TESTING.md](docs/TESTING.md)
- **Troubleshooting**: See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)

## Project Status

✅ **98% Complete** - Production-ready with comprehensive testing (90+ tests)

See [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) for detailed status and [docs/REMAINING_WORK.md](docs/REMAINING_WORK.md) for optional features.
