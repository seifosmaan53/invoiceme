// Dart imports
import 'dart:convert';
import 'dart:math' show Random;

// Package imports
import 'package:dio/dio.dart' show DioException;
import 'package:flutter/foundation.dart' show debugPrint;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite/sqflite.dart';
import 'package:uuid/uuid.dart';

// Local imports - Core
import '../database/database_helper.dart';
import '../services/api_client.dart';
import 'sync_protocol.dart';

// Local imports - Models
import '../../models/attachment.dart';
import '../../models/client.dart';
import '../../models/invoice.dart';
import '../../models/invoice_item.dart';

export 'sync_protocol.dart';

enum ChangeType { create, update, delete }

enum ChangeObjectType { client, invoice, invoice_item, attachment }

/// SharedPreferences keys.
/// Time of the last completed pull, for display only (protocol 2 pulls by cursor).
const String lastSyncTimestampKey = 'last_sync_timestamp';

/// Opaque pull cursor, stored only after every page of a pull was applied.
const String syncCursorKey = 'sync_cursor';
const String syncStateKey = 'sync_state';
const String syncOpenConflictsKey = 'sync_open_conflicts';

/// Set by earlier builds when a change was rejected or discarded (read and
/// cleared once; skipped server rows are now held, see sync_held_rows): the next pull fetches
/// everything, because earlier pulls skipped that record while it was queued.
const String syncFullPullNeededKey = 'sync_full_pull_needed';


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
class SyncService implements FailedChangesStore {
  final ApiClient _apiClient;
  // ignore: unused_field
  final DatabaseHelper? _dbHelper;
  final String _deviceId;
  final DateTime Function() _clock;
  final Random _random;
  final Future<Database> Function() _db;

  /// Push rounds per sync. A record with several queued changes sends one per
  /// round, so each is based on the revision the previous one produced.
  static const int maxPushRounds = 10;

  /// [clock], [random] and [database] are for tests (defaults: system clock,
  /// a random jitter, the app database).
  SyncService(
    this._apiClient,
    this._dbHelper, {
    String? deviceId,
    DateTime Function()? clock,
    Random? random,
    Future<Database> Function()? database,
  })  : _deviceId = deviceId ?? const Uuid().v4(),
        _clock = clock ?? DateTime.now,
        _random = random ?? Random(),
        _db = database ?? DatabaseHelper.getDatabase;

  /// Push pending changes, then pull server updates.
  ///
  /// When the server does not speak protocol 2, nothing is pushed or pulled,
  /// the queue is kept and the report's state is [SyncState.serverUpdateRequired].
  Future<SyncReport> sync() async {
    final prefs = await SharedPreferences.getInstance();
    try {
      final push = await _pushChanges();
      if (push.state == SyncState.serverUpdateRequired) {
        await prefs.setString(syncStateKey, push.state.name);
        return SyncReport(state: push.state, message: push.message);
      }
      final openConflicts = await _pullChanges();
      await prefs.setString(syncStateKey, push.state.name);
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
  Future<_PushOutcome> _pushChanges() async {
    final db = await _db();
    var state = SyncState.ok;
    var synced = 0, conflicts = 0, failed = 0;
    String? message;

    for (var round = 0; round < maxPushRounds; round++) {
      final pending = await _pendingRows(db);
      final batch = selectPushBatch(pending, now: _clock());
      if (batch.isEmpty) break;

      // Until a result arrives, the server may or may not have applied them.
      for (final row in batch) {
        await db.update('pending_changes', {'last_result': sentUnknown}, where: 'id = ?', whereArgs: [row['id']]);
      }

      PushPlan plan;
      try {
        final res = await _apiClient.post('/sync/push', data: buildPushBody(_deviceId, batch));
        plan = planPushResults(batch, res.data as Map<String, dynamic>);
      } on DioException catch (e) {
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
  Future<int> _pullChanges() async {
    final prefs = await SharedPreferences.getInstance();
    final db = await _db();
    final fullPullNeeded = prefs.getBool(syncFullPullNeededKey) ?? false;
    // An app that synced with `since` before has no cursor: full pull.
    final start = startCursor(prefs.getString(syncCursorKey), fullPullNeeded: fullPullNeeded);
    await _forgetResolvedConflicts(db);
    await _applyHeldRows(db);

    final result = await runCursorPull(
      storedCursor: start,
      fetch: _pullPage,
      applyPage: (page) => _applyPull(db, page),
      clearCache: () async {
        debugPrint('Sync pull: full resync required');
        await _clearLocalCache(db);
      },
      dropCursor: () => prefs.remove(syncCursorKey),
    );

    if (result.cursor != null) {
      await prefs.setString(syncCursorKey, result.cursor!);
    } else {
      await prefs.remove(syncCursorKey);
    }
    if (fullPullNeeded) await prefs.remove(syncFullPullNeededKey);
    await prefs.setInt(syncOpenConflictsKey, result.openConflicts);
    await prefs.setString(lastSyncTimestampKey, result.lastSyncTimestamp ?? _clock().toUtc().toIso8601String());
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
    final invoiceIds = <String>{};
    for (final t in tombstones) {
      if (t is! Map || t['object_type'] is! String || t['object_id'] is! String) continue;
      await db.delete('sync_held_rows',
          where: 'object_type = ? AND object_id = ?', whereArgs: [t['object_type'], t['object_id']]);
      if (t['object_type'] == 'invoice') invoiceIds.add(t['object_id'] as String);
    }
    if (invoiceIds.isEmpty) return;
    // Items and attachments of a deleted invoice.
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

  /// Local conflict rows whose conflict is no longer open on the server
  /// (resolved or dismissed here, on another device or on the web) are
  /// removed, so held server rows of the record can be applied. Best effort:
  /// without an answer nothing changes.
  Future<void> _forgetResolvedConflicts(Database db) async {
    final local = await db.query('pending_changes',
        columns: ['conflict_id'], where: 'synced = ? AND status = ?', whereArgs: [0, conflictStatus]);
    if (local.isEmpty) return;
    Set<String> open;
    try {
      final res = await _apiClient.get('/sync/conflicts', queryParameters: {'status': 'open'}, useCache: false);
      final data = res.data;
      if (data is! List) return;
      open = {for (final c in data) if (c is Map && c['id'] is String) c['id'] as String};
    } catch (e) {
      debugPrint('Sync: could not check conflicts: $e');
      return;
    }
    for (final row in local) {
      final id = row['conflict_id'];
      if (id is String && !open.contains(id)) {
        await db.delete('pending_changes',
            where: 'synced = ? AND status = ? AND conflict_id = ?', whereArgs: [0, conflictStatus, id]);
      }
    }
  }

  @override
  Future<void> conflictResolved(String conflictId) async {
    final db = await _db();
    await db.delete('pending_changes',
        where: 'synced = ? AND status = ? AND conflict_id = ?', whereArgs: [0, conflictStatus, conflictId]);
    await _applyHeldRows(db);
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
    final prefs = await SharedPreferences.getInstance();
    final userId = prefs.getString('user_id') ?? '';

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

  /// Get device ID
  String get deviceId => _deviceId;
}
