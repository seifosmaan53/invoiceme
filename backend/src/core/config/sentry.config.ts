import * as Sentry from '@sentry/nestjs';

export function initSentry(dsn: string, environment: string) {
  if (!dsn) {
    console.warn('⚠️  Sentry DSN not configured. Error tracking disabled.');
    return;
  }

  Sentry.init({
    dsn,
    environment,
    tracesSampleRate: 1.0, // 100% of transactions for performance monitoring
    // Removed old-style integrations for compatibility with newer @sentry/nestjs
  });

  console.log('✅ Sentry initialized for error tracking');
}

