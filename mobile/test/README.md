# Flutter Test Suite

Unit tests for the InvoiceMe Flutter app, focused on the business logic that is
worth locking down: CSV export, form validation, and a top-level smoke test.

## Test Structure

```
test/
├── screens/                      # Conflict screen, payment card
├── services/
│   ├── account_switch_regression_test.dart # A/B on one device (fails on the old shared store)
│   ├── account_isolation_test.dart         # Per-account storage: in-flight switch, restart,
│   │                                       # legacy/quarantine, removal, token binding
│   ├── sync_*_test.dart          # Sync protocol 2 (real SQLite via sqflite_common_ffi)
│   └── csv_service_test.dart     # CSV export formatting/escaping
├── support/two_accounts.dart     # Simulated server for synthetic accounts A and B
├── utils/
│   └── form_validators_test.dart # Email/amount/required-field validation
└── widget_test.dart              # App boots without throwing
```

## Running Tests

```bash
flutter test                       # all tests
flutter test test/services/        # a single directory
flutter test --coverage            # with coverage
```

Requires Flutter 3.35+ (Dart 3.9+), matching the CI matrix.

## Scope

These cover the pure, deterministic logic that regressions would silently break.
Widget/screen tests were removed rather than kept in a perpetually-red state:
they asserted UI that had since changed intentionally, so they tested an app that
no longer existed. If they come back, they should be written against the current
screens and pass on the CI toolchain before being committed.

## Best Practices

- `mocktail` for mocking (no code generation).
- Test both success and error paths.
- Keep tests isolated, deterministic, and named for the behavior they assert.
