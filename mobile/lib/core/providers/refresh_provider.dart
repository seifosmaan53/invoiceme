import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Types of data that can trigger refresh
enum RefreshType {
  invoices,
  clients,
  dashboard,
  settings,
  all, // Refresh everything
}

/// Refresh notifier that tracks when data changes
class RefreshNotifier extends Notifier<int> {
  RefreshType? _lastRefreshType;
  RefreshType? get lastRefreshType => _lastRefreshType;

  @override
  int build() {
    return 0;
  }

  /// Trigger a refresh for specific data type
  void refresh(RefreshType type) {
    state = state + 1; // Increment to trigger rebuild
    _lastRefreshType = type;
  }

  /// Get refresh count for specific type (for watching specific types)
  int getRefreshCount(RefreshType type) {
    return state; // For now, all types share the same counter
  }
}

/// Provider for refresh notifier
final refreshNotifierProvider = NotifierProvider<RefreshNotifier, int>(() {
  return RefreshNotifier();
});

/// Helper function to trigger refresh from anywhere
void triggerRefresh(WidgetRef ref, RefreshType type) {
  ref.read(refreshNotifierProvider.notifier).refresh(type);
}

