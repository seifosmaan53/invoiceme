// Account switching on one device (DEVICE-ACCEPTANCE.md item 10), through
// the app's own entry points: AuthService login/logout and a SyncService on
// the app database (real SQLite via sqflite_common_ffi in a temp directory).
// Synthetic accounts A and B; the server is simulated per signed-in account.
//
// Uses only APIs that existed before the fix, so it also runs against the
// earlier implementation (where it fails: B sends A's queued change and
// continues A's cursor).

// Dart imports
import 'dart:io';

// Package imports
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite/sqflite.dart' as sqflite;
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

// Local imports
import 'package:invoiceme/core/database/database_helper.dart';
import 'package:invoiceme/core/services/auth_service.dart';
import 'package:invoiceme/core/services/sync_service.dart';

import '../support/two_accounts.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  sqfliteFfiInit();
  sqflite.databaseFactory = databaseFactoryFfi;

  late Directory dir;

  setUp(() async {
    dir = await Directory.systemTemp.createTemp('invoiceme_switch_');
    await Directory('${dir.path}/tmp').create();
    PathProviderPlatform.instance = TempPathProvider(dir.path);
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({});
  });

  tearDown(() async {
    try {
      await (await DatabaseHelper.getDatabase()).close();
    } catch (_) {
      // No open database (no account signed in).
    }
    await dir.delete(recursive: true);
  });

  Future<List<String>> localClientIds() async {
    final db = await DatabaseHelper.getDatabase();
    return [for (final r in await db.query('clients_local', orderBy: 'id')) r['id'] as String];
  }

  Future<List<String>> unsyncedObjectIds() async {
    final db = await DatabaseHelper.getDatabase();
    return [
      for (final r in await db.query('pending_changes', where: 'synced = 0', orderBy: 'created_at'))
        r['object_id'] as String,
    ];
  }

  test('A queues offline, logs out, B signs in: B sends nothing of A and does not use A\'s cursor; A resumes', () async {
    final server = TwoAccountServer();
    const storage = FlutterSecureStorage();
    final auth = AuthService(server, storage);
    final sync = SyncService(server, null);

    // A signs in and syncs once (cursor-of-user-a stored, A's client cached).
    await auth.login('a@example.test', 'pw');
    await sync.sync();
    expect(await localClientIds(), ['a-client-1']);

    // A goes offline and creates a client; it stays queued.
    await sync.queueChange(
      objectType: ChangeObjectType.client,
      objectId: 'a-offline-client',
      changeType: ChangeType.create,
      data: {'name': 'Made by A offline'},
    );
    await auth.logout();

    // B signs in on the same phone and syncs.
    await auth.login('b@example.test', 'pw');
    expect(await unsyncedObjectIds(), isEmpty, reason: "B's store must not contain A's queued change");
    await sync.sync();

    expect(server.pushedObjectIds('user-b'), isNot(contains('a-offline-client')),
        reason: "B's session must never send A's queued change",);
    expect(server.pullCursorsBy['user-b']!.first, isNull,
        reason: "B's first pull must start from the beginning, not from A's cursor",);
    expect(await localClientIds(), ['b-client-1'], reason: "B must not see A's cached records");

    // A signs back in: the offline change is still queued and is sent by A.
    await auth.logout();
    await auth.login('a@example.test', 'pw');
    expect(await unsyncedObjectIds(), ['a-offline-client']);
    await sync.sync();
    expect(server.pushedObjectIds('user-a'), ['a-offline-client']);
    expect(server.pullCursorsBy['user-a']!.last, 'cursor-of-user-a', reason: "A continues from A's own cursor");
    expect(await localClientIds(), ['a-client-1']);
  });
}
