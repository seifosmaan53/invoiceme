// Flows of the Android sync test (android_sync_test.dart) against a real
// backend. Kept apart from the test entry point so they can also be run
// with another database factory.

// Package imports
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite/sqflite.dart';

// Local imports
import 'package:invoiceme/core/database/database_helper.dart';
import 'package:invoiceme/core/providers/providers.dart';
import 'package:invoiceme/core/services/api_client.dart';
import 'package:invoiceme/core/services/sync_conflicts_api.dart';
import 'package:invoiceme/core/services/sync_service.dart';
import 'package:invoiceme/models/invoice.dart';
import 'package:invoiceme/screens/invoice_detail_screen.dart';
import 'package:invoiceme/screens/sync_conflicts_screen.dart';

/// From --dart-define (seed_backend.sh prints the values).
class E2eConfig {
  static const api = String.fromEnvironment('E2E_API', defaultValue: 'http://10.0.2.2:3000/api/v1');
  static const email = String.fromEnvironment('E2E_EMAIL');
  static const password = String.fromEnvironment('E2E_PASSWORD');
  static const paidInvoiceId = String.fromEnvironment('E2E_PAID_INVOICE_ID');

  static bool get configured => email.isNotEmpty && password.isNotEmpty;
}

/// Pumps until [finder] matches, letting real I/O run in between.
Future<void> pumpUntil(WidgetTester tester, Finder finder, {Duration timeout = const Duration(seconds: 30)}) async {
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 100)));
    await tester.pump(const Duration(milliseconds: 50));
    if (finder.evaluate().isNotEmpty) return;
  }
  fail('Timed out waiting for $finder');
}

Future<ApiClient> signedInClient() async {
  final login = await Dio().post('${E2eConfig.api}/auth/login',
      data: {'email': E2eConfig.email, 'password': E2eConfig.password});
  final token = login.data['accessToken'] as String;
  // ApiClient loads the stored token asynchronously when it is created; store
  // it first so that load cannot reset the token set below.
  await const FlutterSecureStorage().write(key: 'access_token', value: token);
  final api = ApiClient()..setBaseUrl(E2eConfig.api);
  await api.setToken(token);
  return api;
}

/// Exact schema of the released app's database (version 2).
const List<String> legacyV2Schema = [
  'CREATE TABLE clients_local (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, email TEXT, phone TEXT, '
      'address_json TEXT, notes TEXT, tags_json TEXT, avatar_url TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, '
      'deleted_at TEXT)',
  'CREATE TABLE invoices_local (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, client_id TEXT NOT NULL, type TEXT NOT NULL, '
      'number TEXT NOT NULL, status TEXT NOT NULL, issue_date TEXT NOT NULL, due_date TEXT, currency TEXT NOT NULL, '
      'subtotal REAL NOT NULL, tax_total REAL NOT NULL, discount_total REAL NOT NULL, total REAL NOT NULL, notes TEXT, '
      'metadata_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)',
  'CREATE TABLE invoice_items_local (id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL, description TEXT NOT NULL, '
      'quantity REAL NOT NULL, unit_price REAL NOT NULL, tax_rate REAL NOT NULL, discount_rate REAL NOT NULL, '
      'line_total REAL NOT NULL, created_at TEXT NOT NULL)',
  'CREATE TABLE attachments_local (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, owner_type TEXT NOT NULL, url TEXT NOT NULL, '
      'filename TEXT NOT NULL, content_type TEXT, size_bytes INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)',
  'CREATE TABLE pending_changes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, device_id TEXT NOT NULL, '
      'object_type TEXT NOT NULL, object_id TEXT NOT NULL, change_type TEXT NOT NULL, change_json TEXT NOT NULL, '
      'synced INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)',
];

/// A version-2 database (with a queued change) opens at the current version.
Future<void> migrationFlow(DatabaseFactory factory, String path) async {
  await factory.deleteDatabase(path);
  final v2 = await factory.openDatabase(path,
      options: OpenDatabaseOptions(
        version: 2,
        onCreate: (db, _) async {
          for (final sql in legacyV2Schema) {
            await db.execute(sql);
          }
        },
      ));
  await v2.insert('pending_changes', {
    'id': 'legacy-1', 'user_id': 'u', 'device_id': 'd', 'object_type': 'client', 'object_id': 'c1',
    'change_type': 'create', 'change_json': '{"name":"Legacy"}', 'synced': 0, 'created_at': '2026-01-01T00:00:00Z',
  });
  await v2.close();

  final db = await DatabaseHelper.openAt(factory, path);
  expect(await db.getVersion(), DatabaseHelper.schemaVersion);
  final columns = (await db.rawQuery('PRAGMA table_info(pending_changes)')).map((c) => c['name']).toSet();
  expect(columns, containsAll(['base_revision', 'status', 'conflict_id', 'last_reason', 'attempts', 'parent_id',
      'parent_base_revision', 'last_result', 'next_attempt_at']));
  for (final table in ['clients_local', 'invoices_local', 'invoice_items_local']) {
    expect((await db.rawQuery('PRAGMA table_info($table)')).map((c) => c['name']), contains('revision'));
  }
  final row = (await db.query('pending_changes')).single;
  expect((row['id'], row['status'], row['attempts']), ('legacy-1', 'pending', 0));
  await db.close();
  // Opening again changes nothing.
  final again = await DatabaseHelper.openAt(factory, path);
  expect((await again.query('pending_changes')).length, 1);
  await again.close();
}

/// Protocol 2 against the real server: pull, an offline edit and a web edit
/// of the same field, the conflict on push, review and "Use my version".
Future<void> conflictFlow(WidgetTester tester, ApiClient api, DatabaseFactory factory, String path) async {
  // Real I/O runs inside runAsync (needed where the test binding fakes time).
  final db = (await tester.runAsync(() async {
    await factory.deleteDatabase(path);
    final db = await DatabaseHelper.openAt(factory, path);
    final prefs = await SharedPreferences.getInstance();
    for (final key in [syncCursorKey, lastSyncTimestampKey, syncFullPullNeededKey, syncOpenConflictsKey, syncStateKey]) {
      await prefs.remove(key);
    }
    return db;
  }))!;
  final service = SyncService(api, null, database: () async => db);

  late String clientId;
  await tester.runAsync(() async {
    final created = await api.post('/clients', data: {'name': 'E2E Original'});
    clientId = created.data['id'] as String;

    final first = await service.sync();
    expect(first.state, SyncState.ok);
    final local = await db.query('clients_local', where: 'id = ?', whereArgs: [clientId]);
    expect(local, hasLength(1), reason: 'the full pull stored the client');
    expect(local.single['revision'], isNotNull);

    await service.queueChange(
      objectType: ChangeObjectType.client,
      objectId: clientId,
      changeType: ChangeType.update,
      data: {'name': 'Edited on device'},
      previous: {'name': 'E2E Original'},
    );
    await api.patch('/clients/$clientId', data: {'name': 'Edited on the web'});

    final second = await service.sync();
    expect(second.conflicts, 1);
    final row = (await db.query('pending_changes', where: 'object_id = ?', whereArgs: [clientId])).single;
    expect(row['status'], 'conflict');
    expect(row['conflict_id'], isNotNull);
    expect(second.openConflicts, greaterThanOrEqualTo(1));
  });

  await tester.pumpWidget(MaterialApp(home: SyncConflictsScreen(api: ApiSyncConflictsApi(api), failedChanges: service)));
  await pumpUntil(tester, find.textContaining('Edited in two places'));
  await tester.tap(find.textContaining('Edited in two places'));
  await pumpUntil(tester, find.text('Use my version'));
  expect(find.text('Edited on device'), findsWidgets);
  expect(find.text('Edited on the web'), findsWidgets);
  expect(find.text('Restore'), findsNothing);

  await tester.tap(find.text('Use my version'));
  await pumpUntil(tester, find.textContaining('Resolved'));
  await tester.runAsync(() async {
    final now = await api.get('/clients/$clientId', useCache: false);
    expect(now.data['name'], 'Edited on device');
  });
  await tester.runAsync(() => db.close());
}

/// The payment card from a real invoice response (seeded partial refund).
Future<void> paymentCardFlow(WidgetTester tester, ApiClient api, String invoiceId) async {
  late Invoice invoice;
  await tester.runAsync(() async {
    final res = await api.get('/invoices/$invoiceId', useCache: false);
    expect(res.data['paymentSummary']?['state'], 'partially_refunded');
    invoice = Invoice.fromJson(res.data as Map<String, dynamic>);
  });
  await tester.pumpWidget(ProviderScope(
    overrides: [apiClientProvider.overrideWithValue(api)],
    child: MaterialApp(home: InvoiceDetailScreen(invoice: invoice)),
  ));
  await pumpUntil(tester, find.text('Partially refunded'));
  expect(find.text('Paid (gross)'), findsOneWidget);
  expect(find.text('Refunded'), findsOneWidget);
  expect(find.text('Net received'), findsOneWidget);
  expect(find.text('\$100.00'), findsWidgets);
  expect(find.text('\$30.00'), findsOneWidget);
  expect(find.text('\$70.00'), findsOneWidget);
  expect(find.byKey(const ValueKey('reopen-invoice')), findsOneWidget);

  // Reopen through the real API, after the confirmation.
  await tester.ensureVisible(find.byKey(const ValueKey('reopen-invoice')));
  await tester.tap(find.byKey(const ValueKey('reopen-invoice')));
  await pumpUntil(tester, find.text('Reopen invoice?'));
  await tester.tap(find.widgetWithText(FilledButton, 'Reopen'));
  await pumpUntil(tester, find.text('Invoice reopened'));
  await tester.runAsync(() async {
    final res = await api.get('/invoices/$invoiceId', useCache: false);
    expect(res.data['status'], isNot('paid'));
    expect(res.data['paymentSummary']['canReopen'], isFalse);
  });

  // Let timers of the screen finish before the test ends.
  await tester.pumpWidget(const SizedBox());
  await tester.pump(const Duration(seconds: 5));
}
