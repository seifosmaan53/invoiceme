// Flutter imports
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

// Package imports
import 'package:dio/dio.dart';
import 'package:mocktail/mocktail.dart';

// Local imports - Core
import '../helpers/test_helpers.dart';
import '../../lib/screens/invoices_screen.dart';

void main() {
  group('InvoicesScreen Widget Tests', () {
    late MockApiClient mockApiClient;

    setUp(() {
      mockApiClient = MockApiClient();
    });

    testWidgets('displays invoice list after loading', (WidgetTester tester) async {
      when(() => mockApiClient.get(any())).thenAnswer(
        (_) async => Response(
          requestOptions: RequestOptions(path: ''),
          data: {
            'data': [
              {
                'id': '1',
                'number': 'INV-2025-001',
                'status': 'unpaid',
                'total': 100.0,
                'client': {'name': 'Test Client'},
              }
            ],
            'meta': {'total': 1, 'page': 1, 'limit': 10},
          },
        ),
      );

      await tester.pumpWidget(
        TestWidgetWrapper(
          overrides: TestProviders.create(apiClient: mockApiClient),
          child: const InvoicesScreen(),
        ),
      );

      await tester.pumpAndSettle();

      // Should display invoice
      expect(find.text('INV-2025-001'), findsOneWidget);
    });

    testWidgets('displays empty state when no invoices', (WidgetTester tester) async {
      when(() => mockApiClient.get(any())).thenAnswer(
        (_) async => Response(
          requestOptions: RequestOptions(path: ''),
          data: {
            'data': [],
            'meta': {'total': 0, 'page': 1, 'limit': 10},
          },
        ),
      );

      await tester.pumpWidget(
        TestWidgetWrapper(
          overrides: TestProviders.create(apiClient: mockApiClient),
          child: const InvoicesScreen(),
        ),
      );

      await tester.pumpAndSettle();

      // Should show empty state
      expect(find.text('No invoices yet'), findsOneWidget);
    });

    testWidgets('has search functionality', (WidgetTester tester) async {
      when(() => mockApiClient.get(any())).thenAnswer(
        (_) async => Response(
          requestOptions: RequestOptions(path: ''),
          data: {
            'data': [],
            'meta': {'total': 0, 'page': 1, 'limit': 10},
          },
        ),
      );

      await tester.pumpWidget(
        TestWidgetWrapper(
          overrides: TestProviders.create(apiClient: mockApiClient),
          child: const InvoicesScreen(),
        ),
      );

      await tester.pumpAndSettle();

      // Should have search field
      expect(find.byType(TextField), findsOneWidget);
    });
  });
}

