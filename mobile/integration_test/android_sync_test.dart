// On-device sync test (Android emulator in .github/workflows/android-test.yml):
// native SQLite migration, protocol 2 against a real backend, and the
// payment card from a real invoice response, account switching between two
// synthetic accounts. Synthetic data only.
//
// flutter test integration_test/android_sync_test.dart \
//   --dart-define=E2E_EMAIL=... --dart-define=E2E_PASSWORD=... --dart-define=E2E_PAID_INVOICE_ID=...

// Package imports
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

import 'sync_flows.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('native SQLite: a version-2 database migrates to the current version', (tester) async {
    await migrationFlow(databaseFactory, p.join(await getDatabasesPath(), 'migration_test.db'));
  });

  group('real backend', () {
    testWidgets('stale edit: conflict on push, shown and resolved in the conflict screen', (tester) async {
      final api = await signedInClient();
      await conflictFlow(tester, api, databaseFactory, p.join(await getDatabasesPath(), 'sync_e2e.db'));
    });

    testWidgets('account switching: A\'s queued change and data stay with A; B starts clean', (tester) async {
      await accountSwitchFlow(tester, databaseFactory, p.join(await getDatabasesPath(), 'account_switch'));
    }, skip: !E2eConfig.secondAccount);

    testWidgets('payment card from a real invoice response', (tester) async {
      final api = await signedInClient();
      await paymentCardFlow(tester, api, E2eConfig.paidInvoiceId);
    }, skip: E2eConfig.paidInvoiceId.isEmpty);
  }, skip: !E2eConfig.configured);
}
