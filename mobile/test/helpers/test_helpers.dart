// Flutter imports
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

// Package imports
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:mocktail/mocktail.dart';

// Local imports - Core
import '../../lib/core/database/database_helper.dart';
import '../../lib/core/providers/providers.dart';
import '../../lib/core/providers/theme_provider.dart';
import '../../lib/core/services/api_client.dart';
import '../../lib/core/services/auth_service.dart';
import '../../lib/core/services/sync_service.dart';

/// Mock classes for testing
class MockApiClient extends Mock implements ApiClient {}

class MockAuthService extends Mock implements AuthService {}

class MockSyncService extends Mock implements SyncService {}

class MockDatabaseHelper extends Mock implements DatabaseHelper {}

class MockDio extends Mock implements Dio {}

class MockSecureStorage extends Mock implements FlutterSecureStorage {}

/// Test widget wrapper with providers
class TestWidgetWrapper extends StatelessWidget {
  final Widget child;
  final List<dynamic>? overrides; // ignore: avoid_annotating_with_dynamic

  const TestWidgetWrapper({
    super.key,
    required this.child,
    this.overrides,
  });

  @override
  Widget build(BuildContext context) {
    final List<dynamic> providers = [
      // Default mock providers
      apiClientProvider.overrideWithValue(MockApiClient()),
      authServiceProvider.overrideWithValue(MockAuthService()),
      syncServiceProvider.overrideWithValue(null),
      dbHelperProvider.overrideWithValue(null),
      ...?overrides,
    ];

    return ProviderScope(
      // ignore: argument_type_not_assignable
      overrides: providers,
      child: MaterialApp(
        theme: lightTheme,
        darkTheme: darkTheme,
        home: child,
      ),
    );
  }
}

/// Helper to create test providers
class TestProviders {
  static List<dynamic> create({
    ApiClient? apiClient,
    AuthService? authService,
    SyncService? syncService,
    DatabaseHelper? dbHelper,
  }) {
    return [
      if (apiClient != null)
        apiClientProvider.overrideWithValue(apiClient)
      else
        apiClientProvider.overrideWithValue(MockApiClient()),
      if (authService != null)
        authServiceProvider.overrideWithValue(authService)
      else
        authServiceProvider.overrideWithValue(MockAuthService()),
      syncServiceProvider.overrideWithValue(syncService),
      if (dbHelper != null) dbHelperProvider.overrideWithValue(dbHelper),
    ];
  }
}

/// Helper to wait for async operations
Future<void> waitForAsync(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 100));
}

/// Helper to find text with timeout
Future<void> waitForText(
  WidgetTester tester,
  String text, {
  Duration timeout = const Duration(seconds: 5),
}) async {
  final startTime = DateTime.now();
  final finder = find.text(text);

  while (!tester.any(finder) && DateTime.now().difference(startTime) < timeout) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

