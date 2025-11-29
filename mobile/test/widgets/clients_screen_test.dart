// Flutter imports
import 'package:flutter_test/flutter_test.dart';

// Package imports
import 'package:dio/dio.dart';
import 'package:mocktail/mocktail.dart';

// Local imports - Core
import '../helpers/test_helpers.dart';
import '../../lib/screens/clients_screen.dart';

void main() {
  group('ClientsScreen Widget Tests', () {
    late MockApiClient mockApiClient;

    setUp(() {
      mockApiClient = MockApiClient();
    });

    testWidgets('displays client list after loading', (WidgetTester tester) async {
      when(() => mockApiClient.get(any())).thenAnswer(
        (_) async => Response(
          requestOptions: RequestOptions(path: ''),
          data: {
            'data': [
              {
                'id': '1',
                'name': 'Test Client',
                'email': 'test@example.com',
              }
            ],
            'meta': {'total': 1, 'page': 1, 'limit': 10},
          },
        ),
      );

      await tester.pumpWidget(
        TestWidgetWrapper(
          overrides: TestProviders.create(apiClient: mockApiClient),
          child: const ClientsScreen(),
        ),
      );

      await tester.pumpAndSettle();

      // Should display client
      expect(find.text('Test Client'), findsOneWidget);
    });

    testWidgets('displays empty state when no clients', (WidgetTester tester) async {
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
          child: const ClientsScreen(),
        ),
      );

      await tester.pumpAndSettle();

      // Should show empty state
      expect(find.text('No clients yet'), findsOneWidget);
    });
  });
}

