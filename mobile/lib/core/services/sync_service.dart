// Dart imports
import 'dart:convert';

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
const String lastSyncTimestampKey = 'last_sync_timestamp';
const String syncStateKey = 'sync_state';
const String syncOpenConflictsKey = 'sync_open_conflicts';

/// Set when a change was given up or discarded: the next pull fetches
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
  final DatabaseHelper _dbHelper;
  final String _deviceId;

  /// Push rounds per sync. A record with several queued changes sends one per
  /// round, so each is based on the revision the previous one produced.
  static const int maxPushRounds = 10;

  SyncService(this._apiClient, this._dbHelper) : _deviceId = const Uuid().v4();

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

  /// Push the queue, at most one change per record per round.
  Future<_PushOutcome> _pushChanges() async {
    final db = await DatabaseHelper.getDatabase();
    var state = SyncState.ok;
    var synced = 0, conflicts = 0, failed = 0;
    String? message;
    // Rows whose failure was counted in this sync (at most once per sync).
    final counted = <String>{};

    for (var round = 0; round < maxPushRounds; round++) {
      final pending = await _pendingRows(db);
      final batch = selectPushBatch(pending);
      if (batch.isEmpty) break;

      // Until a result arrives, the server may or may not have applied them.
      for (final row in batch) {
        await db.update('pending_changes', {'last_result': sentUnknown}, where: 'id = ?', whereArgs: [row['id']]);
      }

      Map<String, dynamic> response;
      try {
        final res = await _apiClient.post('/sync/push', data: buildPushBody(_deviceId, batch));
        response = res.data as Map<String, dynamic>;
      } on DioException catch (e) {
        // A server without protocol 2 rejects the `protocol` field (400) and
        // applies nothing. Do not fall back to protocol 1: keep the queue.
        if (e.response?.statusCode == 400) {
          debugPrint('Sync push: server rejected protocol 2 (400): ${e.response?.data}');
          return const _PushOutcome(SyncState.serverUpdateRequired, 0, 0, 0, null);
        }
        rethrow;
      }

      final plan = planPushResults(batch, response, countedThisSync: counted);
      if (plan.resultsMissing) {
        debugPrint('Sync push: response without per-change results; nothing marked');
        return _PushOutcome(SyncState.serverUpdateRequired, synced, conflicts, failed, plan.message);
      }
      if (plan.state == SyncState.appUpdateRequired) state = SyncState.appUpdateRequired;
      message ??= plan.message;

      for (final a in plan.actions) {
        if (a.status == 'failed' && a.reason != null) counted.add(a.changeId);
      }
      final renamed = await _applyPushPlan(db, batch, plan);
      for (final entry in renamed.entries) {
        if (counted.remove(entry.key)) counted.add(entry.value);
      }
      synced += plan.count(PushActionKind.synced);
      conflicts += plan.count(PushActionKind.conflict);
      failed += plan.count(PushActionKind.keepPending) + plan.count(PushActionKind.giveUp);
      debugPrint('Sync push round $round: ${plan.count(PushActionKind.synced)} synced, '
          '${plan.count(PushActionKind.conflict)} conflicts, ${plan.count(PushActionKind.keepPending)} pending');

      // Stop when this round settled nothing: the rest is failing.
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
          await db.update('pending_changes', {'synced': 1, 'last_reason': null, 'last_result': null},
              where: 'id = ?', whereArgs: [action.changeId]);
          final table = localTableFor[action.objectType];
          if (action.revision != null && table != null && versionedObjectTypes.contains(action.objectType)) {
            await db.update(table, {'revision': action.revision}, where: 'id = ?', whereArgs: [action.objectId]);
          }
          settled.add((action, batch[i]));
          break;
        case PushActionKind.conflict:
          await db.update(
            'pending_changes',
            {'status': conflictStatus, 'conflict_id': action.conflictId, 'last_reason': action.reason, 'last_result': null},
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
            {'status': failedStatus, 'last_reason': action.reason, 'attempts': action.attempts, 'last_result': sentFailed},
            where: 'id = ?',
            whereArgs: [action.changeId],
          );
          await _markFullPullNeeded();
          break;
      }
    }

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

  /// Pull server changes into the local cache; returns the open conflict count.
  Future<int> _pullChanges() async {
    final prefs = await SharedPreferences.getInstance();
    final db = await DatabaseHelper.getDatabase();
    final fullPullNeeded = prefs.getBool(syncFullPullNeededKey) ?? false;
    final lastSync = pullSince(prefs.getString(lastSyncTimestampKey), fullPullNeeded: fullPullNeeded);

    var data = await _pull(lastSync);
    if (pullStep(data, sentSince: lastSync != null) == PullStep.fullResync) {
      debugPrint('Sync pull: full resync required');
      await _clearLocalCache(db);
      await prefs.remove(lastSyncTimestampKey);
      data = await _pull(null);
    }

    await _applyPull(db, data);

    final openConflicts = openConflictsOf(data);
    if (fullPullNeeded) await prefs.remove(syncFullPullNeededKey);
    await prefs.setInt(syncOpenConflictsKey, openConflicts);
    await prefs.setString(lastSyncTimestampKey, data['lastSyncTimestamp'] as String);
    debugPrint('Sync completed at ${data['lastSyncTimestamp']}');
    return openConflicts;
  }

  Future<Map<String, dynamic>> _pull(String? since) async {
    final response = await _apiClient.get(
      '/sync/pull',
      queryParameters: since != null ? {'since': since} : null,
      useCache: false,
    );
    return response.data as Map<String, dynamic>;
  }

  /// Drop the local cache (not the queue). Records with a change still
  /// waiting to be sent are kept: the pull does not overwrite them, so they
  /// would otherwise disappear until the next full resync.
  Future<void> _clearLocalCache(Database db) async {
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
    bool hasPending(String type, String id) => pending.contains('$type:$id');

    if (data['clients'] != null) {
      final clients = (data['clients'] as List).map((json) => Client.fromJson(json)).toList();
      for (final client in clients) {
        if (hasPending('client', client.id)) continue;
        await _upsert(db, 'clients_local', client.toDatabaseMap());
      }
      debugPrint('Pulled ${clients.length} clients');
    }

    if (data['invoices'] != null) {
      final invoices = (data['invoices'] as List).map((json) => Invoice.fromJson(json)).toList();
      for (final invoice in invoices) {
        if (hasPending('invoice', invoice.id)) continue;
        await _upsert(db, 'invoices_local', invoice.toDatabaseMap());
      }
      debugPrint('Pulled ${invoices.length} invoices');
    }

    if (data['invoiceItems'] != null) {
      final items = (data['invoiceItems'] as List).map((json) => InvoiceItem.fromJson(json)).toList();
      for (final item in items) {
        if (hasPending('invoice_item', item.id)) continue;
        await _upsert(db, 'invoice_items_local', item.toDatabaseMap());
      }
      debugPrint('Pulled ${items.length} invoice items');
    }

    if (data['attachments'] != null) {
      final attachments = (data['attachments'] as List).map((json) => Attachment.fromJson(json)).toList();
      for (final attachment in attachments) {
        if (hasPending('attachment', attachment.id)) continue;
        await _upsert(db, 'attachments_local', attachment.toDatabaseMap());
      }
      debugPrint('Pulled ${attachments.length} attachments');
    }

    // Deletions last: a record deleted on the server is removed even if it
    // was also returned above.
    final deletes = tombstoneDeletes(data['tombstones']);
    for (final d in deletes) {
      await db.delete(d.table, where: d.where, whereArgs: d.whereArgs);
    }
    if (deletes.isNotEmpty) debugPrint('Applied ${deletes.length} local deletes from tombstones');
  }

  Future<void> _upsert(Database db, String table, Map<String, dynamic> row) =>
      db.insert(table, row, conflictAlgorithm: ConflictAlgorithm.replace);

  Future<void> _markFullPullNeeded() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(syncFullPullNeededKey, true);
  }

  @override
  Future<List<FailedChange>> listFailed() async {
    final db = await DatabaseHelper.getDatabase();
    final rows = await db.query('pending_changes',
        where: 'synced = ? AND status = ?', whereArgs: [0, failedStatus], orderBy: 'created_at ASC');
    return rows.map(FailedChange.fromRow).toList();
  }

  @override
  Future<void> retry(String id) async {
    final db = await DatabaseHelper.getDatabase();
    await db.update('pending_changes', {'status': pendingStatus, 'attempts': 0, 'last_reason': null},
        where: 'id = ? AND status = ?', whereArgs: [id, failedStatus]);
  }

  @override
  Future<void> discard(String id) async {
    final db = await DatabaseHelper.getDatabase();
    await db.delete('pending_changes', where: 'id = ? AND status = ?', whereArgs: [id, failedStatus]);
    await _markFullPullNeeded();
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
    final db = await DatabaseHelper.getDatabase();
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
