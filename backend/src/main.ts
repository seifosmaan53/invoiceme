import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './core/filters/global-exception.filter';
import { LoggerService } from './core/services/logger.service';
import { initSentry } from './core/config/sentry.config';
import * as express from 'express';
import * as compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true, // Buffer logs until logger is ready
  });
  const configService = app.get(ConfigService);
  const nodeEnv = configService.get<string>('NODE_ENV') || 'development';

  // Security: Enforce HTTPS in production
  if (nodeEnv === 'production') {
    app.use((req, res, next) => {
      // Check if request is secure (HTTPS) or forwarded as secure (behind proxy)
      const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
      
      if (!isSecure && req.method !== 'GET') {
        // Reject non-GET requests over HTTP
        return res.status(403).json({
          error: 'HTTPS required',
          message: 'This application requires HTTPS. Please use HTTPS to access the API.',
        });
      }
      
      // Redirect GET requests to HTTPS
      if (!isSecure && req.method === 'GET') {
        const httpsUrl = `https://${req.headers.host}${req.url}`;
        return res.redirect(301, httpsUrl);
      }
      
      next();
    });
    console.log('🔒 HTTPS enforcement enabled');
  }

  // Use Winston logger for all NestJS logging
  const loggerService = app.get(LoggerService);
  app.useLogger(loggerService);

  // Initialize Sentry (if DSN is configured)
  const sentryDsn = configService.get<string>('SENTRY_DSN');
  if (sentryDsn) {
    initSentry(sentryDsn, nodeEnv);
  }

  // Performance: Response compression (Gzip)
  app.use(compression({
    level: 6, // Compression level (1-9, 6 is a good balance)
    filter: (req, res) => {
      // Don't compress if client doesn't support it
      if (req.headers['x-no-compression']) {
        return false;
      }
      // Use compression for all other requests
      return compression.filter(req, res);
    },
  }));

  // Security: Helmet - Set security HTTP headers
  app.use(
    helmet({
      contentSecurityPolicy: nodeEnv === 'production',
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // Security: Trust proxy (for correct IP detection behind load balancer)
  const trustProxy = configService.get<string>('TRUST_PROXY') === 'true';
  if (trustProxy) {
    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.set('trust proxy', 1);
  }

  // Security: Rate limiting - Prevent DDoS and brute force attacks
  const rateLimitTtl = parseInt(configService.get<string>('RATE_LIMIT_TTL') || '60', 10);
  const rateLimitMax = parseInt(configService.get<string>('RATE_LIMIT_MAX') || '100', 10);

  // General API rate limiter
  app.use(
    '/api',
    rateLimit({
      windowMs: rateLimitTtl * 1000,
      max: rateLimitMax,
      message: 'Too many requests from this IP, please try again later.',
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  // Stricter rate limiting for authentication endpoints
  // More lenient in development mode to prevent blocking during testing
  const loginRateLimit = nodeEnv === 'development' 
    ? rateLimit({
        windowMs: 2 * 60 * 1000, // 2 minutes
        max: 50, // 50 attempts per 2 minutes (very lenient for dev)
        message: 'Too many login attempts, please try again later.',
        skipSuccessfulRequests: true,
      })
    : rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 5, // 5 attempts per 15 minutes
        message: 'Too many login attempts, please try again later.',
        skipSuccessfulRequests: true,
      });

  app.use('/api/v1/auth/login', loginRateLimit);

  app.use(
    '/api/v1/auth/register',
    rateLimit({
      windowMs: 60 * 60 * 1000, // 1 hour
      max: 3, // 3 registrations per hour
      message: 'Too many registration attempts, please try again later.',
    }),
  );

  // Configure raw body for Stripe webhooks (must be before other middleware)
  app.use('/api/v1/webhooks/stripe', express.raw({ type: 'application/json', limit: '1mb' }));

  // Security: CORS - Never default to '*' in production
  const corsOrigin = configService.get<string>('CORS_ORIGIN');
  if (!corsOrigin || corsOrigin === '*') {
    if (nodeEnv === 'production') {
      throw new Error('CORS_ORIGIN must be set to specific domains in production, never use "*"');
    }
    console.warn('⚠️  WARNING: CORS_ORIGIN is set to "*" - this is insecure for production!');
  }

  // CORS configuration - very permissive for development
  if (nodeEnv === 'development') {
    // Development: Allow all origins for easier debugging
    app.enableCors({
      origin: true, // Allow all origins in dev
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'stripe-signature'],
      credentials: true,
      maxAge: 86400, // 24 hours
    });
    console.log('🌐 CORS enabled: All origins allowed (development mode)');
  } else {
    // Production: Use configured origins
    app.enableCors({
      origin: corsOrigin ? corsOrigin.split(',') : '*',
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT'],
      allowedHeaders: ['Content-Type', 'Authorization', 'stripe-signature'],
      credentials: true,
      maxAge: 86400, // 24 hours
    });
  }

  // Global exception filter (with ConfigService injection)
  const globalExceptionFilter = new GlobalExceptionFilter();
  // Inject ConfigService manually since filter is created before app context
  (globalExceptionFilter as any).configService = configService;
  app.useGlobalFilters(globalExceptionFilter);

  // Global validation pipe with security enhancements
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Strip non-whitelisted properties
      forbidNonWhitelisted: true, // Throw error if non-whitelisted properties exist
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
      // Security: Prevent prototype pollution
      forbidUnknownValues: true,
      // Security: Validate nested objects
      validateCustomDecorators: true,
      // Security: Stop at first error to prevent information leakage
      stopAtFirstError: false,
    }),
  );

  // Security: Request size limits (prevent DoS)
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  app.setGlobalPrefix('api');

  // Swagger documentation (only enabled when ENABLE_SWAGGER=true)
  const enableSwagger = configService.get<string>('ENABLE_SWAGGER') === 'true' || process.env.ENABLE_SWAGGER === 'true';
  
  if (enableSwagger) {
    const config = new DocumentBuilder()
      .setTitle('InvoiceMe API')
      .setDescription(`
# InvoiceMe API Documentation

InvoiceMe is a comprehensive invoice management system with offline-first mobile support.

## 🚀 Quick Start

### Step 1: Register or Login
1. **Register** a new account using \`POST /api/v1/auth/register\`
2. **Login** using \`POST /api/v1/auth/login\` to get your access token

### Step 2: Authorize
1. Click the **"Authorize"** button at the top
2. Enter your access token (from login response)
3. Click **"Authorize"** - now you can test protected endpoints!

### Step 3: Start Using the API
- **Clients**: Create and manage your client database
- **Invoices**: Create invoices, estimates, and track payments
- **Sync**: Use sync endpoints for mobile app offline support

## 📋 Features

- ✅ **JWT Authentication** - Secure token-based authentication
- ✅ **Client Management** - Full CRUD operations for clients
- ✅ **Invoice Management** - Create, update, send invoices and estimates
- ✅ **Stripe Payments** - Integrated payment processing
- ✅ **Offline Sync** - Offline-first synchronization for mobile
- ✅ **File Attachments** - Upload and manage invoice attachments
- ✅ **PDF Generation** - Automatic PDF generation

## 🔐 Authentication

Most endpoints require authentication:
1. Get token from \`/api/v1/auth/login\`
2. Include in header: \`Authorization: Bearer <your-token>\`
3. Or use the "Authorize" button in Swagger UI

## ⚡ Rate Limits

- **General API**: 100 requests per minute
- **Login**: 5 attempts per 15 minutes
- **Registration**: 3 attempts per hour

## 📝 Example Workflow

1. **Register**: \`POST /api/v1/auth/register\` → Get tokens
2. **Authorize**: Click "Authorize" button, paste access token
3. **Create Client**: \`POST /api/v1/clients\` → Get client ID
4. **Create Invoice**: \`POST /api/v1/invoices\` → Use client ID
5. **Send Invoice**: \`POST /api/v1/invoices/{id}/send\` → Email invoice

## 🔄 Token Refresh

Access tokens expire. Use \`POST /api/v1/auth/refresh\` with your refresh token to get a new access token.
      `)
      .setVersion('1.0.0')
      .addServer('http://localhost:3000/api', 'Development Server')
      .addServer('https://api.invoiceme.com/api', 'Production Server')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          name: 'JWT',
          description: 'Enter JWT token',
          in: 'header',
        },
        'JWT-auth', // This name must match the one used in @ApiBearerAuth('JWT-auth')
      )
      .addTag('Authentication', 'User authentication and authorization endpoints')
      .addTag('Clients', 'Client management endpoints')
      .addTag('Invoices', 'Invoice and estimate management endpoints')
      .addTag('Sync', 'Offline-first synchronization endpoints for mobile apps')
      .addTag('Webhooks', 'Stripe webhook handling')
      .addTag('health', 'Health check and system status')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true, // Keep auth token after page refresh
        tagsSorter: 'alpha', // Sort tags alphabetically
        operationsSorter: 'alpha', // Sort operations alphabetically
      },
    });
    console.log('✅ Swagger API documentation enabled at /api/docs');
  } else {
    console.log('⚠️  Swagger API documentation is disabled (ENABLE_SWAGGER=false or not set)');
  }

  const port = process.env.API_PORT || 3000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}/api`);
  if (enableSwagger) {
    console.log(`API Documentation available at: http://localhost:${port}/api/docs`);
  }
}

bootstrap();
