import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import '../../screens/create_invoice_screen.dart';
import '../../screens/create_client_screen.dart';

/// Global registry for search field focus nodes
/// This allows keyboard shortcuts to focus search fields across different screens
class SearchFocusRegistry {
  static final Map<String, FocusNode> _focusNodes = {};
  
  /// Register a focus node for a specific screen
  static void register(String screenName, FocusNode focusNode) {
    _focusNodes[screenName] = focusNode;
  }
  
  /// Unregister a focus node
  static void unregister(String screenName) {
    _focusNodes.remove(screenName);
  }
  
  /// Focus the search field for the current screen
  static bool focusSearch(BuildContext? context) {
    if (context == null) return false;
    
    // Try to determine current screen from route
    final route = ModalRoute.of(context);
    final routeName = route?.settings.name ?? '';
    
    // Try to find matching focus node
    FocusNode? focusNode;
    
    // Check for invoices screen
    if (routeName.contains('invoice') || routeName.contains('Invoice') || 
        routeName.isEmpty && context.widget.toString().contains('InvoicesScreen')) {
      focusNode = _focusNodes['invoices'];
    }
    // Check for clients screen
    else if (routeName.contains('client') || routeName.contains('Client') ||
             context.widget.toString().contains('ClientsScreen')) {
      focusNode = _focusNodes['clients'];
    }
    
    // If no specific match, try to focus any available search field
    if (focusNode == null && _focusNodes.isNotEmpty) {
      focusNode = _focusNodes.values.first;
    }
    
    if (focusNode != null && focusNode.canRequestFocus) {
      focusNode.requestFocus();
      return true;
    }
    
    return false;
  }
}

/// Keyboard shortcuts service for desktop/web
/// Note: Full navigation shortcuts require integration with DashboardScreen's tab system
/// For now, we provide create and search shortcuts that work globally
class KeyboardShortcuts {
  /// Setup keyboard shortcuts wrapper widget
  static Widget wrapWithShortcuts({required Widget child}) {
    if (!kIsWeb) return child; // Only enable on web for now

    return Shortcuts(
      shortcuts: {
        // Action shortcuts (work globally)
        LogicalKeySet(LogicalKeyboardKey.control, LogicalKeyboardKey.keyN):
            const _CreateIntent(),
        LogicalKeySet(LogicalKeyboardKey.control, LogicalKeyboardKey.keyF):
            const _FocusSearchIntent(),
      },
      child: Actions(
        actions: {
          _CreateIntent: _CreateAction(),
          _FocusSearchIntent: _FocusSearchAction(),
        },
        child: Focus(
          // autofocus: true, // Disabled to prevent Flutter web focus errors
          child: child,
        ),
      ),
    );
  }

}

/// Intent for create action
class _CreateIntent extends Intent {
  const _CreateIntent();
}

/// Intent for focus search
class _FocusSearchIntent extends Intent {
  const _FocusSearchIntent();
}

/// Action handler for create
class _CreateAction extends Action<_CreateIntent> {
  @override
  Object? invoke(_CreateIntent intent) {
    final focusNode = FocusManager.instance.primaryFocus;
    final context = focusNode?.context;
    if (context == null) return null;

    // Determine current screen and show appropriate create dialog
    final route = ModalRoute.of(context)?.settings.name ?? '';
    
    if (route.contains('invoice') || route.contains('Invoice')) {
      Navigator.push(
        context,
        MaterialPageRoute(builder: (_) => const CreateInvoiceScreen()),
      );
    } else if (route.contains('client') || route.contains('Client')) {
      Navigator.push(
        context,
        MaterialPageRoute(builder: (_) => const CreateClientScreen()),
      );
    } else {
      // Default: show invoice creation
      Navigator.push(
        context,
        MaterialPageRoute(builder: (_) => const CreateInvoiceScreen()),
      );
    }
    return null;
  }
}

/// Action handler for focus search
class _FocusSearchAction extends Action<_FocusSearchIntent> {
  @override
  Object? invoke(_FocusSearchIntent intent) {
    final context = FocusManager.instance.primaryFocus?.context;
    if (context == null) return null;

    // Use the global registry to focus the search field
    final focused = SearchFocusRegistry.focusSearch(context);
    if (!focused) {
      // Fallback: show a snackbar to inform user
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('No search field available on this screen'),
          duration: Duration(seconds: 1),
        ),
      );
    }
    
    return null;
  }
}

/// Handler for keyboard shortcuts
class KeyboardShortcutsHandler extends InheritedWidget {
  final Map<LogicalKeySet, VoidCallback> shortcuts;

  const KeyboardShortcutsHandler({
    super.key,
    required this.shortcuts,
    required super.child,
  });

  static KeyboardShortcutsHandler? of(BuildContext context) {
    return context.dependOnInheritedWidgetOfExactType<KeyboardShortcutsHandler>();
  }

  void registerShortcuts(Map<LogicalKeySet, VoidCallback> newShortcuts) {
    shortcuts.addAll(newShortcuts);
  }

  @override
  bool updateShouldNotify(KeyboardShortcutsHandler oldWidget) {
    return shortcuts != oldWidget.shortcuts;
  }
}

