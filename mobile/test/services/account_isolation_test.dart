// Per-account local storage (LocalAccounts) through AuthService and
// SyncService on real SQLite (sqflite_common_ffi in a temp directory), with
// a simulated server for synthetic accounts A and B: in-flight work during a
// switch, restarts during a transition, conflicts/retries/attachments,
// legacy databases, explicit removal, and token/account binding.

// Dart imports
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

// Package imports
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

// Local imports
import 'package:invoiceme/core/database/database_helper.dart';
import 'package:invoiceme/core/database/local_accounts.dart';
import 'package:invoiceme/core/services/api_client.dart';
import 'package:invoiceme/core/services/auth_service.dart';
import 'package:invoiceme/core/services/sync_service.dart';

import '../support/two_accounts.dart';

const a = 'a@example.test';
const b = 'b@example.test';

/// The app's services as main.dart wires them; [restart] replaces them all
/// (a new process over the same files, preferences and secure storage).
class App {
  final String root;
  late LocalAccounts accounts;
  late TwoAccountServer server;
  late AuthService auth;
  late SyncService sync;

  App(this.root) {
    restart();
  }

  void restart() {
    accounts = LocalAccounts(factory: databaseFactoryFfi, directory: () async => root);
    LocalAccounts.instance = accounts;
    server = TwoAccountServer();
    auth = AuthService(server, const FlutterSecureStorage(), accounts: accounts);
    sync = SyncService(server, null, accounts: accounts, deviceId: 'phone-1');
  }

  Future<Database> db() => accounts.database();

  /// Opens [userId]'s database file directly (while it is not signed in).
  Future<T> withFileOf<T>(String userId, Future<T> Function(Database db) body) async {
    final db = await DatabaseHelper.openAt(databaseFactoryFfi, await accounts.pathFor(userId));
    try {
      return await body(db);
    } finally {
      await db.close();
    }
  }

  Future<List<String>> unsynced([Database? on]) async => [
        for (final r in await (on ?? await db()).query('pending_changes', where: 'synced = 0', orderBy: 'created_at, id'))
          r['object_id'] as String,
      ];

  Future<List<String>> clients([Database? on]) async =>
      [for (final r in await (on ?? await db()).query('clients_local', orderBy: 'id')) r['id'] as String];

  Future<String> queueCreate(String objectId) async => (await sync.queueChange(
        objectType: ChangeObjectType.client,
        objectId: objectId,
        changeType: ChangeType.create,
        data: {'name': objectId},
      ))!;
}

Map<String, Object?> pendingRow(String id, String userId, String objectId,
        {String status = 'pending', int attempts = 0, String? nextAttemptAt, String? conflictId,}) =>
    {
      'id': id,
      'user_id': userId,
      'device_id': 'old-device',
      'object_type': 'client',
      'object_id': objectId,
      'change_type': 'create',
      'change_json': '{"name":"$objectId"}',
      'synced': 0,
      'created_at': '2026-10-20T10:00:00.000',
      'status': status,
      'attempts': attempts,
      'next_attempt_at': nextAttemptAt,
      'conflict_id': conflictId,
    };

Map<String, Object?> clientRow(String id, String userId) =>
    {'id': id, 'user_id': userId, 'name': id, 'created_at': 'x', 'updated_at': 'x', 'revision': 1};

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  sqfliteFfiInit();

  late Directory dir;
  late App app;

  setUp(() async {
    dir = await Directory.systemTemp.createTemp('invoiceme_accounts_');
    await Directory('${dir.path}/tmp').create();
    PathProviderPlatform.instance = TempPathProvider(dir.path);
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({});
    app = App(dir.path);
  });

  tearDown(() async {
    await app.accounts.deactivate();
    await dir.delete(recursive: true);
  });

  group('in-flight work during an account switch', () {
    test('a pull answered after the switch writes nothing, to A or to B', () async {
      await app.auth.login(a, 'pw');
      final gate = Completer<void>();
      app.server.pullGate = gate;
      final aSync = app.sync.sync();
      await app.server.requestArrived.future;

      // Sign-out waits for A's sync to stop; the response arrives meanwhile.
      final switching = () async {
        await app.auth.logout();
        await app.auth.login(b, 'pw');
      }();
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(app.accounts.activeUserId, isNull, reason: 'B is not active before A\'s sync stopped');
      gate.complete();
      await expectLater(aSync, throwsA(isA<AccountChangedException>()));
      await switching;

      expect(app.accounts.activeUserId, 'user-b');
      expect(await app.clients(), isEmpty, reason: "A's late response must not reach B's store");
      expect(await DatabaseHelper.readMeta(await app.db(), SyncMeta.cursor), isNull);
      await app.auth.logout();
      await app.withFileOf('user-a', (db) async {
        expect(await app.clients(db), isEmpty, reason: 'the response arrived after A was signed out');
        expect(await DatabaseHelper.readMeta(db, SyncMeta.cursor), isNull);
      });
    });

    test('a push answered after the switch is not recorded; A re-sends it with the same change id', () async {
      await app.auth.login(a, 'pw');
      final changeId = await app.queueCreate('a-offline');
      final gate = Completer<void>();
      app.server.pushGate = gate;
      final aSync = app.sync.sync();
      await app.server.requestArrived.future;
      final switching = () async {
        await app.auth.logout();
        await app.auth.login(b, 'pw');
      }();
      await Future<void>.delayed(const Duration(milliseconds: 20));
      gate.complete();
      await expectLater(aSync, throwsA(isA<AccountChangedException>()));
      await switching;

      await app.sync.sync();
      expect(app.server.pushedObjectIds('user-b'), isEmpty);
      expect(await app.unsynced(), isEmpty);

      await app.auth.logout();
      await app.auth.login(a, 'pw');
      expect(await app.unsynced(), ['a-offline'], reason: 'unknown outcome: still queued for A');
      final row = (await (await app.db()).query('pending_changes')).single;
      expect(row['last_result'], sentUnknown);
      await app.sync.sync();
      final sent = [
        for (final body in app.server.pushesBy['user-a']!)
          for (final c in body['changes'] as List) (c as Map)['change_id'],
      ];
      expect(sent, [changeId, changeId], reason: 'the retry is idempotent (same change id)');
      expect(await app.unsynced(), isEmpty);
    });

    test('a sync started while no account is signed in does nothing', () async {
      await expectLater(app.sync.sync(), throwsA(isA<NoActiveAccountException>()));
      expect(app.server.requests, isEmpty);
    });
  });

  group('restart during a transition', () {
    test('a stored token without account details signs out and clears the token', () async {
      const storage = FlutterSecureStorage();
      await storage.write(key: 'access_token', value: fakeJwt('user-b'));
      await storage.write(key: 'refresh_token', value: 'refresh-user-b');
      app.restart();
      expect(await app.auth.isLoggedIn(), isFalse);
      expect(await storage.read(key: 'access_token'), isNull);
      expect(await storage.read(key: 'refresh_token'), isNull);
    });

    test('a local store that cannot be opened for the account signs out instead of keeping the session', () async {
      await app.auth.login(a, 'pw');
      await app.auth.logout();
      await app.withFileOf('user-a', (db) => DatabaseHelper.writeMeta(db, SyncMeta.owner, 'someone-else'));
      await expectLater(app.auth.login(a, 'pw'), throwsStateError);
      expect(app.accounts.activeUserId, isNull);
      expect(await const FlutterSecureStorage().read(key: 'access_token'), isNull);
    });

    test('a start-up session check and a sign-in of another account do not interleave', () async {
      await app.auth.login(a, 'pw');
      app.restart();
      final check = app.auth.isLoggedIn();
      final signIn = app.auth.login(b, 'pw');
      expect(await check, isTrue);
      await signIn;
      expect(app.accounts.activeUserId, 'user-b');
      expect(app.auth.currentUser?.id, 'user-b');
      expect(app.server.sessionUserId, 'user-b');
      expect(ApiClient.tokenSubject(await const FlutterSecureStorage().read(key: 'access_token')), 'user-b');
    });

    test('restart after A signed out: B signs in to an empty store; A\'s file keeps its queue', () async {
      await app.auth.login(a, 'pw');
      await app.queueCreate('a-offline');
      await app.auth.logout();

      app.restart();
      await app.auth.initialize();
      expect(await app.auth.isLoggedIn(), isFalse);
      expect(app.accounts.activeUserId, isNull);
      await app.auth.login(b, 'pw');
      expect(await app.unsynced(), isEmpty);
      await app.auth.logout();
      await app.withFileOf('user-a', (db) async => expect(await app.unsynced(db), ['a-offline']));
    });

    test('restart while signed in resumes the same account with its queue and cursor', () async {
      await app.auth.login(a, 'pw');
      await app.sync.sync();
      await app.queueCreate('a-offline');

      app.restart();
      await app.auth.initialize();
      expect(await app.auth.isLoggedIn(), isTrue);
      expect(app.accounts.activeUserId, 'user-a');
      expect(await app.unsynced(), ['a-offline']);
      await app.sync.sync();
      expect(app.server.pullCursorsBy['user-a'], ['cursor-of-user-a']);
      expect(app.server.pushedObjectIds('user-a'), ['a-offline']);
    });

    test('interrupted sign-in (B\'s token stored with A\'s details) signs out instead of opening either store', () async {
      await app.auth.login(a, 'pw');
      await app.queueCreate('a-offline');
      final aDetails = (await SharedPreferences.getInstance()).getString('user_data');
      await app.auth.logout();

      // B's sign-in stored the tokens, then the app was killed before the
      // account details were replaced.
      const storage = FlutterSecureStorage();
      await storage.write(key: 'access_token', value: fakeJwt('user-b'));
      await storage.write(key: 'refresh_token', value: 'refresh-user-b');
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('user_data', aDetails!);
      await prefs.setString('user_id', 'user-a');

      app.restart();
      await app.auth.initialize();
      expect(await app.auth.isLoggedIn(), isFalse);
      expect(app.accounts.activeUserId, isNull);
      expect(await storage.read(key: 'access_token'), isNull);
      expect(prefs.getString('user_data'), isNull);
      await app.withFileOf('user-a', (db) async => expect(await app.unsynced(db), ['a-offline']));
    });
  });

  test('conflicts, retries, held rows and attachments of A are invisible and unusable for B', () async {
    await app.auth.login(a, 'pw');
    final aDb = await app.db();
    final future = DateTime.now().add(const Duration(days: 1)).toUtc().toIso8601String();
    await aDb.insert('pending_changes', pendingRow('a-failed', 'user-a', 'a-x', status: 'failed', attempts: 1));
    await aDb.insert('pending_changes', pendingRow('a-waiting', 'user-a', 'a-y', attempts: 2, nextAttemptAt: future));
    await aDb.insert('pending_changes', pendingRow('a-conflict', 'user-a', 'a-z', status: 'conflict', conflictId: 'conf-a'));
    await aDb.insert('sync_conflict_checks', {'conflict_id': 'conf-a', 'check_seq': 1});
    await aDb.insert('sync_held_rows',
        {'object_type': 'client', 'object_id': 'a-z', 'revision': 3, 'row_json': '{}', 'held_at': 'x'},);
    await aDb.insert('attachments_local', {
      'id': 'a-att', 'owner_id': 'a-inv', 'owner_type': 'invoice', 'url': 'https://files.example.test/a.pdf',
      'filename': 'a.pdf', 'created_at': 'x', 'updated_at': 'x',
    });
    app.server.conflictStatus['conf-a'] = 'open';
    await app.auth.logout();

    await app.auth.login(b, 'pw');
    expect(await app.sync.listFailed(), isEmpty);
    expect(await app.sync.listWaiting(), isEmpty);
    final status = await app.sync.status();
    expect((status.pending, status.failedOrWaiting, status.openConflicts), (0, 0, 0));
    await app.sync.retry('a-failed');
    await app.sync.discard('a-failed');
    await app.sync.conflictResolved('conf-a', 'apply_client', currentRevision: 9);
    await app.sync.sync();
    final bDb = await app.db();
    expect(await bDb.query('attachments_local'), isEmpty);
    expect(await bDb.query('sync_held_rows'), isEmpty);
    expect(await bDb.query('sync_conflict_checks'), isEmpty);
    expect(app.server.requests.where((r) => r.$1 == 'user-b').map((r) => r.$2), isNot(contains('/sync/conflicts/conf-a')));
    expect(app.server.pushedObjectIds('user-b'), isEmpty);
    await app.auth.logout();

    await app.auth.login(a, 'pw');
    final failed = await app.sync.listFailed();
    expect(failed.map((f) => f.id), ['a-failed']);
    expect((await app.sync.listWaiting()).map((f) => f.id), ['a-waiting']);
    final db = await app.db();
    expect((await db.query('pending_changes', where: "status = 'conflict'")).single['conflict_id'], 'conf-a');
    expect(await db.query('sync_held_rows'), hasLength(1));
    expect(await db.query('attachments_local'), hasLength(1));
    await app.sync.sync();
    expect(app.server.requests, contains(('user-a', '/sync/conflicts/conf-a')));
  });

  group('database of an earlier version (one file for every account)', () {
    Future<void> legacy(Future<void> Function(Database db) fill) async {
      final db = await DatabaseHelper.openAt(databaseFactoryFfi, '${dir.path}/invoiceme.db');
      await fill(db);
      await db.close();
    }

    test('one owner: it becomes that account\'s store, whoever signs in first; the old cursor is dropped', () async {
      await legacy((db) async {
        await db.insert('pending_changes', pendingRow('legacy-1', 'user-a', 'a-legacy'));
        await db.insert('clients_local', clientRow('a-client-1', 'user-a'));
      });
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('sync_cursor', 'cursor-of-someone');
      await prefs.setString('dashboard_stats_cache', '{"stats":{}}');

      await app.accounts.migrateLegacy();
      expect(File('${dir.path}/invoiceme.db').existsSync(), isFalse);
      expect(prefs.getString('sync_cursor'), isNull);
      expect(prefs.getString('dashboard_stats_cache'), isNull);
      expect(await app.accounts.quarantinedStores(), isEmpty);

      await app.auth.login(b, 'pw');
      expect(await app.unsynced(), isEmpty);
      expect(await app.clients(), isEmpty);
      await app.auth.logout();

      await app.auth.login(a, 'pw');
      expect(await app.unsynced(), ['a-legacy']);
      expect(await app.clients(), ['a-client-1']);
      await app.sync.sync();
      expect(app.server.pullCursorsBy['user-a'], [null], reason: 'full pull, never the device-wide cursor');
      expect(app.server.pushedObjectIds('user-a'), ['a-legacy']);
    });

    test('several owners: quarantined; each account recovers only the changes recorded for it', () async {
      await legacy((db) async {
        await db.insert('pending_changes', pendingRow('legacy-a', 'user-a', 'a-legacy'));
        await db.insert('pending_changes', pendingRow('legacy-b', 'user-b', 'b-legacy', status: 'conflict', conflictId: 'c-under-a'));
        await db.insert('clients_local', clientRow('a-client-1', 'user-a'));
        await db.insert('clients_local', clientRow('b-client-1', 'user-b'));
      });
      await app.accounts.migrateLegacy();
      expect(File('${dir.path}/invoiceme.db').existsSync(), isFalse);

      await app.auth.login(a, 'pw');
      expect(await app.unsynced(), isEmpty, reason: 'never assigned to whoever signs in');
      expect(await app.clients(), isEmpty);
      var stores = await app.accounts.quarantinedStores();
      expect(stores.single.unsyncedChanges, 2);
      expect(stores.single.unsyncedForActiveAccount, 1);
      expect(await app.accounts.recoverFromQuarantine(stores.single.path), 1);
      expect(await app.unsynced(), ['a-legacy']);
      await app.sync.sync();
      expect(app.server.pushedObjectIds('user-a'), ['a-legacy']);
      await app.auth.logout();

      await app.auth.login(b, 'pw');
      expect(await app.unsynced(), isEmpty);
      stores = await app.accounts.quarantinedStores();
      expect((stores.single.unsyncedChanges, stores.single.unsyncedForActiveAccount), (1, 1));
      expect(await app.accounts.recoverFromQuarantine(stores.single.path), 1);
      final row = (await (await app.db()).query('pending_changes')).single;
      expect((row['object_id'], row['status'], row['conflict_id']), ('b-legacy', 'pending', null),
          reason: 'a conflict of the shared store is sent again by its own account',);
      expect(await app.accounts.quarantinedStores(), isEmpty, reason: 'nothing unsynced left in it');
      await app.sync.sync();
      expect(app.server.pushedObjectIds('user-b'), ['b-legacy']);
      expect(app.server.pushedObjectIds('user-a'), ['a-legacy']);
    });

    test('a change without an account: quarantined; removal only with confirmation', () async {
      await legacy((db) async => db.insert('pending_changes', pendingRow('legacy-x', '', 'x-legacy')));
      await app.accounts.migrateLegacy();
      await app.auth.login(a, 'pw');
      final store = (await app.accounts.quarantinedStores()).single;
      expect((store.unsyncedChanges, store.unsyncedForActiveAccount), (1, 0));
      expect(await app.accounts.recoverFromQuarantine(store.path), 0);
      await expectLater(app.accounts.deleteQuarantined(store.path, confirmed: false), throwsStateError);
      expect(File(store.path).existsSync(), isTrue);
      await app.accounts.deleteQuarantined(store.path, confirmed: true);
      expect(await app.accounts.quarantinedStores(), isEmpty);
    });

    test('an unreadable one is moved to quarantine unread; the app still starts and signs in', () async {
      await File('${dir.path}/invoiceme.db').writeAsString('not a database');
      await app.accounts.migrateLegacy();
      expect(File('${dir.path}/invoiceme.db').existsSync(), isFalse);
      await app.auth.login(a, 'pw');
      expect(await app.unsynced(), isEmpty);
      final store = (await app.accounts.quarantinedStores()).single;
      expect(await File(store.path).readAsString(), 'not a database');
      expect((store.readable, store.unsyncedChanges), (false, null), reason: 'unknown, not "0 unsynced"');
    });

    test('rows without their own user id that do not belong to the owner\'s records: quarantined', () async {
      await legacy((db) async {
        await db.insert('pending_changes', pendingRow('legacy-a', 'user-a', 'a-legacy'));
        await db.insert('invoice_items_local', {
          'id': 'item-1', 'invoice_id': 'invoice-of-unknown', 'description': 'd', 'quantity': 1, 'unit_price': 1,
          'tax_rate': 0, 'discount_rate': 0, 'line_total': 1, 'created_at': 'x',
        });
      });
      await app.accounts.migrateLegacy();
      await app.auth.login(a, 'pw');
      expect(await app.unsynced(), isEmpty);
      expect((await app.accounts.quarantinedStores()).single.unsyncedForActiveAccount, 1);
    });

    test('a signed-in account cannot remove a quarantined store holding another account\'s changes', () async {
      await legacy((db) async {
        await db.insert('pending_changes', pendingRow('legacy-a', 'user-a', 'a-legacy'));
        await db.insert('pending_changes', pendingRow('legacy-b', 'user-b', 'b-legacy'));
      });
      await app.accounts.migrateLegacy();
      await app.auth.login(a, 'pw');
      final store = (await app.accounts.quarantinedStores()).single;
      expect((store.unsyncedForOtherAccounts, store.removable), (1, false));
      await expectLater(app.accounts.deleteQuarantined(store.path, confirmed: true),
          throwsA(isA<UnsyncedChangesException>()));
      expect(File(store.path).existsSync(), isTrue);
      await app.auth.logout();
      await app.auth.login(b, 'pw');
      expect(await app.accounts.recoverFromQuarantine(store.path), 1);
    });

        test('an empty one is removed', () async {
      await legacy((db) async {});
      await app.accounts.migrateLegacy();
      expect(File('${dir.path}/invoiceme.db').existsSync(), isFalse);
      expect(await app.accounts.quarantinedStores(), isEmpty);
    });
  });

  test('removing local data needs confirmation when changes are unsynced', () async {
    await app.auth.login(a, 'pw');
    await app.queueCreate('a-offline');
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('dashboard_stats_cache', jsonEncode({'user_id': 'user-a', 'stats': {}}));

    await expectLater(app.auth.logoutAndRemoveLocalData(confirmUnsyncedLoss: false),
        throwsA(isA<UnsyncedChangesException>().having((e) => e.count, 'count', 1)),);
    expect(app.accounts.activeUserId, isNull, reason: 'signed out, data kept');
    expect(prefs.getString('dashboard_stats_cache'), isNull, reason: 'account display cache removed on sign-out');
    await app.auth.login(a, 'pw');
    expect(await app.unsynced(), ['a-offline']);

    await app.auth.logoutAndRemoveLocalData(confirmUnsyncedLoss: true);
    expect(File(await app.accounts.pathFor('user-a')).existsSync(), isFalse);
    await app.auth.login(a, 'pw');
    expect(await app.unsynced(), isEmpty);
  });

  test('a login whose token belongs to another account is refused and opens nothing', () async {
    final server = _MismatchedLoginServer();
    final auth = AuthService(server, const FlutterSecureStorage(), accounts: app.accounts);
    await expectLater(auth.login(a, 'pw'), throwsException);
    expect(app.accounts.activeUserId, isNull);
    expect(await const FlutterSecureStorage().read(key: 'access_token'), isNull);
  });

  group('ApiClient session binding', () {
    test('a 401 of an ended session leaves the next session\'s token alone', () async {
      final api = ApiClient();
      final adapter = _Adapter();
      api.dio.httpClientAdapter = adapter;
      api.bindSession('user-a');
      await api.setToken(fakeJwt('user-a'));
      await const FlutterSecureStorage().write(key: 'refresh_token', value: 'refresh-user-a');

      final gate = Completer<void>();
      final arrived = Completer<void>();
      adapter.handler = (options) async {
        if (options.path.endsWith('/slow')) {
          arrived.complete();
          await gate.future;
          return _json(401, {});
        }
        return _json(200, {});
      };
      // Own cancel token: the request is not cancelled by the session end, so
      // its 401 arrives in the next session.
      final slow = api.dio.get('/slow', cancelToken: CancelToken());
      await arrived.future;
      await api.endSession();
      api.bindSession('user-b');
      await api.setToken(fakeJwt('user-b'));
      await const FlutterSecureStorage().write(key: 'refresh_token', value: 'refresh-user-b');
      gate.complete();
      await expectLater(slow, throwsA(isA<DioException>()));

      expect(adapter.paths, isNot(contains(endsWith('/auth/refresh'))));
      expect(await const FlutterSecureStorage().read(key: 'access_token'), fakeJwt('user-b'));
      expect(await const FlutterSecureStorage().read(key: 'refresh_token'), 'refresh-user-b');
    });

    test('a request made right after sign-out starts carries no token', () async {
      final api = ApiClient();
      final adapter = _Adapter();
      api.dio.httpClientAdapter = adapter;
      final seen = <Object?>[];
      adapter.handler = (options) async {
        seen.add(options.headers['Authorization']);
        return _json(200, {});
      };
      api.bindSession('user-a');
      await api.setToken(fakeJwt('user-a'));
      final ending = api.endSession(); // not awaited: the storage delete is still running
      await api.post('/sync/push', data: {});
      await ending;
      expect(seen, [null]);
    });

    test('no refresh is accepted without a bound account', () async {
      final api = ApiClient();
      final adapter = _Adapter()
        ..handler = (options) async {
          if (options.path.endsWith('/auth/refresh')) {
            return _json(200, {'accessToken': '${fakeJwt('user-a')}2', 'refreshToken': 'r2'});
          }
          // The retry with the refreshed token would succeed.
          return options.headers['Authorization'] == 'Bearer ${fakeJwt('user-a')}2' ? _json(200, {}) : _json(401, {});
        };
      api.dio.httpClientAdapter = adapter;
      await api.setToken(fakeJwt('user-a'));
      await const FlutterSecureStorage().write(key: 'refresh_token', value: 'refresh-user-a');
      await expectLater(api.get('/clients', useCache: false), throwsA(isA<DioException>()));
      expect(await const FlutterSecureStorage().read(key: 'access_token'), isNull);
    });

    test('ending a session cancels its requests in flight', () async {
      final api = ApiClient();
      final adapter = _Adapter()..handler = (_) => Completer<ResponseBody>().future;
      api.dio.httpClientAdapter = adapter;
      final pending = api.get('/sync/pull', useCache: false);
      await Future<void>.delayed(Duration.zero);
      await api.endSession();
      await expectLater(
          pending, throwsA(isA<DioException>().having((e) => e.type, 'type', DioExceptionType.cancel)),);
    });

    test('a refreshed token of another account is rejected and the session expires', () async {
      final api = ApiClient();
      var expired = 0;
      api.onSessionExpired = () => expired++;
      final adapter = _Adapter()
        ..handler = (options) async {
          if (options.path.endsWith('/auth/refresh')) {
            return _json(200, {'accessToken': fakeJwt('user-b'), 'refreshToken': 'refresh-user-b'});
          }
          return _json(401, {});
        };
      api.dio.httpClientAdapter = adapter;
      api.bindSession('user-a');
      await api.setToken(fakeJwt('user-a'));
      await const FlutterSecureStorage().write(key: 'refresh_token', value: 'refresh-user-a');

      await expectLater(api.get('/clients', useCache: false), throwsA(isA<DioException>()));
      await Future<void>.delayed(Duration.zero);
      expect(await const FlutterSecureStorage().read(key: 'access_token'), isNull);
      expect(expired, 1);
    });

    test('a refreshed token of the same account is used and the request retried', () async {
      final api = ApiClient();
      final adapter = _Adapter();
      adapter.handler = (options) async {
        if (options.path.endsWith('/auth/refresh')) {
          return _json(200, {'accessToken': '${fakeJwt('user-a')}2', 'refreshToken': 'refresh-2'});
        }
        final auth = options.headers['Authorization'] as String?;
        return auth == 'Bearer ${fakeJwt('user-a')}2' ? _json(200, {'ok': true}) : _json(401, {});
      };
      api.dio.httpClientAdapter = adapter;
      api.bindSession('user-a');
      await api.setToken(fakeJwt('user-a'));
      await const FlutterSecureStorage().write(key: 'refresh_token', value: 'refresh-user-a');

      final res = await api.get('/clients', useCache: false);
      expect(res.data, {'ok': true});
    });
  });
}

ResponseBody _json(int status, Object body) => ResponseBody.fromString(jsonEncode(body), status,
    headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},);

class _Adapter implements HttpClientAdapter {
  Future<ResponseBody> Function(RequestOptions options) handler = (_) async => _json(200, {});
  final paths = <String>[];

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) {
    paths.add(options.path);
    return handler(options);
  }

  @override
  void close({bool force = false}) {}
}

/// Answers a login for A with a token issued for B.
class _MismatchedLoginServer extends TwoAccountServer {
  @override
  Future<Response> post(String path, {dynamic data}) async {
    if (path == '/auth/login') {
      return ok(path, {
        'accessToken': fakeJwt('user-b'),
        'refreshToken': 'refresh-user-b',
        'user': {'id': 'user-a', 'email': a, 'name': 'Account A'},
      });
    }
    return super.post(path, data: data);
  }
}
