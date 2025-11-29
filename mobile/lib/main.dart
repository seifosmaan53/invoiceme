// Flutter imports
import 'package:flutter/foundation.dart' show debugPrint, kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

// Package imports
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

// Local imports - Core
import 'core/database/database_helper.dart';
import 'core/providers/providers.dart';
import 'core/providers/theme_provider.dart';
import 'core/services/api_client.dart';
import 'core/services/auth_service.dart';
import 'core/services/keyboard_shortcuts.dart';
import 'core/services/sync_service.dart';
import 'core/utils/app_animations.dart';

// Local imports - Screens
import 'screens/dashboard_screen.dart';
import 'screens/login_screen.dart';

// Local imports - Widgets
import 'widgets/error_boundary.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Enable clipboard access for web platform
  if (kIsWeb) {
    // Request clipboard permissions if needed
    try {
      // This helps ensure clipboard functionality works on web
      await Clipboard.setData(const ClipboardData(text: ''));
    } catch (e) {
      // Clipboard might not be available, continue anyway
      debugPrint('Clipboard initialization note: $e');
    }
  }

  // Wrap in try-catch to catch initialization errors
  try {
    // Initialize services
    final apiClient = ApiClient();
    const secureStorage = FlutterSecureStorage();
    DatabaseHelper? dbHelper;
    
    // Only initialize database on mobile platforms (sqflite doesn't work on web)
    if (!kIsWeb) {
      dbHelper = DatabaseHelper();
      await DatabaseHelper.getDatabase(); // Use static method
    }

    final authService = AuthService(apiClient, secureStorage);
    await authService.initialize();

    // SyncService requires database, skip on web for now
    SyncService? syncService;
    if (!kIsWeb && dbHelper != null) {
      syncService = SyncService(apiClient, dbHelper);
    }

    // Check if user is logged in
    final isLoggedIn = await authService.isLoggedIn();

    runApp(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(apiClient),
          authServiceProvider.overrideWithValue(authService),
          // Always override syncServiceProvider - use null on web, real service on mobile
          syncServiceProvider.overrideWithValue(syncService),
          if (dbHelper != null) dbHelperProvider.overrideWithValue(dbHelper),
        ],
        child: InvoiceMeApp(isLoggedIn: isLoggedIn),
      ),
    );
  } catch (e, stackTrace) {
    // Show error screen if initialization fails
    runApp(
      MaterialApp(
        home: Scaffold(
          body: Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.error, color: Colors.red, size: 48),
                const SizedBox(height: 16),
                Text('Error initializing app:', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                Padding(
                  padding: const EdgeInsets.all(16.0),
                  child: Text(
                    e.toString(),
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Colors.red),
                  ),
                ),
                const SizedBox(height: 16),
                ElevatedButton(
                  onPressed: () => main(),
                  child: const Text('Retry'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class InvoiceMeApp extends ConsumerWidget {
  final bool isLoggedIn;

  const InvoiceMeApp({super.key, required this.isLoggedIn});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final themeMode = ref.watch(themeModeProvider);
    
    final app = MaterialApp(
      title: 'InvoiceMe',
      theme: lightTheme,
      darkTheme: darkTheme,
      themeMode: themeMode,
      // Explicitly set localizations delegates to ensure MaterialLocalizations are available
      localizationsDelegates: const [
        DefaultMaterialLocalizations.delegate,
        DefaultWidgetsLocalizations.delegate,
      ],
      supportedLocales: const [
        Locale('en', ''), // English
      ],
      // Smooth page transitions
      onGenerateRoute: (settings) {
        switch (settings.name) {
          case '/login':
            return AppPageTransitions.fade(const LoginScreen());
          case '/dashboard':
            return AppPageTransitions.slideRight(const DashboardScreen());
          default:
            return MaterialPageRoute(builder: (_) => const LoginScreen());
        }
      },
      // Don't wrap SelectionArea here - it needs to be inside MaterialApp's widget tree
      // SelectionArea will be handled at the screen level where Overlay is available
      home: ErrorBoundary(
        child: isLoggedIn ? const DashboardScreen() : const LoginScreen(),
      ),
      routes: {
        '/login': (context) => const LoginScreen(),
        '/dashboard': (context) => const DashboardScreen(),
      },
      debugShowCheckedModeBanner: false,
    );
    
    // Wrap with keyboard shortcuts - ErrorBoundary is now inside MaterialApp
    return KeyboardShortcuts.wrapWithShortcuts(
      child: app,
    );
  }
}

