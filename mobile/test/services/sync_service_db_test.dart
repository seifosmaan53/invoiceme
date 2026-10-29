// SyncService against a real SQLite database (sqflite_common_ffi, host
// sqlite3): retry/backoff persistence, rejection, cursor pull, migration.

// Dart imports
import 'dart:io';
import 'dart:math';

// Package imports
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

// Local imports
import 'package:invoiceme/core/database/database_helper.dart';
import 'package:invoiceme/core/services/api_client.dart';
import 'package:invoiceme/core/services/sync_service.dart';

class FixedRandom implements Random {
  final double value;
  FixedRandom(this.value);
  @override
  double nextDouble() => value;
  @override
  bool nextBool() => false;
  @override
  int nextInt(int max) => 0;
}

/// Push answers are taken from [pushReplies] in order (a function may
/// throw); pull pages from [pages] by cursor.
class FakeApi extends ApiClient {
  final pushes = <Map<String, dynamic>>[];
  final pulls = <String?>[];
  final pushReplies = <Object Function(Map<String, dynamic> body)>[];
  Map<String?, Map<String, dynamic>> pages = {null: emptyPage('c-1')};
  Object? Function(String? cursor)? pullError;

  static Map<String, dynamic> emptyPage(String cursor, {bool hasMore = false, List<Map<String, dynamic>> clients = const []}) => {
        'protocol': 2,
        'clients': clients,
        'invoices': [],
        'invoiceItems': [],
        'attachments': [],
        'tombstones': [],
        'fullResyncRequired': false,
        'openConflicts': 0,
        'lastSyncTimestamp': '2026-10-28T12:00:00.000Z',
        'cursor': cursor,
        'hasMore': hasMore,
      };

  @override
  Future<Response> post(String path, {dynamic data}) async {
    final body = Map<String, dynamic>.from(data as Map);
    pushes.add(body);
    final reply = pushReplies.removeAt(0)(body);
    return Response(requestOptions: RequestOptions(path: path), data: reply, statusCode: 200);
  }

  @override
  Future<Response> get(String path, {Map<String, dynamic>? queryParameters, bool useCache = true}) async {
    final cursor = queryParameters?['cursor'] as String?;
    pulls.add(cursor);
    final error = pullError?.call(cursor);
    if (error != null) throw error;
    return Response(requestOptions: RequestOptions(path: path), data: pages[cursor] ?? emptyPage(cursor ?? 'c-1'), statusCode: 200);
  }
}

Map<String, dynamic> resultFor(Map<String, dynamic> body, String status, {String? reason, int? revision}) => {
      'protocol': 2,
      'results': [
        for (final (i, c) in (body['changes'] as List).indexed)
          {
            'index': i,
            'change_id': (c as Map)['change_id'],
            'status': status,
            if (reason != null) 'reason': reason,
            if (revision != null) 'revision': revision,
          },
      ],
    };

DioException httpError(int status) => DioException(
      requestOptions: RequestOptions(path: '/sync/push'),
      response: Response(requestOptions: RequestOptions(path: '/sync/push'), statusCode: status, data: {}),
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  sqfliteFfiInit();
  late Directory dir;
  late String path;
  late DateTime now;
  late FakeApi api;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    dir = await Directory.systemTemp.createTemp('invoiceme-sync-');
    path = '${dir.path}/invoiceme.db';
    now = DateTime.utc(2026, 10, 28, 12);
    api = FakeApi();
  });

  tearDown(() async {
    await dir.delete(recursive: true);
  });

  Future<(SyncService, Database)> open() async {
    final db = await DatabaseHelper.openAt(databaseFactoryFfi, path);
    final service = SyncService(api, null,
        deviceId: 'device-1', clock: () => now, random: FixedRandom(0.5), database: () async => db);
    return (service, db);
  }

  Future<Map<String, Object?>> rowOf(Database db, String id) async =>
      (await db.query('pending_changes', where: 'id = ?', whereArgs: [id])).single;

  test('temporary failures back off (growing, capped), success clears the state', () async {
    final (service, db) = await open();
    await db.insert('clients_local', {
      'id': 'c1', 'user_id': 'u', 'name': 'Acme', 'created_at': 'x', 'updated_at': 'x', 'revision': 3,
    });
    final id = (await service.queueChange(
      objectType: ChangeObjectType.client,
      objectId: 'c1',
      changeType: ChangeType.update,
      data: {'name': 'Acme 2'},
    ))!;
    expect((await rowOf(db, id))['base_revision'], 3);

    final delays = <Duration>[];
    for (var i = 1; i <= 10; i++) {
      api.pushReplies.add((b) => resultFor(b, 'failed', reason: 'retry_later'));
      final report = await service.sync();
      expect(report.failed, 1);
      final row = await rowOf(db, id);
      expect((row['status'], row['attempts'], row['last_reason']), ('pending', i, 'retry_later'));
      final next = DateTime.parse(row['next_attempt_at'] as String);
      delays.add(next.difference(now));
      // Before the next attempt nothing is sent.
      final pushesBefore = api.pushes.length;
      await service.sync();
      expect(api.pushes.length, pushesBefore);
      now = next.add(const Duration(seconds: 1));
    }
    for (var i = 1; i < delays.length; i++) {
      expect(delays[i] >= delays[i - 1], isTrue);
    }
    expect(delays.first, const Duration(milliseconds: 26250)); // 30 s * 0.875
    expect(delays.last, const Duration(milliseconds: 3150000)); // capped: 1 h * 0.875

    api.pushReplies.add((b) => resultFor(b, 'applied', revision: 4));
    final report = await service.sync();
    expect(report.synced, 1);
    final row = await rowOf(db, id);
    expect((row['synced'], row['attempts'], row['next_attempt_at']), (1, 0, null));
    expect((await db.query('clients_local')).single['revision'], 4);
    expect(api.pushes.last['changes'][0]['change_id'], id, reason: 'retry_later: not applied, same change_id');
    await db.close();
  });

  test('backoff state survives an app restart (new SyncService over the same database)', () async {
    var (service, db) = await open();
    final id = (await service.queueChange(
      objectType: ChangeObjectType.client,
      objectId: 'c9',
      changeType: ChangeType.create,
      data: {'name': 'New'},
    ))!;
    api.pushReplies.add((_) => throw httpError(503));
    await service.sync(); // 5xx: temporary; the pull still runs
    expect(api.pulls, [null]);
    var row = await rowOf(db, id);
    expect((row['status'], row['attempts'], row['last_reason']), ('pending', 1, 'server_error'));
    await db.close();

    // "Restart": new database handle and service.
    now = now.add(const Duration(seconds: 5));
    (service, db) = await open();
    final pushes = api.pushes.length;
    await service.sync();
    expect(api.pushes.length, pushes, reason: 'still waiting after restart');
    expect((await service.listWaiting()).single.attempts, 1);

    now = now.add(const Duration(minutes: 1));
    api.pushReplies.add((b) => resultFor(b, 'applied', revision: 1));
    await service.sync();
    row = await rowOf(db, id);
    expect(row['synced'], 1);
    await db.close();
  });

  test('network error is temporary; Retry now sends at once', () async {
    final (service, db) = await open();
    final id = (await service.queueChange(
      objectType: ChangeObjectType.client,
      objectId: 'c2',
      changeType: ChangeType.create,
      data: {'name': 'X'},
    ))!;
    api.pushReplies.add((_) => throw DioException(requestOptions: RequestOptions(path: '/sync/push')));
    await service.sync();
    expect((await rowOf(db, id))['last_reason'], 'network_error');
    expect((await service.listWaiting()).single.id, id);

    api.pushReplies.add((b) => resultFor(b, 'applied', revision: 1));
    await service.retryNow(id); // clock unchanged: would still be waiting
    expect((await rowOf(db, id))['synced'], 1);
    expect(await service.listWaiting(), isEmpty);
    await db.close();
  });

  test('a failed result without reason (older server) is temporary; rejected is permanent', () async {
    final (service, db) = await open();
    final a = (await service.queueChange(
        objectType: ChangeObjectType.client, objectId: 'ca', changeType: ChangeType.create, data: {'name': 'A'}))!;
    api.pushReplies.add((b) => resultFor(b, 'failed'));
    await service.sync();
    expect(((await rowOf(db, a))['status'], (await rowOf(db, a))['attempts']), ('pending', 1));

    now = now.add(const Duration(hours: 2));
    api.pushReplies.add((b) => resultFor(b, 'failed', reason: 'rejected'));
    await service.sync();
    final row = await rowOf(db, a);
    expect((row['status'], row['last_reason'], row['next_attempt_at']), ('failed', 'rejected', null));
    expect((await service.listFailed()).single.id, a);
    expect(await service.listWaiting(), isEmpty);

    await service.retry(a);
    expect(((await rowOf(db, a))['status'], (await rowOf(db, a))['attempts']), ('pending', 0));
    await db.close();
  });

  test('conflict is stored and never resent', () async {
    final (service, db) = await open();
    final id = (await service.queueChange(
        objectType: ChangeObjectType.client, objectId: 'cc', changeType: ChangeType.create, data: {'name': 'C'}))!;
    api.pushReplies.add((b) => {
          'results': [
            {'index': 0, 'change_id': (b['changes'] as List)[0]['change_id'], 'status': 'conflict', 'conflict_id': 'k1'},
          ],
        });
    await service.sync();
    final row = await rowOf(db, id);
    expect((row['status'], row['conflict_id']), ('conflict', 'k1'));
    final pushes = api.pushes.length;
    await service.sync();
    expect(api.pushes.length, pushes);
    await db.close();
  });

  test('cursor pull: pages applied, cursor stored only after the last page; restart from the stored cursor', () async {
    final (service, db) = await open();
    final client = {'id': 'k1', 'userId': 'u', 'name': 'Paged', 'createdAt': '2026-10-01T00:00:00Z', 'updatedAt': '2026-10-01T00:00:00Z', 'revision': 2};
    api.pages = {
      null: FakeApi.emptyPage('p1', hasMore: true, clients: [client]),
      'p1': FakeApi.emptyPage('p2'),
    };
    await service.sync();
    expect(api.pulls, [null, 'p1']);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString(syncCursorKey), 'p2');
    expect((await db.query('clients_local')).single['revision'], 2);

    // Interrupted on the second page: the stored cursor stays p2.
    api.pulls.clear();
    api.pages = {'p2': FakeApi.emptyPage('p3', hasMore: true), 'p3': FakeApi.emptyPage('p4')};
    api.pullError = (c) => c == 'p3' ? DioException(requestOptions: RequestOptions(path: '/sync/pull')) : null;
    await expectLater(service.sync(), throwsA(isA<DioException>()));
    expect(prefs.getString(syncCursorKey), 'p2');

    // Next sync restarts from p2 (re-delivered pages are fine).
    api.pullError = null;
    api.pulls.clear();
    await service.sync();
    expect(api.pulls, ['p2', 'p3']);
    expect(prefs.getString(syncCursorKey), 'p4');
    await db.close();
  });

  test('fullResyncRequired clears cached tables (not the queue) and drops the cursor', () async {
    final (service, db) = await open();
    SharedPreferences.setMockInitialValues({syncCursorKey: 'old'});
    await db.insert('clients_local', {'id': 'stale', 'user_id': 'u', 'name': 'S', 'created_at': 'x', 'updated_at': 'x'});
    final queued = (await service.queueChange(
        objectType: ChangeObjectType.client, objectId: 'q1', changeType: ChangeType.create, data: {'name': 'Q'}))!;
    api.pushReplies.add((b) => resultFor(b, 'failed', reason: 'retry_later'));
    api.pages = {'old': {...FakeApi.emptyPage('x'), 'fullResyncRequired': true}, null: FakeApi.emptyPage('fresh')};
    await service.sync();
    expect(api.pulls, ['old', null]);
    expect(await db.query('clients_local'), isEmpty);
    expect((await rowOf(db, queued))['status'], 'pending');
    expect((await SharedPreferences.getInstance()).getString(syncCursorKey), 'fresh');
    await db.close();
  });

  test('invalid_cursor (400) drops the cursor and pulls from the start', () async {
    final (service, db) = await open();
    SharedPreferences.setMockInitialValues({syncCursorKey: 'bad'});
    api.pages = {null: FakeApi.emptyPage('good')};
    api.pullError = (c) => c == 'bad'
        ? DioException(
            requestOptions: RequestOptions(path: '/sync/pull'),
            response: Response(
                requestOptions: RequestOptions(path: '/sync/pull'), statusCode: 400, data: {'reason': 'invalid_cursor'}),
          )
        : null;
    await service.sync();
    expect(api.pulls, ['bad', null]);
    expect((await SharedPreferences.getInstance()).getString(syncCursorKey), 'good');
    await db.close();
  });

  test('migration: a version-2 database opens at the current version with its queue intact', () async {
    final v2 = await databaseFactoryFfi.openDatabase(path,
        options: OpenDatabaseOptions(
          version: 2,
          onCreate: (db, _) async {
            await db.execute('CREATE TABLE clients_local (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, '
                'email TEXT, phone TEXT, address_json TEXT, notes TEXT, tags_json TEXT, avatar_url TEXT, '
                'created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)');
            await db.execute('CREATE TABLE invoices_local (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, client_id TEXT NOT NULL, '
                'type TEXT NOT NULL, number TEXT NOT NULL, status TEXT NOT NULL, issue_date TEXT NOT NULL, due_date TEXT, '
                'currency TEXT NOT NULL, subtotal REAL NOT NULL, tax_total REAL NOT NULL, discount_total REAL NOT NULL, '
                'total REAL NOT NULL, notes TEXT, metadata_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)');
            await db.execute('CREATE TABLE invoice_items_local (id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL, '
                'description TEXT NOT NULL, quantity REAL NOT NULL, unit_price REAL NOT NULL, tax_rate REAL NOT NULL, '
                'discount_rate REAL NOT NULL, line_total REAL NOT NULL, created_at TEXT NOT NULL)');
            await db.execute('CREATE TABLE attachments_local (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, owner_type TEXT NOT NULL, '
                'url TEXT NOT NULL, filename TEXT NOT NULL, content_type TEXT, size_bytes INTEGER, created_at TEXT NOT NULL, '
                'updated_at TEXT NOT NULL)');
            await db.execute('CREATE TABLE pending_changes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, device_id TEXT NOT NULL, '
                'object_type TEXT NOT NULL, object_id TEXT NOT NULL, change_type TEXT NOT NULL, change_json TEXT NOT NULL, '
                'synced INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)');
          },
        ));
    await v2.insert('pending_changes', {
      'id': 'old-1', 'user_id': 'u', 'device_id': 'd', 'object_type': 'client', 'object_id': 'c1',
      'change_type': 'create', 'change_json': '{"name":"Old"}', 'synced': 0, 'created_at': '2026-01-01T00:00:00Z',
    });
    await v2.close();

    final db = await DatabaseHelper.openAt(databaseFactoryFfi, path);
    expect(await db.getVersion(), DatabaseHelper.schemaVersion);
    final columns = (await db.rawQuery('PRAGMA table_info(pending_changes)')).map((c) => c['name']).toSet();
    expect(columns, containsAll(['base_revision', 'status', 'conflict_id', 'last_reason', 'attempts', 'parent_id',
        'parent_base_revision', 'last_result', 'next_attempt_at']));
    for (final t in ['clients_local', 'invoices_local', 'invoice_items_local']) {
      expect((await db.rawQuery('PRAGMA table_info($t)')).map((c) => c['name']), contains('revision'));
    }
    final row = (await db.query('pending_changes')).single;
    expect((row['id'], row['status'], row['attempts']), ('old-1', 'pending', 0));
    await db.close();
  });
}
