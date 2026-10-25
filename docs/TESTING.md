# InvoiceMe - Testing Guide

## Overview

InvoiceMe uses a comprehensive testing strategy covering unit tests, controller tests, guard/strategy tests, and end-to-end (e2e) tests. The project has 90+ tests covering all critical functionality.

**Testing Philosophy:**
- **Unit Tests:** Test individual services in isolation using mocks for all dependencies
- **E2E Tests:** Test complete user flows with real HTTP requests and database interactions
- **Isolation:** Each test is independent and doesn't depend on execution order

## Test Structure

### Unit Tests (`backend/test/*.service.spec.ts`)

Test individual services in isolation with all dependencies mocked.

**Coverage:**
- AuthService (`backend/test/auth.service.spec.ts`)
- ClientsService (`backend/test/clients.service.spec.ts`)
- PaymentsService (`backend/test/payments.service.spec.ts`)
- InvoicesService (`backend/test/invoices.service.spec.ts`)
- SyncService (`backend/test/sync.service.spec.ts`)

**Characteristics:**
- Mock all dependencies (repositories, JwtService, ConfigService, Stripe, S3, etc.)
- Test business logic, error handling, and edge cases
- 30+ tests covering all service methods

### Controller Tests (`backend/test/*.controller.spec.ts`)

Test HTTP request handling, validation, and response formatting.

**Coverage:**
- AuthController (`backend/test/auth.controller.spec.ts`)
- ClientsController (`backend/test/clients.controller.spec.ts`)
- InvoicesController (`backend/test/invoices.controller.spec.ts`)
- WebhooksController (`backend/test/webhooks.controller.spec.ts`)
- SyncController (`backend/test/sync.controller.spec.ts`)

**Characteristics:**
- Mock services and verify correct method calls
- Test all endpoints, auth guards, and error responses
- 20+ tests covering all API endpoints

### Guard/Strategy Tests (`backend/test/*.guard.spec.ts`, `backend/test/*.strategy.spec.ts`)

Test authentication guards and Passport strategies.

**Coverage:**
- JwtAuthGuard (`backend/test/jwt-auth.guard.spec.ts`)
- LocalAuthGuard (`backend/test/local-auth.guard.spec.ts`)
- JwtStrategy (`backend/test/jwt.strategy.spec.ts`)
- LocalStrategy (`backend/test/local.strategy.spec.ts`)

**Characteristics:**
- Verify JWT validation and local authentication
- Test guard behavior and error handling
- Ensure proper authentication flow

### E2E Tests (`backend/test/*.e2e-spec.ts`)

Test complete user flows with real HTTP requests and database.

**Coverage:**
- Auth flows (`backend/test/auth.e2e-spec.ts`)
- Invoice operations (`backend/test/invoices.e2e-spec.ts`)
- Payment flows (`backend/test/payments.e2e-spec.ts`)
- Sync operations (`backend/test/sync.e2e-spec.ts`)

**Characteristics:**
- Use real database (configure via `DB_TEST_*` env vars)
- Test complete flows: registration→login→token refresh, invoice creation→PDF generation, payment flows, sync push/pull
- 40+ tests covering critical user journeys
- Clean up after each test suite (truncate tables)

## Running Tests

### Unit Tests
```bash
cd backend && npm test
```
Runs all `*.spec.ts` files (unit and controller tests).

### E2E Tests
```bash
cd backend && npm run test:e2e
```
Runs all `*.e2e-spec.ts` files in band against a real PostgreSQL. Set the
same variables as CI (`.github/workflows/ci.yml`); `DB_TEST_*` is read by the
tests, `DB_*` by the app's own `DatabaseModule`, and `DB_SYNCHRONIZE=true`
builds the schema from the entities:

```bash
export NODE_ENV=test DB_SYNCHRONIZE=true \
  JWT_SECRET=local-test-jwt-secret-minimum-32-characters \
  JWT_REFRESH_SECRET=local-test-refresh-secret-minimum-32-chars
for p in TEST_ ""; do
  export DB_${p}HOST=localhost DB_${p}PORT=5432 DB_${p}USERNAME=postgres \
         DB_${p}PASSWORD=postgres DB_${p}DATABASE=invoiceme_test
done
npm run test:e2e
```

Use a disposable database with synthetic data only. A throwaway cluster that
needs no system service (PostgreSQL 14+ binaries; run as a non-root user):

```bash
initdb -D /tmp/invoiceme-pg -U postgres --auth=trust
pg_ctl -D /tmp/invoiceme-pg -o "-p 5432 -c unix_socket_directories=/tmp" -l /tmp/invoiceme-pg.log start
psql -h localhost -U postgres -c "ALTER USER postgres PASSWORD 'postgres'" -c "CREATE DATABASE invoiceme_test"
# ... run the tests ...
pg_ctl -D /tmp/invoiceme-pg stop && rm -rf /tmp/invoiceme-pg
```

`test/verify-restore.e2e-spec.ts` includes "identifies the same database over a
Unix socket and over TCP", which runs only when a socket file
`.s.PGSQL.<DB_TEST_PORT>` exists in `/tmp` or `/var/run/postgresql` on the
machine running Jest, and is reported as skipped otherwise (a database in a
container exposes TCP only). The cluster above puts its socket in `/tmp`. CI
runs it in the `restore-socket` job and fails if it is skipped.

### Coverage
```bash
cd backend && npm run test:cov
```
Generates coverage report showing test coverage percentages.

### Watch Mode
```bash
cd backend && npm run test:watch
```
Re-runs tests automatically when files change.

### Debug Mode
```bash
cd backend && npm run test:debug
```
Runs tests with Node debugger attached.

## Test Configuration

### Unit Test Config

**File:** `backend/jest.config.js`

**Settings:**
- `ts-jest` with `backend/tsconfig.jest.json` (type-checks each test file and
  what it imports; see [Memory](#memory))
- Jest's default 5 s timeout per test
- No coverage thresholds
- Test environment: `node`

### E2E Test Config

**File:** `backend/test/jest-e2e.json`

**Settings:**
- `ts-jest` with `backend/tsconfig.jest.json`, like the unit tests
- 30s timeout per test (longer for database operations)
- Separate coverage configuration
- Uses test database

### Memory

Neither suite needs `--max-old-space-size`; both pass at Node's default heap
limit (2096 MB on the machines measured, Node 20.20.2 and 22.22.0).

`backend/tsconfig.json` has no `include`, so ts-jest used to take every project
file as a root and type-check the whole program in every Jest worker: about
2 GB per worker even for an empty spec, and `npx jest` crashed with
"JavaScript heap out of memory" in every suite. `backend/tsconfig.jest.json`
(the same compiler options, no root files) makes ts-jest type-check only the
files it transforms and their imports. Type errors in a spec or in an
imported `src/` file still fail the run.

Measured with `--logHeapUsage` (`--no-cache`, i.e. cold ts-jest cache; Node 22
unless noted):

| Run | Before | After |
|---|---|---|
| Empty spec, no imports | 2043 MB | 221 MB |
| `invoice-number-formatter.service.spec.ts` | 2088 MB (fails below 2560 MB) | 298 MB |
| `npx jest` (21 suites, 3 workers) | every suite OOM after 270 s | 372 tests pass, 21 s; peak 1282 MB per worker |
| Unit, in band, forced GC between suites | not run | 1138-1173 MB after every suite (flat: no leak between suites) |
| `npm run test:e2e`, Node 20 | OOM in the first suite | 158 tests pass, 51 s; 1256-1542 MB |

With a warm ts-jest cache the numbers are lower (E2E peak 428 MB). If a run
does hit the heap limit, first check that `jest.config.js` and
`test/jest-e2e.json` still point at `tsconfig.jest.json`; raising
`NODE_OPTIONS=--max-old-space-size` only hides a regression.

### Test Database Setup

**Create Test Database:**
```bash
createdb invoiceme_test
```

**Configure Environment Variables** (see [E2E Tests](#e2e-tests) for the full set CI uses):
- `DB_TEST_HOST` - Database host
- `DB_TEST_PORT` - Database port
- `DB_TEST_USERNAME` - Database user
- `DB_TEST_PASSWORD` - Database password
- `DB_TEST_DATABASE` - Database name (e.g., `invoiceme_test`)

**Note:** E2E tests use a real database but clean up after each test suite by truncating tables.

See `backend/env.example` for test database configuration.

## Test Patterns

### Mocking

Use Jest mocks (`jest.fn()`) for all external dependencies in unit tests:

```typescript
const mockRepository = {
  findOne: jest.fn(),
  save: jest.fn(),
  delete: jest.fn(),
};
```

### Test Data

Create minimal test data for each test case. Avoid shared state between tests:

```typescript
const testUser = {
  id: 1,
  email: 'test@example.com',
  password: 'hashedPassword',
};
```

### Assertions

Use Jest matchers for assertions:

```typescript
expect(result).toBe(expectedValue);
expect(mockService.method).toHaveBeenCalledWith(expectedArgs);
expect(() => service.method()).toThrow(ExpectedError);
```

### Error Testing

Verify exceptions are thrown with correct messages and status codes:

```typescript
await expect(service.method()).rejects.toThrow('Expected error message');
```

### Async Testing

Use `async/await` for all async operations:

```typescript
it('should handle async operation', async () => {
  const result = await service.asyncMethod();
  expect(result).toBeDefined();
});
```

### Cleanup

E2E tests truncate tables after each suite to ensure isolation:

```typescript
afterAll(async () => {
  await truncateTables();
});
```

## Coverage Goals

### Target Coverage

- **80%+ coverage** on business logic (services, controllers)
- Focus on critical paths and error handling

### Current Status

- **90+ tests** covering all critical paths
- Comprehensive coverage on:
  - Authentication flows
  - CRUD operations
  - Payment processing
  - Sync operations
  - Error handling

### Excluded from Coverage

- Generated files
- Migration files
- Entity definitions (focus on logic, not data structures)

## CI/CD Integration

Tests run automatically on every PR via GitHub Actions.

**Configuration:** `.github/workflows/ci.yml`

**`backend` job** (Node 20, PostgreSQL 15 service container):
1. `npm ci` (no Puppeteer browser download: `backend/.puppeteerrc.cjs`), then a
   check that `~/.cache/puppeteer` was not created
2. `npm run lint:ci`: fails only on lint findings above the recorded baseline
   (see `docs/DEVELOPER_GUIDE.md`, Linting)
3. `npm test`, `npm run migration:run -- -d migrations/data-source.ts`, `npm run test:e2e`, `npm run build`
4. `docker build` and the container PDF smoke test
   (`backend/test/container/pdf-smoke.sh`), which renders a real invoice PDF
   with the image's Chromium

**`restore-socket` job**: the runner's own PostgreSQL (socket in
`/var/run/postgresql`), `test/verify-restore.e2e-spec.ts`, and a check that the
Unix-socket identity test passed rather than being skipped.

**`mobile` job**: Flutter service, utility and coverage tests.

`.github/workflows/update-bundle.yml` builds the on-site update bundle on Node
20 and installs it on Linux and Windows (migrations, start, health check, HTTPS
enforcement, integrity report, restore verification, PDFs with the system
browser).

Runs on pushes to `main` and on pull requests against it. No coverage
artifacts are uploaded.

## Adding New Tests

### For Services

1. Create `*.service.spec.ts` file in `backend/test/`
2. Mock all repositories and dependencies
3. Test all public methods
4. Test error cases and edge conditions

**Example:**
```typescript
describe('MyService', () => {
  let service: MyService;
  let mockRepository: jest.Mocked<MyRepository>;

  beforeEach(() => {
    mockRepository = createMockRepository();
    service = new MyService(mockRepository);
  });

  it('should perform action', async () => {
    mockRepository.findOne.mockResolvedValue(testData);
    const result = await service.method();
    expect(result).toBeDefined();
  });
});
```

### For Controllers

1. Create `*.controller.spec.ts` file in `backend/test/`
2. Mock services
3. Test all endpoints and guards
4. Test validation and error responses

**Example:**
```typescript
describe('MyController', () => {
  let controller: MyController;
  let mockService: jest.Mocked<MyService>;

  beforeEach(() => {
    mockService = createMockService();
    controller = new MyController(mockService);
  });

  it('should handle GET request', async () => {
    mockService.findAll.mockResolvedValue([]);
    const result = await controller.findAll();
    expect(result).toEqual([]);
  });
});
```

### For E2E

1. Add test cases to existing `*.e2e-spec.ts` files or create new ones
2. Use real HTTP requests and database
3. Test complete user flows
4. Clean up after tests

**Example:**
```typescript
describe('MyFeature (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('should complete user flow', async () => {
    // Test complete flow
  });

  afterAll(async () => {
    await truncateTables();
    await app.close();
  });
});
```

### Best Practices

- **Isolation:** Each test should be independent
- **No Shared State:** Don't depend on execution order
- **Clear Names:** Use descriptive test names
- **One Assertion:** Focus each test on one behavior
- **Arrange-Act-Assert:** Structure tests clearly

## Troubleshooting

### Test Database Connection Errors

**Problem:** E2E tests fail with database connection errors.

**Solution:**
1. Verify `DB_TEST_*` environment variables are set correctly
2. Ensure test database exists: `createdb invoiceme_test`
3. Check database credentials and permissions
4. Verify PostgreSQL is running

### Timeout Errors

**Problem:** Tests timeout before completing.

**Solution:**
1. Increase timeout in jest config if tests are slow
2. Check for hanging async operations
3. Verify database queries are completing
4. Check for infinite loops or blocking operations

### Mock Errors

**Problem:** Unit tests fail with "Cannot read property of undefined" or similar.

**Solution:**
1. Ensure all dependencies are mocked in unit tests
2. Verify mock return values match expected types
3. Check that mocks are reset between tests (`beforeEach`)
4. Ensure all async operations are properly awaited

### E2E Cleanup Issues

**Problem:** E2E tests fail due to leftover data.

**Solution:**
1. Check that test database is accessible
2. Verify tables can be truncated (permissions)
3. Ensure cleanup runs in `afterAll` hooks
4. Check for foreign key constraints preventing truncation

### JavaScript heap out of memory

**Problem:** Jest crashes with `FATAL ERROR: ... JavaScript heap out of memory`.

**Solution:** see [Memory](#memory). Check that `backend/jest.config.js` and
`backend/test/jest-e2e.json` pass `tsconfig.jest.json` to ts-jest. The measured
peak is about 1.3 GB per worker cold, 1.5 GB for E2E in band.

### Unix-socket test skipped

**Problem:** `verify-restore.e2e-spec.ts` reports one skipped test.

**Solution:** expected when PostgreSQL is reached over TCP only (e.g. in a
container). To run it, give the server a socket directory of `/tmp` or
`/var/run/postgresql` on the machine running Jest (see [E2E Tests](#e2e-tests)).

### Port Conflicts

**Problem:** E2E tests fail because port 3000 is in use.

**Solution:**
1. Stop any running instances on port 3000
2. Use different port for tests via environment variable
3. Check for zombie processes: `lsof -i :3000`

## Reference

For examples and patterns, see the comprehensive test suite in `backend/test/` directory:

- Service tests: `*.service.spec.ts`
- Controller tests: `*.controller.spec.ts`
- Guard/Strategy tests: `*.guard.spec.ts`, `*.strategy.spec.ts`
- E2E tests: `*.e2e-spec.ts`

