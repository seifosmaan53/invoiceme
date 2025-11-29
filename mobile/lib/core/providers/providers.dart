// Package imports
import 'package:flutter_riverpod/flutter_riverpod.dart';

// Local imports - Core
import '../database/database_helper.dart';
import '../services/api_client.dart';
import '../services/auth_service.dart';
import '../services/sync_service.dart';

// Providers exported for use throughout the app
final apiClientProvider = Provider<ApiClient>((ref) {
  throw UnimplementedError('apiClientProvider must be overridden');
});

final authServiceProvider = Provider<AuthService>((ref) {
  throw UnimplementedError('authServiceProvider must be overridden');
});

final syncServiceProvider = Provider<SyncService?>((ref) {
  // Return null by default - will be overridden in main.dart if available
  // This allows Settings screen to work on web where sync is not available
  return null;
});

final dbHelperProvider = Provider<DatabaseHelper?>((ref) {
  throw UnimplementedError('dbHelperProvider must be overridden');
});

