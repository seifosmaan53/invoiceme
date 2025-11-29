import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

enum AppTheme { light, dark, system }

class ThemeNotifier extends Notifier<AppTheme> {
  // Default to light mode to avoid dark mode issues on web
  @override
  AppTheme build() {
    // Load theme asynchronously, but start with light mode
    _loadTheme();
    return AppTheme.light; // Default to light mode instead of system
  }

  Future<void> _loadTheme() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final themeString = prefs.getString('app_theme');
      
      if (themeString != null) {
        final theme = AppTheme.values.firstWhere(
          (e) => e.name == themeString,
          orElse: () => AppTheme.light, // Default to light if invalid value
        );
        state = theme;
      } else {
        // No saved preference - default to light mode
        state = AppTheme.light;
      }
    } catch (e) {
      // If loading fails, default to light mode
      state = AppTheme.light;
    }
  }

  Future<void> setTheme(AppTheme theme) async {
    state = theme;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('app_theme', theme.name);
    } catch (e) {
      // If saving fails, continue anyway - theme is already set in state
    }
  }
}

final themeProvider = NotifierProvider<ThemeNotifier, AppTheme>(() {
  return ThemeNotifier();
});

final themeModeProvider = Provider<ThemeMode>((ref) {
  final theme = ref.watch(themeProvider);
  switch (theme) {
    case AppTheme.light:
      return ThemeMode.light;
    case AppTheme.dark:
      return ThemeMode.dark;
    case AppTheme.system:
      // Use system theme on both platforms for consistency
      // If system theme detection is unreliable, user can manually select light/dark
      return ThemeMode.system;
  }
});

final lightTheme = ThemeData(
  primarySwatch: Colors.blue,
  primaryColor: const Color(0xFF4a90e2),
  useMaterial3: true,
  brightness: Brightness.light,
  // Smooth animations
  pageTransitionsTheme: const PageTransitionsTheme(
    builders: {
      TargetPlatform.android: FadeUpwardsPageTransitionsBuilder(),
      TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
      TargetPlatform.macOS: FadeUpwardsPageTransitionsBuilder(),
      TargetPlatform.windows: FadeUpwardsPageTransitionsBuilder(),
      TargetPlatform.linux: FadeUpwardsPageTransitionsBuilder(),
    },
  ),
  appBarTheme: const AppBarTheme(
    backgroundColor: Color(0xFF4a90e2),
    foregroundColor: Colors.white,
    elevation: 0,
    centerTitle: false,
  ),
  cardTheme: CardThemeData(
    elevation: 2,
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
    margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
  ),
  elevatedButtonTheme: ElevatedButtonThemeData(
    style: ElevatedButton.styleFrom(
      elevation: 2,
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
      ),
    ),
  ),
  inputDecorationTheme: InputDecorationTheme(
    border: OutlineInputBorder(
      borderRadius: BorderRadius.circular(12),
    ),
    filled: true,
    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
  ),
  colorScheme: ColorScheme.fromSeed(
    seedColor: const Color(0xFF4a90e2),
    brightness: Brightness.light,
  ),
);

final darkTheme = ThemeData(
  primarySwatch: Colors.blue,
  primaryColor: const Color(0xFF4a90e2),
  useMaterial3: true,
  brightness: Brightness.dark,
  // Smooth animations
  pageTransitionsTheme: const PageTransitionsTheme(
    builders: {
      TargetPlatform.android: FadeUpwardsPageTransitionsBuilder(),
      TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
      TargetPlatform.macOS: FadeUpwardsPageTransitionsBuilder(),
      TargetPlatform.windows: FadeUpwardsPageTransitionsBuilder(),
      TargetPlatform.linux: FadeUpwardsPageTransitionsBuilder(),
    },
  ),
  appBarTheme: const AppBarTheme(
    backgroundColor: Color(0xFF1a1a1a),
    foregroundColor: Colors.white,
    elevation: 0,
    centerTitle: false,
  ),
  cardTheme: CardThemeData(
    elevation: 2,
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
    color: const Color(0xFF2a2a2a),
    margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
  ),
  elevatedButtonTheme: ElevatedButtonThemeData(
    style: ElevatedButton.styleFrom(
      elevation: 2,
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
      ),
    ),
  ),
  inputDecorationTheme: InputDecorationTheme(
    border: OutlineInputBorder(
      borderRadius: BorderRadius.circular(12),
    ),
    filled: true,
    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
  ),
  scaffoldBackgroundColor: const Color(0xFF121212),
  colorScheme: ColorScheme.fromSeed(
    seedColor: const Color(0xFF4a90e2),
    brightness: Brightness.dark,
  ),
);

