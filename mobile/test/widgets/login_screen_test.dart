// Flutter imports
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

// Package imports
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mocktail/mocktail.dart';

// Local imports - Core
import '../helpers/test_helpers.dart';
import '../../lib/core/providers/providers.dart';
import '../../lib/core/services/auth_service.dart';
import '../../lib/screens/login_screen.dart';

void main() {
  group('LoginScreen Widget Tests', () {
    late MockAuthService mockAuthService;

    setUp(() {
      mockAuthService = MockAuthService();
      
      // Register fallback values for mocktail
      registerFallbackValue(Uri());
    });

    testWidgets('displays login form by default', (WidgetTester tester) async {
      when(() => mockAuthService.isLoggedIn()).thenAnswer((_) async => false);

      await tester.pumpWidget(
        TestWidgetWrapper(
          overrides: TestProviders.create(authService: mockAuthService),
          child: const LoginScreen(),
        ),
      );

      await waitForAsync(tester);

      // Verify login form elements are present
      expect(find.text('Email'), findsOneWidget);
      expect(find.text('Password'), findsOneWidget);
      expect(find.text('Login'), findsOneWidget);
      expect(find.text('Register'), findsOneWidget);
    });

    testWidgets('switches to register mode when register button is tapped',
        (WidgetTester tester) async {
      when(() => mockAuthService.isLoggedIn()).thenAnswer((_) async => false);

      await tester.pumpWidget(
        TestWidgetWrapper(
          overrides: TestProviders.create(authService: mockAuthService),
          child: const LoginScreen(),
        ),
      );

      await waitForAsync(tester);

      // Tap register button
      await tester.tap(find.text('Register'));
      await tester.pumpAndSettle();

      // Verify register form elements are present
      expect(find.text('Name'), findsOneWidget);
      expect(find.text('Company Name (Optional)'), findsOneWidget);
      expect(find.text('Create Account'), findsOneWidget);
    });

    testWidgets('shows validation errors for empty email', (WidgetTester tester) async {
      when(() => mockAuthService.isLoggedIn()).thenAnswer((_) async => false);

      await tester.pumpWidget(
        TestWidgetWrapper(
          overrides: TestProviders.create(authService: mockAuthService),
          child: const LoginScreen(),
        ),
      );

      await waitForAsync(tester);

      // Try to submit without entering email
      await tester.tap(find.text('Login'));
      await tester.pumpAndSettle();

      // Should show validation error
      expect(find.text('Please enter your email'), findsOneWidget);
    });

    testWidgets('shows validation errors for invalid email', (WidgetTester tester) async {
      when(() => mockAuthService.isLoggedIn()).thenAnswer((_) async => false);

      await tester.pumpWidget(
        TestWidgetWrapper(
          overrides: TestProviders.create(authService: mockAuthService),
          child: const LoginScreen(),
        ),
      );

      await waitForAsync(tester);

      // Enter invalid email
      await tester.enterText(find.byType(TextField).first, 'invalid-email');
      await tester.tap(find.text('Login'));
      await tester.pumpAndSettle();

      // Should show validation error
      expect(find.text('Please enter a valid email'), findsOneWidget);
    });

    testWidgets('shows password visibility toggle', (WidgetTester tester) async {
      when(() => mockAuthService.isLoggedIn()).thenAnswer((_) async => false);

      await tester.pumpWidget(
        TestWidgetWrapper(
          overrides: TestProviders.create(authService: mockAuthService),
          child: const LoginScreen(),
        ),
      );

      await waitForAsync(tester);

      // Find password field
      final passwordField = find.byType(TextField).last;
      await tester.enterText(passwordField, 'password123');

      // Find visibility toggle icon
      final visibilityIcon = find.byIcon(Icons.visibility_off);
      expect(visibilityIcon, findsOneWidget);

      // Tap to show password
      await tester.tap(visibilityIcon);
      await tester.pumpAndSettle();

      // Should show visibility icon
      expect(find.byIcon(Icons.visibility), findsOneWidget);
    });

    testWidgets('handles successful login', (WidgetTester tester) async {
      when(() => mockAuthService.isLoggedIn()).thenAnswer((_) async => false);
      when(() => mockAuthService.login(any(), any())).thenAnswer((_) async => Future.value());

      await tester.pumpWidget(
        TestWidgetWrapper(
          overrides: TestProviders.create(authService: mockAuthService),
          child: const LoginScreen(),
        ),
      );

      await waitForAsync(tester);

      // Enter credentials
      await tester.enterText(find.byType(TextField).first, 'test@example.com');
      await tester.enterText(find.byType(TextField).last, 'password123');

      // Submit login
      await tester.tap(find.text('Login'));
      await tester.pumpAndSettle();

      // Verify login was called
      verify(() => mockAuthService.login('test@example.com', 'password123')).called(1);
    });
  });
}

