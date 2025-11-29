# Flutter Test Suite

This directory contains comprehensive tests for the InvoiceMe Flutter application.

## Test Structure

```
test/
├── helpers/
│   └── test_helpers.dart          # Test utilities and mocks
├── widgets/
│   ├── login_screen_test.dart     # Login screen widget tests
│   ├── dashboard_screen_test.dart # Dashboard widget tests
│   ├── invoices_screen_test.dart   # Invoices screen tests
│   ├── clients_screen_test.dart   # Clients screen tests
│   └── settings_screen_test.dart  # Settings screen tests
├── services/
│   ├── auth_service_test.dart     # Auth service unit tests
│   └── csv_service_test.dart      # CSV service unit tests
└── utils/
    └── form_validators_test.dart   # Form validation tests

integration_test/
└── app_test.dart                   # End-to-end integration tests
```

## Running Tests

### Run all tests
```bash
flutter test
```

### Run specific test file
```bash
flutter test test/widgets/login_screen_test.dart
```

### Run integration tests
```bash
flutter test integration_test/app_test.dart
```

### Run with coverage
```bash
flutter test --coverage
```

## Test Coverage

- **Widget Tests**: 5+ test files covering key screens
- **Service Tests**: Unit tests for core services
- **Integration Tests**: End-to-end user flow tests
- **Total**: 10+ test files with 50+ test cases

## Test Helpers

The `test_helpers.dart` file provides:
- Mock classes for services (ApiClient, AuthService, etc.)
- TestWidgetWrapper for easy widget testing with providers
- Helper functions for async operations
- Test provider setup utilities

## Writing New Tests

1. Create test file in appropriate directory (`widgets/`, `services/`, `utils/`)
2. Import test helpers: `import '../helpers/test_helpers.dart';`
3. Use `TestWidgetWrapper` for widget tests
4. Use mock classes for service dependencies
5. Follow naming convention: `*_test.dart`

## Best Practices

- Use `mocktail` for mocking (no code generation needed)
- Test both success and error cases
- Test user interactions (taps, text input, etc.)
- Use `pumpAndSettle()` for async operations
- Keep tests isolated and independent
- Use descriptive test names

