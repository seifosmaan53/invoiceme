# InvoiceMe Backend API

InvoiceMe is a comprehensive invoicing system backend API built with NestJS, TypeORM, and PostgreSQL. It provides authentication, invoice management, payment processing via Stripe, file storage via S3, and offline sync capabilities.

## Overview

The InvoiceMe backend provides a RESTful API for managing:
- User authentication and authorization
- Client management
- Invoice and estimate creation and management
- PDF generation and file attachments
- Payment processing via Stripe
- Offline sync for mobile devices

## Testing

The backend includes comprehensive test coverage with both unit tests and end-to-end (E2E) tests.

### Unit Tests

Unit tests focus on testing individual components (services, controllers, guards, strategies) in isolation with mocked dependencies.

**Run unit tests:**
```bash
npm test
```

**Run unit tests in watch mode:**
```bash
npm run test:watch
```

**Run unit tests with coverage:**
```bash
npm run test:cov
```

**Debug unit tests:**
```bash
npm run test:debug
```

### E2E Tests

E2E tests verify complete user flows through the API, using a real test database but mocking external services (Stripe, S3, PDF generation).

**Run E2E tests:**
```bash
npm run test:e2e
```

**Run E2E tests in watch mode:**
```bash
npm run test:e2e:watch
```

**Run E2E tests with coverage:**
```bash
npm run test:e2e:cov
```

**Debug E2E tests:**
```bash
npm run test:e2e:debug
```

### Test Database Setup

E2E tests require a separate test database to avoid affecting development data.

1. **Create the test database:**
   ```bash
   createdb invoiceme_test
   ```

2. **Configure test database environment variables:**
   
   Copy your `.env` file and create `.env.test`:
   ```bash
   cp .env .env.test
   ```

   Edit `.env.test` and update the test database variables and JWT secrets:
   ```env
   DB_TEST_HOST=localhost
   DB_TEST_PORT=5432
   DB_TEST_USERNAME=postgres
   DB_TEST_PASSWORD=postgres
   DB_TEST_DATABASE=invoiceme_test
   
   # JWT Configuration (required for E2E tests)
   JWT_SECRET=your-test-jwt-secret-minimum-32-characters
   JWT_EXPIRES_IN=15m
   JWT_REFRESH_SECRET=your-test-refresh-secret-minimum-32-characters
   JWT_REFRESH_EXPIRES_IN=7d
   ```

   **Important:** The E2E tests use `ConfigService` to read JWT secrets from `.env.test` or `.env`. Ensure these secrets are consistent across CI and developer environments for test reliability.

   Alternatively, you can set these variables directly in your `.env` file. The E2E tests will use `DB_TEST_*` variables if available, otherwise fall back to `DB_*` variables with `_test` suffix appended to the database name.

3. **Run migrations on test database (if needed):**
   ```bash
   # Set test database in .env.test, then run migrations
   npm run migration:run
   ```

### Running All Tests

To run both unit and E2E tests:
```bash
npm test && npm run test:e2e
```

### Coverage Reports

Coverage reports are generated in separate directories:
- Unit test coverage: `coverage/`
- E2E test coverage: `coverage-e2e/`

Open the `index.html` file in each coverage directory to view detailed coverage reports in your browser.

## Test Structure

### Unit Tests (`test/*.spec.ts`)

Unit tests are located in the `test/` directory and follow the naming pattern `*.spec.ts`. They:
- Test individual components in isolation
- Use mocked dependencies
- Focus on business logic and error handling
- Run quickly with minimal setup

Example unit test files:
- `auth.controller.spec.ts` - Tests authentication controller
- `invoices.service.spec.ts` - Tests invoice service logic
- `jwt.strategy.spec.ts` - Tests JWT authentication strategy

### E2E Tests (`test/*.e2e-spec.ts`)

E2E tests are located in the `test/` directory and follow the naming pattern `*.e2e-spec.ts`. They:
- Test complete user flows through the API
- Use a real test database connection
- Mock external services (Stripe, S3, PDF generation)
- Verify request/response cycles, status codes, and database state
- Test authentication, authorization, and error handling

Example E2E test files:
- `auth.e2e-spec.ts` - Complete authentication flows (register, login, refresh, password reset)
- `invoices.e2e-spec.ts` - Invoice management flows (create, update, delete, PDF generation)
- `payments.e2e-spec.ts` - Payment processing flows (Stripe integration, webhooks)
- `sync.e2e-spec.ts` - Offline sync flows (push/pull changes)

### Test Patterns

**Database Setup:**
- E2E tests use `beforeAll` to set up the database connection
- `beforeEach` is used to clean tables between tests for isolation
- `afterAll` is used to close connections and clean up

**Authentication:**
- Test users are created with hashed passwords using bcrypt
- JWT tokens are generated using the JwtService for authenticated requests
- Helper functions create authenticated users and return tokens

**Mocking:**
- External services (StripeService, S3Service, PdfService) are mocked in E2E tests
- Mocks return predictable fake data to avoid dependencies on third-party services
- Mock implementations are configured in the test module setup

**Test Isolation:**
- Each test suite cleans its relevant tables in `beforeEach`
- Tests are independent and can run in any order
- No shared state between tests

## Development Workflow

### During Development

1. **Run unit tests frequently** while developing:
   ```bash
   npm run test:watch
   ```
   This runs tests in watch mode, automatically re-running when files change.

2. **Run specific test files** during development:
   ```bash
   npm test -- auth.controller.spec.ts
   ```

### Before Committing

1. **Run all unit tests:**
   ```bash
   npm test
   ```

2. **Run E2E tests** to verify complete flows:
   ```bash
   npm run test:e2e
   ```

3. **Check test coverage** to ensure adequate coverage:
   ```bash
   npm run test:cov
   npm run test:e2e:cov
   ```

### CI/CD Integration

Tests run automatically on pull requests and merges. The CI/CD pipeline:
- Runs all unit tests
- Runs all E2E tests
- Generates coverage reports
- Fails the build if tests fail or coverage drops below thresholds

## Troubleshooting

### Common Test Failures

**Database Connection Errors:**
- Ensure PostgreSQL is running
- Verify database credentials in `.env` or `.env.test`
- Check that the test database exists: `createdb invoiceme_test`

**Test Timeout Errors:**
- E2E tests have a 30-second timeout by default
- If tests are timing out, check for:
  - Slow database queries
  - Network issues
  - Blocking operations

**Port Already in Use:**
- Ensure no other instance of the application is running
- Check for processes using the test port

**Migration Errors:**
- Ensure migrations are up to date
- Run migrations on the test database if needed
- Check that the test database schema matches the expected schema

### Database Connection Issues

If you encounter database connection issues:
1. Verify PostgreSQL is running: `pg_isready`
2. Check database credentials
3. Ensure the database exists
4. Verify network connectivity

### Test Timeout Issues

If tests are timing out:
1. Check database performance
2. Verify no blocking operations
3. Increase timeout in `jest-e2e.json` if needed (default: 30000ms)

## Additional Resources

- [NestJS Testing Documentation](https://docs.nestjs.com/fundamentals/testing)
- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Supertest Documentation](https://github.com/visionmedia/supertest)

