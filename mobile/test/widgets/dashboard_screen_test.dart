// Flutter imports
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

// Package imports
import 'package:dio/dio.dart';
import 'package:mocktail/mocktail.dart';

// Local imports - Core
import '../helpers/test_helpers.dart';
import '../../lib/screens/dashboard_screen.dart';

void main() {
  group('DashboardScreen Widget Tests', () {
    late MockApiClient mockApiClient;
    late MockAuthService mockAuthService;

    setUp(() {
      mockApiClient = MockApiClient();
      mockAuthService = MockAuthService();
      
      when(() => mockAuthService.isLoggedIn()).thenAnswer((_) async => true);
    });

    testWidgets('displays loading state initially', (WidgetTester tester) async {
      // Mock API call that takes time
      when(() => mockApiClient.get(any())).thenAnswer(
        (_) async => Future.delayed(
          const Duration(milliseconds: 100),
          () => Response(
            requestOptions: RequestOptions(path: ''),
            data: {
              'unpaid': 0,
              'unpaidAmount': 0.0,
              'overdue': 0,
              'overdueAmount': 0.0,
              'totalThisMonth': 0.0,
              'totalInvoices': 0,
            },
          ),
        ),
      );

      await tester.pumpWidget(
        TestWidgetWrapper(
          overrides: TestProviders.create(
            apiClient: mockApiClient,
            authService: mockAuthService,
          ),
          child: const DashboardScreen(),
        ),
      );

      // Should show loading initially
      expect(find.text('Loading dashboard...'), findsOneWidget);
    });

    testWidgets('displays dashboard stats after loading', (WidgetTester tester) async {
      when(() => mockApiClient.get(any())).thenAnswer(
        (_) async => Response(
          requestOptions: RequestOptions(path: ''),
          data: {
            'unpaid': 5,
            'unpaidAmount': 1500.0,
            'overdue': 2,
            'overdueAmount': 500.0,
            'totalThisMonth': 5000.0,
            'totalInvoices': 20,
          },
        ),
      );

      await tester.pumpWidget(
        TestWidgetWrapper(
          overrides: TestProviders.create(
            apiClient: mockApiClient,
            authService: mockAuthService,
          ),
          child: const DashboardScreen(),
        ),
      );

      await tester.pumpAndSettle(const Duration(seconds: 2));

      // Should display stats
      expect(find.text('Unpaid'), findsOneWidget);
      expect(find.text('Overdue'), findsOneWidget);
      expect(find.text('Total This Month'), findsOneWidget);
    });

    testWidgets('displays error message on API failure', (WidgetTester tester) async {
      when(() => mockApiClient.get(any())).thenThrow(
        DioException(
          requestOptions: RequestOptions(path: ''),
          type: DioExceptionType.connectionError,
        ),
      );

      await tester.pumpWidget(
        TestWidgetWrapper(
          overrides: TestProviders.create(
            apiClient: mockApiClient,
            authService: mockAuthService,
          ),
          child: const DashboardScreen(),
        ),
      );

      await tester.pumpAndSettle(const Duration(seconds: 2));

      // Should show error message
      expect(find.text('Failed to Load Dashboard'), findsOneWidget);
    });

    testWidgets('has navigation tabs', (WidgetTester tester) async {
      when(() => mockApiClient.get(any())).thenAnswer(
        (_) async => Response(
          requestOptions: RequestOptions(path: ''),
          data: {
            'unpaid': 0,
            'unpaidAmount': 0.0,
            'overdue': 0,
            'overdueAmount': 0.0,
            'totalThisMonth': 0.0,
            'totalInvoices': 0,
          },
        ),
      );

      await tester.pumpWidget(
        TestWidgetWrapper(
          overrides: TestProviders.create(
            apiClient: mockApiClient,
            authService: mockAuthService,
          ),
          child: const DashboardScreen(),
        ),
      );

      await tester.pumpAndSettle();

      // Should have bottom navigation
      expect(find.byType(BottomNavigationBar), findsOneWidget);
    });
  });
}

