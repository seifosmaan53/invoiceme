// Flutter imports
import 'package:flutter_test/flutter_test.dart';

// Package imports
import 'package:mocktail/mocktail.dart';

// Local imports - Core
import '../helpers/test_helpers.dart';
import '../../lib/screens/settings_screen.dart';

void main() {
  group('SettingsScreen Widget Tests', () {
    testWidgets('displays settings screen', (WidgetTester tester) async {
      await tester.pumpWidget(
        const TestWidgetWrapper(
          child: SettingsScreen(),
        ),
      );

      await tester.pumpAndSettle();

      // Should display settings screen
      expect(find.byType(SettingsScreen), findsOneWidget);
    });

    testWidgets('has user profile section', (WidgetTester tester) async {
      await tester.pumpWidget(
        const TestWidgetWrapper(
          child: SettingsScreen(),
        ),
      );

      await tester.pumpAndSettle();

      // Should have profile section
      expect(find.text('Profile'), findsOneWidget);
    });
  });
}

