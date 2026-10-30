// Dart imports
import 'dart:convert';
import 'dart:math' show Random;

// Package imports
import 'package:dio/dio.dart' show DioException;
import 'package:flutter/foundation.dart' show debugPrint;
import 'package:sqflite/sqflite.dart';
import 'package:uuid/uuid.dart';

// Local imports - Core
import '../database/database_helper.dart';
import '../database/local_accounts.dart';
import '../services/api_client.dart';
import 'sync_protocol.dart';

// Local imports - Models
import '../../models/attachment.dart';
import '../../models/client.dart';
import '../../models/invoice.dart';
import '../../models/invoice_item.dart';

export 'sync_protocol.dart';
export '../database/local_accounts.dart' show AccountChangedException, NoActiveAccountException;

enum ChangeType { create, update, delete }

enum ChangeObjectType { client, invoice, invoice_item, attachment }

/// What the settings screen shows about the signed-in account's sync.
class SyncStatus {
  final DateTime? lastSync;
  final int openConflicts;
  final SyncState state;
  final int pending;

  /// Rejected changes plus changes waiting to retry.
  final int failedOrWaiting;

  const SyncStatus({
    this.lastSync,
    this.openConflicts = 0,
    this.state = SyncState.ok,
    this.pending = 0,
    this.failedOrWaiting = 0,
  });
}


/// Change object format (protocol 2):
/// {change_id, base_revision?, object_type, object_id, change_type, data, device_id, updated_at}
class ChangeObject {
  /// Idempotency key: the local pending_changes row id.
  final String? changeId;

  /// Revision of the record this change was based on; update and delete only.
  final int? baseRevision;
  final ChangeObjectType objectType;
  final String objectId;
  final ChangeType changeType;
  final Map<String, dynamic> data;
  final String deviceId;
  final String updatedAt;

  ChangeObject({
    this.changeId,
    this.baseRevision,
    required this.objectType,
    required this.objectId,
    required this.changeType,
    required this.data,
    required this.deviceId,
    required this.updatedAt,
  });

  Map<String, dynamic> toJson() {
    return {
      if (changeId != null) 'change_id': changeId,
      if (changeType != ChangeType.create && baseRevision != null) 'base_revision': baseRevision,
      'object_type': objectType.name,
      'object_id': objectId,
      'change_type': changeType.name,
      'data': data,
      'device_id': deviceId,
      'updated_at': updatedAt,
    };
  }
}

/// Ids of the pending changes the server acknowledged (applied, merged or
/// duplicate) in a push [result]. A response without per-change `results`
/// acknowledges nothing: the changes stay pending.
List<String> acknowledgedChangeIds(List<Map<String, Object?>> pendingChanges, Map<String, dynamic> result) {
  return planPushResults(pendingChanges, result)
      .actions
      .where((a) => a.kind == PushActionKind.synced)
      .map((a) => a.changeId)
      .toList();
}

/// Outcome of one [SyncService.sync].
class SyncReport {
  final SyncState state;
  final int synced;
  final int conflicts;
  final int failed;
  final int openConflicts;

  /// Server message (for example with `client_upgrade_required`).
  final String? message;

  const SyncReport({
    this.state = SyncState.ok,
    this.synced = 0,
    this.conflicts = 0,
    this.failed = 0,
    this.openConflicts = 0,
    this.message,
  });

  /// What to show the user when the sync could not complete normally.
  String? get userMessage => syncStateMessage(state);
}

class _PushOutcome {
  final SyncState state;
  final int synced;
  final int conflicts;
  final int failed;
  final String? message;

  const _PushOutcome(this.state, this.synced, this.conflicts, this.failed, this.message);
}

/// Sync protocol 2 client (docs/SYNC-CONTRACT.md).
///
/// Works on the signed-in account's database ([LocalAccounts]). A sync is
/// bound to the account it started for: once the account changes it stops
/// before its next request or write ([AccountChangedException]), and sign-out
/// waits for it to stop.
class SyncService implements FailedChangesStore {
  final ApiClient _apiClient;
  // ignore: unused_field
  final DatabaseHelper? _dbHelper;
  final String _deviceId;
  final DateTime Function() _clock;
  final Random _random;
  final Future<Database> Function() _db;
  final LocalAccounts? _accounts;
  Future<SyncReport>? _running;

  /// How long a sign-out waits for a running sync to stop.
  static const Duration stopTimeout = Duration(seconds: 15);

  /// Push rounds per sync. A record with several queued changes sends one per
  /// round, so each is based on the revision the previous one produced.
  static const int maxPushRounds = 10;

  /// [clock], [random] and [database] are for tests (defaults: system clock,
  /// a random jitter, the signed-in account's database). A test [database]
  /// without [accounts] is used as is, without account checks.
  SyncService(
    this._apiClient,
    this._dbHelper, {
    String? deviceId,
    DateTime Function()? clock,
    Random? random,
    Future<Database> Function()? database,
    LocalAccounts? accounts,
  })  : _deviceId = deviceId ?? const Uuid().v4(),
        _clock = clock ?? DateTime.now,
        _random = random ?? Random(),
        _accounts = accounts ?? (database == null ? LocalAccounts.instance : null),
        _db = database ?? (accounts ?? LocalAccounts.instance).database {
    _accounts?.addTransitionHook(stop);
  }

  /// Waits (bounded by [stopTimeout]) for a running sync to stop; called on
  /// every account transition after the previous account was invalidated.
  Future<void> stop() async {
    final running = _running;
    if (running == null) return;
    try {
      await running.timeout(stopTimeout);
    } catch (_) {
      // Stopped with an error (expected: the account changed) or timed out;
      // a timed-out sync can still not write or send (see _check).
    }
  }

  /// Throws [AccountChangedException] when the account this sync started for
  /// ([generation]) is no longer the signed-in one.
  void _check(int? generation) {
    final accounts = _accounts;
    if (accounts != null && generation != null && !accounts.isCurrent(generation)) {
      throw const AccountChangedException();
    }
  }

  /// Push pending changes, then pull server updates. A sync that is already
  /// running is joined, not started twice.
  ///
  /// When the server does not speak protocol 2, nothing is pushed or pulled,
  /// the queue is kept and the report's state is [SyncState.serverUpdateRequired].
  Future<SyncReport> sync() {
    final running = _running;
    if (running != null) return running;
    final started = _sync();
    _running = started;
    started.then((_) {}, onError: (_) {}).whenComplete(() {
      if (identical(_running, started)) _running = null;
    });
    return started;
  }

  Future<SyncReport> _sync() async {
    final generation = _accounts?.generation;
    final db = await _db();
    _check(generation);
    try {
      final push = await _pushChanges(db, generation);
      if (push.state == SyncState.serverUpdateRequired) {
        _check(generation);
        await DatabaseHelper.writeMeta(db, SyncMeta.state, push.state.name);
        return SyncReport(state: push.state, message: push.message);
      }
      final openConflicts = await _pullChanges(db, generation);
      _check(generation);
      await DatabaseHelper.writeMeta(db, SyncMeta.state, push.state.name);
      return SyncReport(
        state: push.state,
        synced: push.synced,
        conflicts: push.conflicts,
        failed: push.failed,
        openConflicts: openConflicts,
        message: push.message,
      );
    } catch (e) {
      debugPrint('Sync error: $e');
      rethrow;
    }
  }

  Future<List<Map<String, Object?>>> _pendingRows(Database db) => db.query(
        'pending_changes',
        where: 'synced = ? AND status = ?',
        whereArgs: [0, pendingStatus],
        orderBy: 'created_at ASC',
      );

  /// Push the queue, at most one change per record per round. Rows waiting
  /// for their next attempt are left for a later sync.
  Future<_PushOutcome> _pushChanges(Database db, int? generation) async {
    var state = SyncState.ok;
    var synced = 0, conflicts = 0, failed = 0;
    String? message;

    for (var round = 0; round < maxPushRounds; round++) {
      final pending = await _pendingRows(db);
      final batch = selectPushBatch(pending, now: _clock());
      if (batch.isEmpty) break;

      _check(generation);
      // Until a result arrives, the server may or may not have applied them.
      for (final row in batch) {
        await db.update('pending_changes', {'last_result': sentUnknown}, where: 'id = ?', whereArgs: [row['id']]);
      }

      PushPlan plan;
      try {
        final res = await _apiClient.post('/sync/push', data: buildPushBody(_deviceId, batch));
        // A response that arrives after the account changed is not applied.
        _check(generation);
        plan = planPushResults(batch, res.data as Map<String, dynamic>);
      } on DioException catch (e) {
        _check(generation);
        final code = e.response?.statusCode;
        // A server without protocol 2 rejects the `protocol` field (400) and
        // applies nothing. Do not fall back to protocol 1: keep the queue.
        if (code == 400) {
          debugPrint('Sync push: server rejected protocol 2 (400): ${e.response?.data}');
          return const _PushOutcome(SyncState.serverUpdateRequired, 0, 0, 0, null);
        }
        if (code == 401 || code == 403) rethrow;
        // Network error, timeout or 5xx: temporary for every sent change.
        final reason = code != null && code >= 500 ? serverErrorReason : networkErrorReason;
        debugPrint('Sync push: temporary failure ($reason, HTTP $code)');
        final failurePlan = transportFailure(batch, reason);
        await _applyPushPlan(db, batch, failurePlan);
        failed += batch.length;
        break;
      }

      if (plan.resultsMissing) {
        debugPrint('Sync push: response without per-change results; nothing marked');
        return _PushOutcome(SyncState.serverUpdateRequired, synced, conflicts, failed, plan.message);
      }
      if (plan.state == SyncState.appUpdateRequired) state = SyncState.appUpdateRequired;
      message ??= plan.message;

      await _applyPushPlan(db, batch, plan);
      synced += plan.count(PushActionKind.synced);
      conflicts += plan.count(PushActionKind.conflict);
      failed += plan.count(PushActionKind.keepPending) + plan.count(PushActionKind.giveUp);
      debugPrint('Sync push round $round: ${plan.count(PushActionKind.synced)} synced, '
          '${plan.count(PushActionKind.conflict)} conflicts, ${plan.count(PushActionKind.keepPending)} retry later, '
          '${plan.count(PushActionKind.giveUp)} rejected');

      // Stop when this round settled nothing (the rest is waiting or failing).
      if (plan.count(PushActionKind.synced) + plan.count(PushActionKind.conflict) + plan.count(PushActionKind.giveUp) == 0) {
        break;
      }
    }
    return _PushOutcome(state, synced, conflicts, failed, message);
  }

  /// Stores the round's results, then rebases queued rows. Returns renamed
  /// rows (old change_id -> new change_id).
  Future<Map<String, String>> _applyPushPlan(
    Database db,
    List<Map<String, Object?>> batch,
    PushPlan plan,
  ) async {
    final settled = <(PushAction, Map<String, Object?>)>[];
    for (var i = 0; i < plan.actions.length; i++) {
      final action = plan.actions[i];
      switch (action.kind) {
        case PushActionKind.synced:
          await db.update(
            'pending_changes',
            {'synced': 1, 'last_reason': null, 'last_result': null, 'attempts': 0, 'next_attempt_at': null},
            where: 'id = ?',
            whereArgs: [action.changeId],
          );
          final table = localTableFor[action.objectType];
          if (action.revision != null && table != null && versionedObjectTypes.contains(action.objectType)) {
            await db.update(table, {'revision': action.revision}, where: 'id = ?', whereArgs: [action.objectId]);
          }
          settled.add((action, batch[i]));
          if (batch[i]['change_type'] == 'delete') {
            // The device deleted the record: nothing held may bring it back.
            await _dropHeld(db, [(action.objectType, action.objectId)], withChildren: true);
          }
          break;
        case PushActionKind.conflict:
          await db.update(
            'pending_changes',
            {
              'status': conflictStatus,
              'conflict_id': action.conflictId,
              'last_reason': action.reason,
              'last_result': null,
              'next_attempt_at': null,
            },
            where: 'id = ?',
            whereArgs: [action.changeId],
          );
          break;
        case PushActionKind.keepPending:
          await db.update(
            'pending_changes',
            {
              'last_reason': action.reason,
              'attempts': action.attempts,
              'next_attempt_at': nextAttemptAt(_clock(), action.attempts, _random.nextDouble()).toIso8601String(),
              // A failed result means not applied; no result leaves it unknown.
              'last_result': action.status == 'failed' ? sentFailed : sentUnknown,
            },
            where: 'id = ?',
            whereArgs: [action.changeId],
          );
          break;
        case PushActionKind.giveUp:
          await db.update(
            'pending_changes',
            {
              'status': failedStatus,
              'last_reason': action.reason,
              'attempts': action.attempts,
              'last_result': sentFailed,
              'next_attempt_at': null,
            },
            where: 'id = ?',
            whereArgs: [action.changeId],
          );
          break;
      }
    }
    await _applyHeldRows(db);

    final renamed = <String, String>{};
    if (settled.isEmpty) return renamed;
    for (final update in planRebases(settled, await _pendingRows(db))) {
      final values = <String, Object?>{...update.values};
      if (update.newChangeId) {
        final newId = const Uuid().v4();
        values['id'] = newId;
        values['last_result'] = null;
        renamed[update.rowId] = newId;
      }
      await db.update('pending_changes', values, where: 'id = ?', whereArgs: [update.rowId]);
    }
    return renamed;
  }

  /// Pull server changes page by page from the stored cursor; returns the
  /// open conflict count. The cursor is stored only after every page was
  /// applied.
  Future<int> _pullChanges(Database db, int? generation) async {
    // No cursor (a new account database, or one moved from an earlier
    // version): full pull.
    final start = startCursor(await DatabaseHelper.readMeta(db, SyncMeta.cursor), fullPullNeeded: false);
    await _forgetResolvedConflicts(db, generation);
    _check(generation);
    await _applyHeldRows(db);

    final result = await runCursorPull(
      storedCursor: start,
      fetch: (cursor) async {
        _check(generation);
        final page = await _pullPage(cursor);
        _check(generation);
        return page;
      },
      applyPage: (page) async {
        _check(generation);
        await _applyPull(db, page);
      },
      clearCache: () async {
        _check(generation);
        debugPrint('Sync pull: full resync required');
        await _clearLocalCache(db);
      },
      dropCursor: () async {
        _check(generation);
        await DatabaseHelper.writeMeta(db, SyncMeta.cursor, null);
      },
    );

    _check(generation);
    await DatabaseHelper.writeMeta(db, SyncMeta.cursor, result.cursor);
    await DatabaseHelper.writeMeta(db, SyncMeta.openConflicts, '${result.openConflicts}');
    await DatabaseHelper.writeMeta(
        db, SyncMeta.lastSync, result.lastSyncTimestamp ?? _clock().toUtc().toIso8601String());
    await _applyHeldRows(db);
    debugPrint('Sync pull: ${result.pages} page(s)');
    return result.openConflicts;
  }

  Future<Map<String, dynamic>> _pullPage(String? cursor) async {
    try {
      final response = await _apiClient.get('/sync/pull', queryParameters: pullQuery(cursor), useCache: false);
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      if (isInvalidCursorResponse(e.response?.statusCode, e.response?.data)) {
        throw const InvalidCursorException();
      }
      rethrow;
    }
  }

  /// Drop the local cache (not the queue). Records with a change still
  /// waiting to be sent are kept: the pull does not overwrite them, so they
  /// would otherwise disappear until the next full resync.
  Future<void> _clearLocalCache(Database db) async {
    // The full pull delivers (and holds again) everything.
    await db.delete('sync_held_rows');
    final keep = pendingObjectKeys(await _pendingRows(db));
    for (final entry in localTableFor.entries) {
      final ids = keep
          .where((key) => key.startsWith('${entry.key}:'))
          .map((key) => key.substring(entry.key.length + 1))
          .toList();
      if (ids.isEmpty) {
        await db.delete(entry.value);
      } else {
        await db.delete(entry.value,
            where: 'id NOT IN (${List.filled(ids.length, '?').join(', ')})', whereArgs: ids);
      }
    }
  }

  Future<void> _applyPull(Database db, Map<String, dynamic> data) async {
    final pending = pendingObjectKeys(await _pendingRows(db));

    Future<void> deliver(String type, String id, int? revision, Map<String, dynamic> row) async {
      if (pending.contains('$type:$id')) {
        // The record has a queued change: keep the server row until it is settled.
        await _hold(db, type, id, revision, row);
      } else {
        await _upsert(db, localTableFor[type]!, row);
        await db.delete('sync_held_rows',
            where: 'object_type = ? AND object_id = ? AND (revision IS NULL OR ? IS NULL OR revision <= ?)',
            whereArgs: [type, id, revision, revision]);
      }
    }

    for (final json in (data['clients'] as List?) ?? const []) {
      final c = Client.fromJson(json);
      await deliver('client', c.id, c.revision, c.toDatabaseMap());
    }
    for (final json in (data['invoices'] as List?) ?? const []) {
      final inv = Invoice.fromJson(json);
      await deliver('invoice', inv.id, inv.revision, inv.toDatabaseMap());
    }
    for (final json in (data['invoiceItems'] as List?) ?? const []) {
      final item = InvoiceItem.fromJson(json);
      await deliver('invoice_item', item.id, item.revision, item.toDatabaseMap());
    }
    for (final json in (data['attachments'] as List?) ?? const []) {
      final a = Attachment.fromJson(json);
      await deliver('attachment', a.id, null, a.toDatabaseMap());
    }

    // Deletions last: a record deleted on the server is removed even if it
    // was also returned above, and nothing held for it is applied later.
    final tombstones = (data['tombstones'] as List?) ?? const [];
    final deletes = tombstoneDeletes(tombstones);
    for (final d in deletes) {
      await db.delete(d.table, where: d.where, whereArgs: d.whereArgs);
    }
    await _dropHeldForTombstones(db, tombstones);
    if (deletes.isNotEmpty) debugPrint('Applied ${deletes.length} local deletes from tombstones');
  }

  Future<void> _hold(Database db, String type, String id, int? revision, Map<String, dynamic> row) async {
    final held = await db.query('sync_held_rows',
        columns: ['revision'], where: 'object_type = ? AND object_id = ?', whereArgs: [type, id]);
    if (held.isNotEmpty && !deliveredReplacesHeld(revision, parseRevision(held.first['revision']))) return;
    await db.insert(
      'sync_held_rows',
      {
        'object_type': type,
        'object_id': id,
        'revision': revision,
        'row_json': jsonEncode(row),
        'held_at': _clock().toUtc().toIso8601String(),
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<void> _dropHeldForTombstones(Database db, List tombstones) async {
    await _dropHeld(
      db,
      [
        for (final t in tombstones)
          if (t is Map && t['object_type'] is String && t['object_id'] is String)
            (t['object_type'] as String, t['object_id'] as String),
      ],
      withChildren: true,
    );
  }

  /// Forgets held server rows of [records] (object type, id); [withChildren]:
  /// also of the items and attachments of an invoice among them.
  Future<void> _dropHeld(Database db, List<(String, String)> records, {bool withChildren = false}) async {
    final invoiceIds = <String>{};
    for (final (type, id) in records) {
      await db.delete('sync_held_rows', where: 'object_type = ? AND object_id = ?', whereArgs: [type, id]);
      if (type == 'invoice') invoiceIds.add(id);
    }
    if (!withChildren || invoiceIds.isEmpty) return;
    for (final held in await db.query('sync_held_rows',
        where: 'object_type IN (?, ?)', whereArgs: ['invoice_item', 'attachment'])) {
      final row = jsonDecode(held['row_json'] as String) as Map<String, dynamic>;
      final parent = held['object_type'] == 'invoice_item'
          ? row['invoice_id']
          : (row['owner_type'] == 'invoice' ? row['owner_id'] : null);
      if (invoiceIds.contains(parent)) {
        await db.delete('sync_held_rows',
            where: 'object_type = ? AND object_id = ?', whereArgs: [held['object_type'], held['object_id']]);
      }
    }
  }

  /// Writes held server rows of records that no longer have a pending or
  /// conflict change, unless the local copy is already as new; then forgets them.
  Future<void> _applyHeldRows(Database db) async {
    final held = await db.query('sync_held_rows');
    if (held.isEmpty) return;
    final open = heldBackObjectKeys(await db.query('pending_changes', where: 'synced = ?', whereArgs: [0]));
    for (final h in held) {
      final type = h['object_type'] as String;
      final id = h['object_id'] as String;
      if (open.contains('$type:$id')) continue;
      final table = localTableFor[type];
      if (table != null) {
        final heldRevision = parseRevision(h['revision']);
        int? localRevision;
        if (versionedObjectTypes.contains(type)) {
          final local = await db.query(table, columns: ['revision'], where: 'id = ?', whereArgs: [id], limit: 1);
          localRevision = local.isEmpty ? null : parseRevision(local.first['revision']);
        }
        if (heldRowApplies(heldRevision, localRevision)) {
          await _upsert(db, table, jsonDecode(h['row_json'] as String) as Map<String, dynamic>);
        }
      }
      await db.delete('sync_held_rows', where: 'object_type = ? AND object_id = ?', whereArgs: [type, id]);
    }
  }

  /// Conflicts checked per pull, round-robin: a queue stored in
  /// sync_conflict_checks (a sequence, not a clock) that new conflicts join
  /// at the back (oldest first) and checked ones return to. A conflict is
  /// checked within ceil(q / 50) pulls, q = the queue length when it joined
  /// or was last checked, however many new conflicts arrive; across restarts.
  static const int maxConflictChecksPerSync = 50;

  /// Local conflict rows whose conflict is no longer open on the server
  /// (resolved or dismissed here, on another device or on the web) are
  /// removed, so held server rows of the record can be applied. Each conflict
  /// is checked on its own (`GET /sync/conflicts/:id`; the list is capped by
  /// the server): 404 or not open => forget it; any other error => keep it.
  Future<void> _forgetResolvedConflicts(Database db, int? generation) async {
    // Conflicts no longer held locally leave the queue
    await db.rawDelete('''
        DELETE FROM sync_conflict_checks WHERE conflict_id NOT IN (
          SELECT conflict_id FROM pending_changes WHERE synced = 0 AND status = ? AND conflict_id IS NOT NULL)''',
        [conflictStatus]);
    // New conflicts join the back of the queue, oldest first
    final joining = await db.rawQuery('''
        SELECT p.conflict_id AS conflict_id FROM pending_changes p
         WHERE p.synced = 0 AND p.status = ? AND p.conflict_id IS NOT NULL
           AND p.conflict_id NOT IN (SELECT conflict_id FROM sync_conflict_checks)
         GROUP BY p.conflict_id ORDER BY MIN(p.created_at), p.conflict_id''', [conflictStatus]);
    for (final row in joining) {
      await _moveToBackOfChecks(db, row['conflict_id'] as String);
    }
    final front = await db.query('sync_conflict_checks',
        columns: ['conflict_id'], orderBy: 'check_seq ASC', limit: maxConflictChecksPerSync);
    final ids = [for (final row in front) row['conflict_id'] as String];
    for (final id in ids) {
      // Back of the queue before the request, so a failing check is retried
      // only after the others
      _check(generation);
      await _moveToBackOfChecks(db, id);
      try {
        final res = await _apiClient.get('/sync/conflicts/${Uri.encodeComponent(id)}', useCache: false);
        _check(generation);
        final data = res.data;
        if (data is! Map || data['status'] == 'open') continue;
        final current = data['current'];
        await _forgetConflict(db, id,
            dropHeld: data['resolution'] != 'dismiss',
            currentRevision: current is Map ? parseRevision(current['revision']) : null);
      } on DioException catch (e) {
        _check(generation);
        if (e.response?.statusCode == 404) {
          // Gone (pruned after retention): the server row stands.
          await _forgetConflict(db, id, dropHeld: false);
        } else {
          debugPrint('Sync: could not check conflict $id: ${e.message}');
        }
      } on AccountChangedException {
        rethrow;
      } catch (e) {
        debugPrint('Sync: could not check conflict $id: $e');
      }
    }
  }

  Future<void> _moveToBackOfChecks(Database db, String conflictId) => db.rawInsert('''
      INSERT OR REPLACE INTO sync_conflict_checks (conflict_id, check_seq)
      VALUES (?, (SELECT COALESCE(MAX(check_seq), 0) + 1 FROM sync_conflict_checks))''', [conflictId]);

  @override
  Future<void> conflictResolved(String conflictId, String action, {int? currentRevision}) async {
    final db = await _db();
    await _forgetConflict(db, conflictId, dropHeld: action != 'dismiss', currentRevision: currentRevision);
    await _applyHeldRows(db);
  }

  /// Removes the local rows of [conflictId]. With [dropHeld] (resolved with
  /// the device's version), also the server rows held for those records that
  /// are older than [currentRevision], the record's revision after the
  /// resolution: a held row at or above it already is the server's state
  /// after the resolution (the server re-delivers resolved records, and a
  /// pull may have held that delivery before this conflict was checked), so
  /// it stays and is applied. With [currentRevision] unknown nothing is
  /// dropped; an older held row then shows until the re-delivery replaces it.
  Future<void> _forgetConflict(Database db, String conflictId, {required bool dropHeld, int? currentRevision}) async {
    final rows = await db.query('pending_changes',
        where: 'synced = ? AND status = ? AND conflict_id = ?', whereArgs: [0, conflictStatus, conflictId]);
    await db.delete('pending_changes',
        where: 'synced = ? AND status = ? AND conflict_id = ?', whereArgs: [0, conflictStatus, conflictId]);
    await db.delete('sync_conflict_checks', where: 'conflict_id = ?', whereArgs: [conflictId]);
    if (dropHeld && currentRevision != null) {
      for (final r in rows) {
        await db.delete('sync_held_rows',
            where: 'object_type = ? AND object_id = ? AND (revision IS NULL OR revision < ?)',
            whereArgs: [r['object_type'], r['object_id'], currentRevision]);
      }
    }
  }

  Future<void> _upsert(Database db, String table, Map<String, dynamic> row) =>
      db.insert(table, row, conflictAlgorithm: ConflictAlgorithm.replace);

  @override
  Future<List<FailedChange>> listFailed() async {
    final db = await _db();
    final rows = await db.query('pending_changes',
        where: 'synced = ? AND status = ?', whereArgs: [0, failedStatus], orderBy: 'created_at ASC');
    return rows.map(FailedChange.fromRow).toList();
  }

  @override
  Future<void> retry(String id) async {
    final db = await _db();
    await db.update(
      'pending_changes',
      {'status': pendingStatus, 'attempts': 0, 'last_reason': null, 'next_attempt_at': null},
      where: 'id = ? AND status = ?',
      whereArgs: [id, failedStatus],
    );
  }

  @override
  Future<List<FailedChange>> listWaiting() async {
    final db = await _db();
    final rows = await db.query('pending_changes',
        where: 'synced = ? AND status = ? AND attempts > 0', whereArgs: [0, pendingStatus], orderBy: 'created_at ASC');
    return rows.map(FailedChange.fromRow).toList();
  }

  @override
  Future<void> retryNow(String id) async {
    final db = await _db();
    await db.update('pending_changes', {'next_attempt_at': null},
        where: 'id = ? AND status = ?', whereArgs: [id, pendingStatus]);
    await sync();
  }

  @override
  Future<void> discard(String id) async {
    final db = await _db();
    await db.delete('pending_changes', where: 'id = ? AND status = ?', whereArgs: [id, failedStatus]);
    await _applyHeldRows(db);
  }

  /// Queue a change for sync.
  ///
  /// [baseRevision] is the revision the change is based on; for update and
  /// delete it is read from the local record when not given (create has none).
  /// For an update, pass the record's [previous] values (same keys and format
  /// as [data]) and only the changed fields are queued; an update that changes
  /// nothing is not queued. Returns the queued row id, or null.
  ///
  /// An invoice item change also records its invoice ([parentId]: the
  /// invoice it is created in or moved to, else its current one) and that
  /// invoice's local revision ([parentRevision]), sent as `parent_revision`.
  Future<String?> queueChange({
    required ChangeObjectType objectType,
    required String objectId,
    required ChangeType changeType,
    required Map<String, dynamic> data,
    Map<String, dynamic>? previous,
    int? baseRevision,
    String? parentId,
    int? parentRevision,
  }) async {
    final db = await _db();
    // The verified account the database belongs to.
    final userId = _accounts?.activeUserId ?? await DatabaseHelper.readMeta(db, SyncMeta.owner) ?? '';

    var payload = data;
    if (changeType == ChangeType.update && previous != null) {
      payload = changedFields(previous, data);
      if (payload.isEmpty) return null;
    }

    int? base;
    if (changeType != ChangeType.create && versionedObjectTypes.contains(objectType.name)) {
      base = baseRevision ?? await _localRevision(db, objectType.name, objectId);
    }

    String? parent;
    int? parentBase;
    if (objectType == ChangeObjectType.invoice_item) {
      parent = parentId ?? itemInvoiceIdFromData(data) ?? await _localItemInvoiceId(db, objectId);
      parentBase = parentRevision ?? (parent != null ? await _localRevision(db, 'invoice', parent) : null);
    }

    final id = const Uuid().v4();
    await db.insert('pending_changes', {
      'id': id,
      'user_id': userId,
      'device_id': _deviceId,
      'object_type': objectType.name,
      'object_id': objectId,
      'change_json': jsonEncode(payload),
      'change_type': changeType.name,
      'synced': 0,
      'created_at': DateTime.now().toIso8601String(),
      'base_revision': base,
      'status': pendingStatus,
      'attempts': 0,
      'parent_id': parent,
      'parent_base_revision': parentBase,
    });
    return id;
  }

  Future<String?> _localItemInvoiceId(Database db, String itemId) async {
    final rows = await db.query('invoice_items_local',
        columns: ['invoice_id'], where: 'id = ?', whereArgs: [itemId], limit: 1);
    return rows.isEmpty ? null : rows.first['invoice_id'] as String?;
  }

  Future<int?> _localRevision(Database db, String objectType, String objectId) async {
    final table = localTableFor[objectType];
    if (table == null) return null;
    final rows = await db.query(table, columns: ['revision'], where: 'id = ?', whereArgs: [objectId], limit: 1);
    return rows.isEmpty ? null : parseRevision(rows.first['revision']);
  }

  /// Sync status of the signed-in account.
  Future<SyncStatus> status() async {
    final db = await _db();
    Future<int> count(String where, List<Object> args) async =>
        Sqflite.firstIntValue(await db.rawQuery('SELECT COUNT(*) FROM pending_changes WHERE $where', args)) ?? 0;
    return SyncStatus(
      lastSync: DateTime.tryParse(await DatabaseHelper.readMeta(db, SyncMeta.lastSync) ?? ''),
      openConflicts: int.tryParse(await DatabaseHelper.readMeta(db, SyncMeta.openConflicts) ?? '') ?? 0,
      state: syncStateFromName(await DatabaseHelper.readMeta(db, SyncMeta.state)),
      pending: await count('synced = 0 AND status = ?', [pendingStatus]),
      failedOrWaiting: await count(
          'synced = 0 AND (status = ? OR (status = ? AND attempts > 0))', [failedStatus, pendingStatus]),
    );
  }

  /// Stores the open conflict count read from the server (display only).
  Future<void> recordOpenConflicts(int count) async =>
      DatabaseHelper.writeMeta(await _db(), SyncMeta.openConflicts, '$count');

  /// Get device ID
  String get deviceId => _deviceId;
}
