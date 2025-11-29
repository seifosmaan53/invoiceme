# InvoiceMe CI/CD Documentation

## Overview

This document outlines the CI/CD setup and deployment procedures for InvoiceMe backend and mobile applications.

## Backend Deployment

### Prerequisites

- Node.js 20+
- PostgreSQL 14+
- S3-compatible storage (AWS S3, MinIO, etc.)
- Environment variables configured

### Build Process

```bash
cd backend
npm install
npm run build
```

### Environment Variables

Required environment variables (see `.env.example`):

- Database configuration
- JWT secrets
- S3 credentials
- Stripe keys
- Email configuration

### Database Migrations

```bash
npm run migration:run
```

### Production Deployment

#### Docker Deployment

Create `Dockerfile`:

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "start:prod"]
```

Build and run:

```bash
docker build -t invoiceme-backend .
docker run -p 3000:3000 --env-file .env invoiceme-backend
```

#### PM2 Deployment

```bash
npm install -g pm2
pm2 start dist/main.js --name invoiceme-backend
pm2 save
pm2 startup
```

#### Systemd Service

Create `/etc/systemd/system/invoiceme-backend.service`:

```ini
[Unit]
Description=InvoiceMe Backend API
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/invoiceme/backend
ExecStart=/usr/bin/node dist/main.js
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

### CI/CD Pipeline (GitHub Actions)

Example `.github/workflows/backend.yml`:

```yaml
name: Backend CI/CD

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run lint
      - run: npm test

  deploy:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run build
      - name: Deploy to server
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.HOST }}
          username: ${{ secrets.USERNAME }}
          key: ${{ secrets.SSH_KEY }}
          script: |
            cd /opt/invoiceme/backend
            git pull
            npm ci --only=production
            npm run migration:run
            pm2 restart invoiceme-backend
```

## Mobile Deployment

### Build Process

#### iOS

```bash
cd mobile
flutter build ios --release
```

#### Android

```bash
flutter build apk --release
# Or for app bundle:
flutter build appbundle --release
```

### CI/CD Pipeline (GitHub Actions)

Example `.github/workflows/mobile.yml`:

```yaml
name: Mobile CI/CD

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: subosito/flutter-action@v2
        with:
          flutter-version: '3.0.0'
      - run: flutter pub get
      - run: flutter analyze
      - run: flutter test

  build-android:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v3
      - uses: subosito/flutter-action@v2
        with:
          flutter-version: '3.0.0'
      - run: flutter pub get
      - run: flutter build apk --release
      - uses: actions/upload-artifact@v3
        with:
          name: android-apk
          path: build/app/outputs/flutter-apk/app-release.apk

  build-ios:
    needs: test
    runs-on: macos-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v3
      - uses: subosito/flutter-action@v2
        with:
          flutter-version: '3.0.0'
      - run: flutter pub get
      - run: flutter build ios --release --no-codesign
      - uses: actions/upload-artifact@v3
        with:
          name: ios-build
          path: build/ios
```

## Database Migrations

### Running Migrations

```bash
cd backend
npm run migration:run
```

### Reverting Migrations

```bash
npm run migration:revert
```

### Creating New Migrations

1. Make changes to entities
2. Generate migration:

```bash
npm run migration:generate -- -n MigrationName
```

3. Review generated SQL in `migrations/` directory
4. Test locally before deploying

## Monitoring

### Health Check Endpoint

Add to `backend/src/main.ts`:

```typescript
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
```

### Logging

- Use structured logging (Winston, Pino)
- Log to files and/or centralized service (Datadog, LogRocket)
- Include request IDs for tracing

### Error Tracking

- Integrate Sentry or similar
- Track unhandled exceptions
- Monitor API error rates

## Security

### Secrets Management

- Use environment variables or secrets manager (AWS Secrets Manager, HashiCorp Vault)
- Never commit secrets to repository
- Rotate secrets regularly

### SSL/TLS

- Use HTTPS in production
- Configure SSL certificates (Let's Encrypt)
- Enable HSTS headers

### API Security

- Rate limiting
- CORS configuration
- Input validation
- SQL injection prevention (TypeORM parameterized queries)

## Rollback Procedure

### Backend Rollback

```bash
# Revert to previous version
git checkout <previous-commit>
npm ci --only=production
npm run migration:revert  # If needed
pm2 restart invoiceme-backend
```

### Database Rollback

```bash
npm run migration:revert
```

## Backup Strategy

### Database Backups

```bash
# Daily backup script
pg_dump -h $DB_HOST -U $DB_USERNAME $DB_DATABASE > backup_$(date +%Y%m%d).sql
```

### S3 Backup

- Enable versioning on S3 bucket
- Configure lifecycle policies
- Regular backup verification

## Testing

### Backend Tests

```bash
npm test
npm run test:e2e
npm run test:cov
```

### Mobile Tests

```bash
flutter test
flutter test --coverage
```

## Deployment Checklist

- [ ] All tests passing
- [ ] Database migrations tested
- [ ] Environment variables configured
- [ ] SSL certificates valid
- [ ] Health check endpoint working
- [ ] Monitoring configured
- [ ] Error tracking setup
- [ ] Backup strategy in place
- [ ] Rollback plan documented
- [ ] Documentation updated

