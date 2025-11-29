# 📊 Monitoring Setup Guide

Guide for setting up monitoring with Sentry for InvoiceMe.

---

## Sentry Setup

### Backend (NestJS)

#### 1. Install Dependencies

```bash
cd backend
npm install @sentry/nestjs @sentry/node
```

#### 2. Configure Sentry

Create `backend/src/core/config/sentry.config.ts`:

```typescript
import * as Sentry from '@sentry/nestjs';

export function initSentry(dsn: string, environment: string) {
  Sentry.init({
    dsn,
    environment,
    tracesSampleRate: 1.0, // 100% of transactions for performance monitoring
    integrations: [
      new Sentry.Integrations.Http({ tracing: true }),
    ],
  });
}
```

#### 3. Update `main.ts`

```typescript
import { initSentry } from './core/config/sentry.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  
  // Initialize Sentry
  const sentryDsn = configService.get<string>('SENTRY_DSN');
  if (sentryDsn) {
    initSentry(sentryDsn, configService.get<string>('NODE_ENV') || 'development');
  }
  
  // ... rest of bootstrap
}
```

#### 4. Add Environment Variable

```bash
# .env
SENTRY_DSN=https://your-sentry-dsn@sentry.io/project-id
```

#### 5. Add Global Exception Filter

Update `backend/src/core/filters/global-exception.filter.ts`:

```typescript
import * as Sentry from '@sentry/nestjs';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    // Send to Sentry
    Sentry.captureException(exception);
    
    // ... existing error handling
  }
}
```

---

### Flutter (Mobile)

#### 1. Install Package

```yaml
# pubspec.yaml
dependencies:
  sentry_flutter: ^7.0.0
```

#### 2. Initialize Sentry

Update `mobile/lib/main.dart`:

```dart
import 'package:sentry_flutter/sentry_flutter.dart';

Future<void> main() async {
  await SentryFlutter.init(
    (options) {
      options.dsn = const String.fromEnvironment('SENTRY_DSN');
      options.environment = const String.fromEnvironment('ENVIRONMENT', defaultValue: 'development');
      options.tracesSampleRate = 1.0;
    },
    appRunner: () => runApp(MyApp()),
  );
}
```

#### 3. Build with DSN

```bash
flutter build apk --dart-define=SENTRY_DSN=https://your-dsn@sentry.io/project-id
```

---

## Logging System Setup

### Option 1: Winston (Simple File Logging)

#### 1. Install Winston

```bash
cd backend
npm install winston winston-daily-rotate-file
```

#### 2. Create Logger Service

Create `backend/src/core/services/logger.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import * as winston from 'winston';
import 'winston-daily-rotate-file';

@Injectable()
export class LoggerService {
  private logger: winston.Logger;

  constructor() {
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
      ),
      transports: [
        new winston.transports.DailyRotateFile({
          filename: 'logs/application-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          maxSize: '20m',
          maxFiles: '14d',
        }),
        new winston.transports.Console({
          format: winston.format.simple(),
        }),
      ],
    });
  }

  log(message: string, context?: string) {
    this.logger.info(message, { context });
  }

  error(message: string, trace?: string, context?: string) {
    this.logger.error(message, { trace, context });
  }

  warn(message: string, context?: string) {
    this.logger.warn(message, { context });
  }
}
```

---

### Option 2: ELK Stack (Advanced)

#### Prerequisites

- Docker and Docker Compose
- 4GB+ RAM recommended

#### 1. Create `docker-compose.logging.yml`

```yaml
version: '3.8'

services:
  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.8.0
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
    ports:
      - "9200:9200"
    volumes:
      - es-data:/usr/share/elasticsearch/data

  logstash:
    image: docker.elastic.co/logstash/logstash:8.8.0
    volumes:
      - ./logstash/config:/usr/share/logstash/config
      - ./logs:/var/log/app
    ports:
      - "5044:5044"
    depends_on:
      - elasticsearch

  kibana:
    image: docker.elastic.co/kibana/kibana:8.8.0
    ports:
      - "5601:5601"
    environment:
      - ELASTICSEARCH_HOSTS=http://elasticsearch:9200
    depends_on:
      - elasticsearch

volumes:
  es-data:
```

#### 2. Start ELK Stack

```bash
docker-compose -f docker-compose.logging.yml up -d
```

#### 3. Access Kibana

- URL: http://localhost:5601
- Create index pattern: `logstash-*`

---

### Option 3: Loki + Grafana (Lightweight)

#### 1. Install Loki

```bash
docker run -d --name=loki -p 3100:3100 grafana/loki:latest
```

#### 2. Install Grafana

```bash
docker run -d --name=grafana -p 3000:3000 grafana/grafana:latest
```

#### 3. Configure Promtail

Create `promtail-config.yml`:

```yaml
server:
  http_listen_port: 9080

clients:
  - url: http://localhost:3100/loki/api/v1/push

scrape_configs:
  - job_name: invoiceme
    static_configs:
      - targets:
          - localhost
        labels:
          job: invoiceme
          __path__: /var/log/invoiceme/*.log
```

---

## Redis Caching Setup

### 1. Install Redis

#### Using Docker

```bash
docker run -d --name redis -p 6379:6379 redis:7-alpine
```

#### Using Package Manager

```bash
# Ubuntu/Debian
sudo apt install redis-server

# macOS
brew install redis
```

### 2. Install NestJS Redis Module

```bash
cd backend
npm install @nestjs/cache-manager cache-manager cache-manager-redis-store redis
```

### 3. Configure Caching

Update `backend/src/app.module.ts`:

```typescript
import { CacheModule } from '@nestjs/cache-manager';
import * as redisStore from 'cache-manager-redis-store';

@Module({
  imports: [
    CacheModule.register({
      store: redisStore,
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      ttl: 300, // 5 minutes default
    }),
    // ... other modules
  ],
})
```

### 4. Use Caching in Services

```typescript
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { Cache } from 'cache-manager';

@Injectable()
export class DashboardService {
  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

  async getStats(userId: string) {
    const cacheKey = `dashboard:stats:${userId}`;
    
    // Try cache first
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Calculate stats
    const stats = await this.calculateStats(userId);

    // Cache for 5 minutes
    await this.cacheManager.set(cacheKey, stats, 300);
    
    return stats;
  }
}
```

### 5. Environment Variables

```bash
# .env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=  # Optional
```

---

## Monitoring Checklist

- [ ] Sentry DSN configured
- [ ] Error tracking working
- [ ] Performance monitoring enabled
- [ ] Logging system configured
- [ ] Log rotation set up
- [ ] Redis installed and running
- [ ] Caching implemented for dashboard
- [ ] Alerts configured (optional)

---

## Quick Start Commands

### Start Redis

```bash
docker run -d --name redis -p 6379:6379 redis:7-alpine
```

### Start ELK Stack

```bash
docker-compose -f docker-compose.logging.yml up -d
```

### Check Services

```bash
# Redis
redis-cli ping  # Should return PONG

# Elasticsearch
curl http://localhost:9200

# Kibana
open http://localhost:5601
```

---

**Last Updated:** January 2025

